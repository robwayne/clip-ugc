'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { renderProject, revokeRenderResult } from '@/lib/ffmpeg';
import type { RenderProgress, RenderResult } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/time';
import { computeBuckets, isValidSegment } from '@/lib/groups';

export function RenderPanel() {
  const { editor, saveCurrentSession } = useApp();
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<RenderProgress>({ ratio: 0, stage: '' });
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<RenderResult | null>(null);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    return () => revokeRenderResult(resultRef.current);
  }, []);

  const validSegments = editor.segments.filter(isValidSegment);
  const buckets = computeBuckets(editor.segments, editor.groups).filter((b) =>
    b.segments.some(isValidSegment)
  );
  const canRender = !!editor.file && validSegments.length > 0 && !rendering;

  const run = useCallback(async () => {
    if (!editor.file) return;
    setError(null);
    setRendering(true);
    setProgress({ ratio: 0, stage: 'Starting…' });
    revokeRenderResult(resultRef.current);
    setResult(null);

    try {
      const res = await renderProject(editor.file, editor.segments, editor.groups, {
        outputBaseName: editor.title || editor.file.name,
        onProgress: (p) => setProgress(p),
      });
      setResult(res);
      saveCurrentSession(res.final.filename);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Something went wrong while processing the video.'
      );
    } finally {
      setRendering(false);
    }
  }, [editor.file, editor.segments, editor.groups, editor.title, saveCurrentSession]);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Splice</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {buckets.length > 1
              ? `Splices ${buckets.length} groups and stitches them into one final video.`
              : 'Cuts each segment and stitches them into one video, in your browser.'}
          </p>
        </div>
        <button className="btn-primary" onClick={run} disabled={!canRender}>
          {rendering ? 'Processing…' : '✂️ Cut & Splice'}
        </button>
      </div>

      {!editor.file && (
        <p className="mt-3 text-xs text-white/40">Load a source video to enable processing.</p>
      )}
      {editor.file && validSegments.length === 0 && (
        <p className="mt-3 text-xs text-white/40">Add at least one valid segment.</p>
      )}

      {rendering && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-white/60">
            <span>{progress.stage}</span>
            <span>{Math.round(progress.ratio * 100)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/40">
            First run downloads the ffmpeg engine (~30&nbsp;MB) and may take a moment.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {result && <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: RenderResult }) {
  const hasGroups = result.buckets.length > 1;
  return (
    <div className="mt-6 space-y-6 border-t border-white/10 pt-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-green-400">✓</span>
          <h3 className="text-sm font-semibold">Final spliced video</h3>
          <span className="text-xs text-white/40">
            {formatDuration(result.final.duration)} · {formatBytes(result.final.blob.size)}
          </span>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={result.final.url} controls className="w-full rounded-lg bg-black" />
        <a href={result.final.url} download={result.final.filename} className="btn-primary mt-3">
          ⬇ Download final video
        </a>
      </div>

      {hasGroups && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Group splices{' '}
            <span className="text-xs font-normal text-white/40">
              (each group stitched on its own)
            </span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.buckets.map((bucket) => (
              <div
                key={bucket.groupId ?? '__ungrouped__'}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: bucket.color ?? '#64748b' }}
                  />
                  <span className="text-sm font-medium">{bucket.name}</span>
                  <span className="text-xs text-white/40">
                    {bucket.segmentCount} · {formatDuration(bucket.duration)}
                  </span>
                </div>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={bucket.url} controls className="w-full rounded bg-black" />
                <a
                  href={bucket.url}
                  download={bucket.filename}
                  className="btn-secondary mt-2 w-full text-xs"
                >
                  ⬇ Download {bucket.name} splice
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.clips.length > 1 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Individual clips{' '}
            <span className="text-xs font-normal text-white/40">(optional downloads)</span>
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.clips.map((clip) => (
              <li
                key={clip.index}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="min-w-0 text-xs">
                  <div className="truncate font-medium">Clip {clip.index + 1}</div>
                  <div className="text-white/40">{formatDuration(clip.end - clip.start)}</div>
                </div>
                <a
                  href={clip.url}
                  download={clip.filename}
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                >
                  ⬇
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
