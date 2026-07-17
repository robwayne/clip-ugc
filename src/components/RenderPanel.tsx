'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import {
  RenderCancelledError,
  concatRenderedVideos,
  renderSplice,
  revokeSplice,
  terminateFFmpeg,
} from '@/lib/ffmpeg';
import type { RenderProgress, Segment, SpliceResult } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/time';
import { computeBuckets, isValidSegment } from '@/lib/groups';

type Phase = 'idle' | 'rendering' | 'done' | 'error' | 'cancelled';

interface RenderState {
  phase: Phase;
  progress: RenderProgress;
  result: SpliceResult | null;
  error: string | null;
  /** Signature of the segments this result was rendered from (for staleness). */
  signature: string;
  /** Estimated seconds remaining, or null while it can't be estimated yet. */
  etaSeconds: number | null;
}

const FINAL_KEY = '__final__';

function bucketKey(groupId: string | null): string {
  return groupId ?? '__ungrouped__';
}

function signatureOf(segments: Segment[]): string {
  return JSON.stringify(segments.map((s) => [s.id, s.start, s.end]));
}

const idleState = (): RenderState => ({
  phase: 'idle',
  progress: { ratio: 0, stage: '' },
  result: null,
  error: null,
  signature: '',
  etaSeconds: null,
});

function formatEta(seconds: number): string {
  if (seconds <= 1) return 'almost done';
  if (seconds < 60) return `~${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `~${m}m ${s}s left`;
}

export function RenderPanel() {
  const { editor } = useApp();
  const [states, setStates] = useState<Record<string, RenderState>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const statesRef = useRef(states);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);
  // Revoke all object URLs on unmount.
  useEffect(
    () => () => {
      Object.values(statesRef.current).forEach((s) => revokeSplice(s.result));
    },
    []
  );

  const buckets = useMemo(
    () =>
      computeBuckets(editor.segments, editor.groups)
        .map((b) => ({ ...b, segments: b.segments.filter(isValidSegment) }))
        .filter((b) => b.segments.length > 0),
    [editor.segments, editor.groups]
  );
  const orderedAll = useMemo(() => buckets.flatMap((b) => b.segments), [buckets]);
  const totalDuration = orderedAll.reduce((sum, s) => sum + (s.end - s.start), 0);
  const showFinal = buckets.length > 1;

  const patch = useCallback((key: string, next: Partial<RenderState>) => {
    setStates((prev) => ({ ...prev, [key]: { ...(prev[key] ?? idleState()), ...next } }));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    terminateFFmpeg();
  }, []);

  const runRender = useCallback(
    async (
      key: string,
      signature: string,
      produce: (
        signal: AbortSignal,
        onProgress: (p: RenderProgress) => void
      ) => Promise<SpliceResult>
    ) => {
      if (abortRef.current) return; // one render at a time
      const controller = new AbortController();
      abortRef.current = controller;
      setActiveKey(key);
      revokeSplice(statesRef.current[key]?.result);
      patch(key, {
        phase: 'rendering',
        progress: { ratio: 0, stage: 'Starting…' },
        error: null,
        result: null,
        signature,
        etaSeconds: null,
      });

      // Estimate remaining time from elapsed time and progress, smoothed so it
      // doesn't jump around (e.g. when cached clips complete instantly).
      const startedAt = performance.now();
      let etaEma: number | null = null;
      const onProgress = (p: RenderProgress) => {
        const elapsed = (performance.now() - startedAt) / 1000;
        let eta: number | null = null;
        if (p.ratio >= 0.999) {
          eta = 0;
        } else if (p.ratio > 0.02 && elapsed > 0.3) {
          const raw = (elapsed * (1 - p.ratio)) / p.ratio;
          etaEma = etaEma == null ? raw : etaEma * 0.5 + raw * 0.5;
          eta = etaEma;
        }
        patch(key, { progress: p, etaSeconds: eta });
      };

      try {
        const result = await produce(controller.signal, onProgress);
        patch(key, { phase: 'done', result, progress: { ratio: 1, stage: 'Done' }, etaSeconds: 0 });
      } catch (err) {
        if (err instanceof RenderCancelledError || controller.signal.aborted) {
          patch(key, { phase: 'cancelled', result: null });
        } else {
          console.error(err);
          patch(key, {
            phase: 'error',
            result: null,
            error: err instanceof Error ? err.message : 'Something went wrong.',
          });
        }
      } finally {
        abortRef.current = null;
        setActiveKey(null);
      }
    },
    [patch]
  );

  const fileBySource = useMemo(() => {
    const m = new Map<string, File | null>();
    for (const s of editor.sources) m.set(s.id, s.file);
    return m;
  }, [editor.sources]);

  const baseName = editor.title || editor.sources[0]?.meta.name || 'video';

  const itemsFor = useCallback(
    (segs: Segment[]) =>
      segs
        .filter(isValidSegment)
        .map((s) => ({ start: s.start, end: s.end, file: fileBySource.get(s.sourceId) ?? null }))
        .filter((it): it is { start: number; end: number; file: File } => it.file != null),
    [fileBySource]
  );

  const hasMissing = (segs: Segment[]) =>
    segs.some((s) => !fileBySource.get(s.sourceId));

  const spliceGroup = useCallback(
    (groupId: string | null, name: string, segments: Segment[]) => {
      const items = itemsFor(segments);
      if (items.length === 0) return;
      runRender(bucketKey(groupId), signatureOf(segments), (signal, onProgress) =>
        renderSplice(items, { outputBaseName: baseName, label: name, signal, onProgress })
      );
    },
    [itemsFor, baseName, runRender]
  );

  const spliceFinal = useCallback(() => {
    const items = itemsFor(orderedAll);
    if (items.length === 0) return;
    const signature = signatureOf(orderedAll) + '|final';
    runRender(FINAL_KEY, signature, (signal, onProgress) => {
      // Fast path: if every group already has a fresh splice, just stitch those.
      const current = statesRef.current;
      const allFresh = buckets.every((b) => {
        const st = current[bucketKey(b.groupId)];
        return st?.phase === 'done' && st.result && st.signature === signatureOf(b.segments);
      });
      if (allFresh) {
        const parts = buckets.map((b) => current[bucketKey(b.groupId)]!.result!);
        return concatRenderedVideos(parts, {
          outputBaseName: baseName,
          label: 'final',
          durationSeconds: totalDuration,
          signal,
          onProgress,
        });
      }
      return renderSplice(items, { outputBaseName: baseName, label: 'final', signal, onProgress });
    });
  }, [itemsFor, baseName, buckets, orderedAll, totalDuration, runRender]);

  if (editor.sources.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold">Splice &amp; download</h2>
        <p className="mt-2 text-xs text-white/40">Add a source video to splice.</p>
      </div>
    );
  }

  if (orderedAll.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold">Splice &amp; download</h2>
        <p className="mt-2 text-xs text-white/40">Add at least one valid segment to splice.</p>
      </div>
    );
  }

  const busy = activeKey !== null;

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Splice &amp; download</h2>
      </div>
      <p className="mb-4 text-xs text-white/50">
        Splice and download each group on its own — no need to process everything. Combining
        all groups into one video is optional, below.
      </p>

      <div className="space-y-3">
        {buckets.map((bucket) => {
          const key = bucketKey(bucket.groupId);
          const state = states[key] ?? idleState();
          const duration = bucket.segments.reduce((sum, s) => sum + (s.end - s.start), 0);
          const stale =
            state.phase === 'done' && state.signature !== signatureOf(bucket.segments);
          return (
            <GroupSpliceCard
              key={key}
              name={bucket.name}
              color={bucket.color}
              segmentCount={bucket.segments.length}
              duration={duration}
              state={state}
              stale={stale}
              unavailable={hasMissing(bucket.segments)}
              isActive={activeKey === key}
              disabled={busy && activeKey !== key}
              onSplice={() => spliceGroup(bucket.groupId, bucket.name, bucket.segments)}
              onCancel={cancel}
            />
          );
        })}
      </div>

      {showFinal && (
        <div className="mt-6 border-t border-white/10 pt-5">
          <h3 className="text-sm font-semibold">
            Combine all groups{' '}
            <span className="text-xs font-normal text-white/40">(optional)</span>
          </h3>
          <p className="mb-3 mt-0.5 text-xs text-white/50">
            Stitches every group, in order, into one final video. Splice the groups first and
            this reuses them (fast); otherwise it processes everything.
          </p>
          <GroupSpliceCard
            name="Final combined video"
            color={null}
            segmentCount={orderedAll.length}
            duration={totalDuration}
            state={states[FINAL_KEY] ?? idleState()}
            stale={
              (states[FINAL_KEY]?.phase === 'done' &&
                states[FINAL_KEY]?.signature !== signatureOf(orderedAll) + '|final') ||
              false
            }
            unavailable={hasMissing(orderedAll)}
            isActive={activeKey === FINAL_KEY}
            disabled={busy && activeKey !== FINAL_KEY}
            onSplice={spliceFinal}
            onCancel={cancel}
            primaryLabel="Combine & download"
          />
        </div>
      )}
    </div>
  );
}

function GroupSpliceCard({
  name,
  color,
  segmentCount,
  duration,
  state,
  stale,
  unavailable,
  isActive,
  disabled,
  onSplice,
  onCancel,
  primaryLabel = 'Splice & download',
}: {
  name: string;
  color: string | null;
  segmentCount: number;
  duration: number;
  state: RenderState;
  stale: boolean;
  unavailable: boolean;
  isActive: boolean;
  disabled: boolean;
  onSplice: () => void;
  onCancel: () => void;
  primaryLabel?: string;
}) {
  const rendering = state.phase === 'rendering';
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: color ?? '#64748b' }}
          />
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-white/40">
            {segmentCount} clip{segmentCount === 1 ? '' : 's'} · {formatDuration(duration)}
          </span>
        </div>
        <div className="flex gap-2">
          {rendering ? (
            <button className="btn-danger px-3 py-1.5 text-xs" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button
              className="btn-primary px-3 py-1.5 text-xs"
              onClick={onSplice}
              disabled={disabled || unavailable}
              title={unavailable ? 'Reselect the missing source video(s) to splice' : undefined}
            >
              {state.phase === 'done' ? 'Re-splice' : primaryLabel}
            </button>
          )}
        </div>
      </div>

      {unavailable && !rendering && (
        <p className="mt-2 text-xs text-amber-300">
          Some segments use a source whose file isn&apos;t loaded — reselect it above to splice.
        </p>
      )}

      {rendering && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-white/60">
            <span>{state.progress.stage}</span>
            <span>
              {Math.round(state.progress.ratio * 100)}%
              {state.etaSeconds != null && (
                <span className="ml-2 text-white/40">{formatEta(state.etaSeconds)}</span>
              )}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
              style={{ width: `${Math.round(state.progress.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.error}
        </p>
      )}
      {state.phase === 'cancelled' && (
        <p className="mt-3 text-xs text-white/50">Splice cancelled.</p>
      )}

      {state.phase === 'done' && state.result && (
        <div className="mt-3">
          {stale && (
            <p className="mb-2 text-xs text-amber-300">
              Segments changed since this was spliced — re-splice for the latest.
            </p>
          )}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={state.result.url}
            controls
            className="rounded bg-black object-contain"
            style={{ width: 270, height: 180 }}
          />
          <div className="mt-2 flex items-center gap-3">
            <a
              href={state.result.url}
              download={state.result.filename}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              ⬇ Download “{name}”
            </a>
            <span className="text-xs text-white/40">
              {formatBytes(state.result.blob.size)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
