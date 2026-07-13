'use client';

import { useApp } from '@/context/AppContext';
import { formatDuration, formatTimestamp, parseTimestamp } from '@/lib/time';
import { computeBuckets, totalOutputDuration } from '@/lib/groups';
import { SegmentRow } from './SegmentRow';

interface SegmentListProps {
  duration: number | null;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  previewRange: (start: number, end: number) => void;
}

export function SegmentList({
  duration,
  getCurrentTime,
  seekTo,
  previewRange,
}: SegmentListProps) {
  const {
    editor,
    addSegment,
    updateSegment,
    removeSegment,
    duplicateSegment,
    moveSegmentWithinGroup,
    setSelectedSegment,
  } = useApp();
  const segments = editor.segments;
  const buckets = computeBuckets(segments, editor.groups);

  const totalOutput = totalOutputDuration(segments);
  const invalidCount = segments.filter(
    (s) => !(s.end > s.start) || (duration != null && (s.start < 0 || s.end > duration + 0.5))
  ).length;

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

  // A per-segment display index, numbered within each bucket.
  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Segments</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {segments.length} clip{segments.length === 1 ? '' : 's'} · total output{' '}
            <span className="font-mono text-white/80">{formatTimestamp(totalOutput)}</span>{' '}
            ({formatDuration(totalOutput)})
          </p>
        </div>
        <div className="flex gap-2">
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
          {buckets.map((bucket) => (
            <section key={bucket.groupId ?? '__ungrouped__'}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: bucket.color ?? '#64748b' }}
                />
                <h3 className="text-sm font-medium">{bucket.name}</h3>
                <span className="text-xs text-white/40">
                  {bucket.segments.length} segment{bucket.segments.length === 1 ? '' : 's'} ·{' '}
                  {formatDuration(totalOutputDuration(bucket.segments))}
                </span>
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
                  />
                ))}
              </ul>
            </section>
          ))}
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
