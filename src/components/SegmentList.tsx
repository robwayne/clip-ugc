'use client';

import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { formatDuration, formatTimestamp, parseTimestamp } from '@/lib/time';
import { computeBuckets, isValidSegment, totalOutputDuration } from '@/lib/groups';
import { SegmentRow } from './SegmentRow';

interface SegmentListProps {
  duration: number | null;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  previewRange: (start: number, end: number) => void;
  playSegments: (ranges: Array<{ start: number; end: number }>, key: string) => void;
  loopSegments: (ranges: Array<{ start: number; end: number }>, key: string) => void;
  stopPlayback: () => void;
  playingKey: string | null;
  loopingKey: string | null;
}

export function SegmentList({
  duration,
  getCurrentTime,
  seekTo,
  previewRange,
  playSegments,
  loopSegments,
  stopPlayback,
  playingKey,
  loopingKey,
}: SegmentListProps) {
  const {
    editor,
    addSegment,
    updateSegment,
    removeSegment,
    duplicateSegment,
    moveSegmentWithinGroup,
    moveSegmentBefore,
    setSelectedSegment,
  } = useApp();
  const segments = editor.segments;
  const buckets = computeBuckets(segments, editor.groups);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggingSeg = draggingId ? segments.find((s) => s.id === draggingId) : undefined;

  const totalOutput = totalOutputDuration(segments);
  const invalidCount = segments.filter(
    (s) => !(s.end > s.start) || (duration != null && (s.start < 0 || s.end > duration + 0.5))
  ).length;

  const allRanges = buckets
    .flatMap((b) => b.segments)
    .filter(isValidSegment)
    .map((s) => ({ start: s.start, end: s.end }));

  const handleBulkAdd = () => {
    const raw = prompt(
      'Paste timestamp ranges, one per line, e.g.\n00:00 - 00:10\n0:15-0:19\n00:38 - 00:39\n\nThese are added to the active group.'
    );
    if (!raw) return;
    for (const line of raw.split(/\n+/)) {
      const match = line.split(/\s*[-–—to]+\s*/i).filter(Boolean);
      if (match.length < 2) continue;
      const start = parseTimestamp(match[0]);
      const end = parseTimestamp(match[match.length - 1]);
      if (start == null || end == null || end <= start) continue;
      addSegment({ start, end });
    }
  };

  const clearDrag = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Segments</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {segments.length} clip{segments.length === 1 ? '' : 's'} · total output{' '}
            <span className="font-mono text-white/80">{formatTimestamp(totalOutput)}</span>{' '}
            ({formatDuration(totalOutput)}) · drag the ⠿ handle to reorder within a group
          </p>
        </div>
        <div className="flex gap-2">
          {allRanges.length > 0 &&
            (playingKey === '__all__' ? (
              <button className="btn-secondary" onClick={stopPlayback}>
                ⏸ Stop
              </button>
            ) : (
              <button
                className="btn-secondary"
                onClick={() => playSegments(allRanges, '__all__')}
                title="Preview the whole final splice in order"
              >
                ▶ Play all
              </button>
            ))}
          <button className="btn-ghost" onClick={handleBulkAdd} title="Paste multiple ranges">
            Paste ranges
          </button>
          <button className="btn-secondary" onClick={() => addSegment()}>
            + Add segment
          </button>
        </div>
      </div>

      {segments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
          No segments yet. Drag on the timeline above, click{' '}
          <span className="text-white/70">+ Add segment</span>, or{' '}
          <button className="underline hover:text-white" onClick={handleBulkAdd}>
            paste ranges
          </button>
          .
        </div>
      ) : (
        <div className="space-y-5">
          {buckets.map((bucket) => {
            const bucketKey = `group:${bucket.groupId ?? '__ungrouped__'}`;
            const bucketRanges = bucket.segments
              .filter(isValidSegment)
              .map((s) => ({ start: s.start, end: s.end }));
            const isPlaying = playingKey === bucketKey;
            const isLooping = loopingKey === bucketKey;
            const droppableGroup =
              draggingSeg != null && draggingSeg.groupId === bucket.groupId;

            return (
              <section key={bucket.groupId ?? '__ungrouped__'}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: bucket.color ?? '#64748b' }}
                  />
                  <h3 className="text-sm font-medium">{bucket.name}</h3>
                  <span className="text-xs text-white/40">
                    {bucket.segments.length} segment{bucket.segments.length === 1 ? '' : 's'} ·{' '}
                    {formatDuration(totalOutputDuration(bucket.segments))}
                  </span>
                  {bucketRanges.length > 0 && (
                    <>
                      {isPlaying && !isLooping ? (
                        <button
                          className="btn-ghost px-2 py-1 text-xs text-red-300"
                          onClick={stopPlayback}
                        >
                          ⏸ Stop
                        </button>
                      ) : (
                        <button
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => playSegments(bucketRanges, bucketKey)}
                          title="Play this group's clips back-to-back, in order"
                        >
                          ▶ Play group
                        </button>
                      )}
                      <button
                        className={`px-2 py-1 text-xs ${
                          isLooping
                            ? 'btn rounded-lg bg-brand-600/30 text-brand-100'
                            : 'btn-ghost'
                        }`}
                        onClick={() => loopSegments(bucketRanges, bucketKey)}
                        title={
                          isLooping
                            ? 'Looping this group — click to stop'
                            : 'Loop this group continuously'
                        }
                        aria-pressed={isLooping}
                      >
                        🔁 {isLooping ? 'Looping' : 'Loop Group'}
                      </button>
                    </>
                  )}
                </div>
                <ul className="space-y-2">
                  {bucket.segments.map((segment, i) => (
                    <SegmentRow
                      key={segment.id}
                      label={String(i + 1)}
                      segment={segment}
                      duration={duration}
                      groups={editor.groups}
                      selected={editor.selectedSegmentId === segment.id}
                      open={editor.openSegmentId === segment.id}
                      dragging={draggingId === segment.id}
                      dragOver={
                        dragOverId === segment.id && draggingId !== segment.id && droppableGroup
                      }
                      onDragStart={() => setDraggingId(segment.id)}
                      onDragEnd={clearDrag}
                      onDragOverRow={(e) => {
                        if (droppableGroup) {
                          e.preventDefault();
                          setDragOverId(segment.id);
                        }
                      }}
                      onDropRow={(e) => {
                        e.preventDefault();
                        if (draggingId && droppableGroup) {
                          moveSegmentBefore(draggingId, segment.id);
                        }
                        clearDrag();
                      }}
                      onSelect={() => setSelectedSegment(segment.id)}
                      onUpdate={(patch) => updateSegment(segment.id, patch)}
                      onRemove={() => removeSegment(segment.id)}
                      onDuplicate={() => duplicateSegment(segment.id)}
                      onMove={(dir) => moveSegmentWithinGroup(segment.id, dir)}
                      onChangeGroup={(groupId) => updateSegment(segment.id, { groupId })}
                      onSetStart={() => updateSegment(segment.id, { start: round(getCurrentTime()) })}
                      onSetEnd={() => updateSegment(segment.id, { end: round(getCurrentTime()) })}
                      onSeekStart={() => seekTo(segment.start)}
                      onPreview={() => previewRange(segment.start, segment.end)}
                      looping={loopingKey === `seg:${segment.id}`}
                      onLoop={() =>
                        loopSegments(
                          [{ start: segment.start, end: segment.end }],
                          `seg:${segment.id}`
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {invalidCount > 0 && (
        <p className="mt-3 text-xs text-amber-300">
          {invalidCount} segment{invalidCount === 1 ? ' has' : 's have'} an invalid or
          out-of-range time and will be skipped.
        </p>
      )}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
