'use client';

import { useApp } from '@/context/AppContext';
import type { Segment } from '@/lib/types';
import { formatDuration, formatTimestamp, parseTimestamp } from '@/lib/time';
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
  const { editor, addSegment, updateSegment, removeSegment } = useApp();
  const segments = editor.segments;

  const totalOutput = segments.reduce(
    (sum, s) => (s.end > s.start ? sum + (s.end - s.start) : sum),
    0
  );

  const invalidCount = segments.filter(
    (s) =>
      !(s.end > s.start) ||
      (duration != null && (s.start < 0 || s.end > duration + 0.5))
  ).length;

  const handleBulkAdd = () => {
    const raw = prompt(
      'Paste timestamp ranges, one per line, e.g.\n00:00 - 00:10\n0:15-0:19\n00:38 - 00:39'
    );
    if (!raw) return;
    const lines = raw.split(/\n+/);
    for (const line of lines) {
      const match = line.split(/\s*[-–—to]+\s*/i).filter(Boolean);
      if (match.length < 2) continue;
      const start = parseTimestamp(match[0]);
      const end = parseTimestamp(match[match.length - 1]);
      if (start == null || end == null || end <= start) continue;
      addSegment({ start, end });
    }
  };

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Timestamp segments</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {segments.length} clip{segments.length === 1 ? '' : 's'} · output length{' '}
            <span className="font-mono text-white/80">
              {formatTimestamp(totalOutput)}
            </span>{' '}
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
          No segments yet. Add one, or use{' '}
          <button className="underline hover:text-white" onClick={handleBulkAdd}>
            paste ranges
          </button>{' '}
          to enter several at once.
        </div>
      ) : (
        <ul className="space-y-2">
          {segments.map((segment: Segment, index: number) => (
            <SegmentRow
              key={segment.id}
              index={index}
              segment={segment}
              duration={duration}
              onUpdate={(patch) => updateSegment(segment.id, patch)}
              onRemove={() => removeSegment(segment.id)}
              onSetStart={() => updateSegment(segment.id, { start: round(getCurrentTime()) })}
              onSetEnd={() => updateSegment(segment.id, { end: round(getCurrentTime()) })}
              onSeekStart={() => seekTo(segment.start)}
              onPreview={() => previewRange(segment.start, segment.end)}
            />
          ))}
        </ul>
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
