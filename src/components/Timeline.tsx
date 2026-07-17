'use client';

import { useMemo, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import type { Segment } from '@/lib/types';
import { formatTimestamp } from '@/lib/time';
import { isValidSegment } from '@/lib/groups';

const MIN_DURATION = 0.05; // seconds
const LANE_HEIGHT = 34; // px
const LANE_GAP = 6; // px
const CREATE_THRESHOLD_PX = 4;

type Drag =
  | { kind: 'pendingBg'; pointerId: number; anchor: number; moved: boolean; downX: number }
  | { kind: 'resize'; pointerId: number; id: string; side: 'start' | 'end' }
  | { kind: 'body'; pointerId: number; id: string; grab: number; moved: boolean };

interface TimelineProps {
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
  /** Only segments from this source are shown/edited on this timeline. */
  sourceId: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Greedy lane assignment so overlapping segments stack instead of colliding. */
function assignLanes(segments: Segment[]): Map<string, number> {
  const lanes: number[] = []; // lane index -> last end time
  const result = new Map<string, number>();
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  for (const seg of ordered) {
    let lane = lanes.findIndex((end) => seg.start >= end - 1e-6);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(seg.end);
    } else {
      lanes[lane] = seg.end;
    }
    result.set(seg.id, lane);
  }
  return result;
}

export function Timeline({ duration, currentTime, onSeek, sourceId }: TimelineProps) {
  const {
    editor,
    addSegment,
    updateSegment,
    setSelectedSegment,
  } = useApp();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // Only this source's segments live on this timeline.
  const segments = useMemo(
    () => editor.segments.filter((s) => s.sourceId === sourceId),
    [editor.segments, sourceId]
  );
  const groupColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of editor.groups) map.set(g.id, g.color);
    return map;
  }, [editor.groups]);

  const segMap = useMemo(() => {
    const m = new Map<string, Segment>();
    for (const s of segments) m.set(s.id, s);
    return m;
  }, [segments]);

  const lanes = useMemo(() => assignLanes(segments), [segments]);
  const laneCount = Math.max(1, ...Array.from(lanes.values()).map((l) => l + 1));
  const trackHeight = laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;

  const timeAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };

  const capture = (pointerId: number) => {
    try {
      trackRef.current?.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    // Ignore if the press landed on a segment (those stop propagation).
    capture(e.pointerId);
    dragRef.current = {
      kind: 'pendingBg',
      pointerId: e.pointerId,
      anchor: timeAt(e.clientX),
      moved: false,
      downX: e.clientX,
    };
  };

  const onHandlePointerDown = (e: React.PointerEvent, id: string, side: 'start' | 'end') => {
    e.stopPropagation();
    capture(e.pointerId);
    setSelectedSegment(id);
    dragRef.current = { kind: 'resize', pointerId: e.pointerId, id, side };
  };

  const onBodyPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    capture(e.pointerId);
    setSelectedSegment(id);
    const seg = segMap.get(id);
    if (!seg) return;
    dragRef.current = {
      kind: 'body',
      pointerId: e.pointerId,
      id,
      grab: timeAt(e.clientX) - seg.start,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const t = timeAt(e.clientX);

    if (d.kind === 'pendingBg') {
      if (Math.abs(e.clientX - d.downX) > CREATE_THRESHOLD_PX) {
        // Begin creating a new segment; continue as an end-resize.
        const start = Math.min(d.anchor, t);
        const end = Math.max(d.anchor, t);
        const id = addSegment({ start, end: Math.max(end, start + MIN_DURATION) });
        dragRef.current = {
          kind: 'resize',
          pointerId: d.pointerId,
          id,
          side: t >= d.anchor ? 'end' : 'start',
        };
      }
      return;
    }

    if (d.kind === 'resize') {
      const seg = segMap.get(d.id);
      if (!seg) return;
      if (d.side === 'end') {
        updateSegment(d.id, { end: clamp(t, seg.start + MIN_DURATION, duration) });
      } else {
        updateSegment(d.id, { start: clamp(t, 0, seg.end - MIN_DURATION) });
      }
      return;
    }

    if (d.kind === 'body') {
      const seg = segMap.get(d.id);
      if (!seg) return;
      d.moved = true;
      const len = seg.end - seg.start;
      const start = clamp(t - d.grab, 0, duration - len);
      updateSegment(d.id, { start, end: start + len });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d) return;
    if (d.kind === 'pendingBg' && !d.moved) {
      onSeek(d.anchor);
    } else if (d.kind === 'body' && !d.moved) {
      const seg = segMap.get(d.id);
      if (seg) onSeek(seg.start);
    }
  };

  const playheadPct = duration > 0 ? clamp(currentTime / duration, 0, 1) * 100 : 0;

  // A handful of evenly spaced tick marks for orientation.
  const ticks = useMemo(() => {
    const count = 6;
    return Array.from({ length: count + 1 }, (_, i) => (duration * i) / count);
  }, [duration]);

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Timeline</h2>
        <p className="text-xs text-white/40">
          Drag empty space to create · drag a bar to move · drag its edges to trim ·
          press <kbd className="rounded bg-white/10 px-1">S</kbd>/
          <kbd className="rounded bg-white/10 px-1">E</kbd> to mark start/end
        </p>
      </div>

      {/* Ruler */}
      <div className="relative mb-1 h-4 select-none text-[10px] text-white/40">
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 font-mono"
            style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
          >
            {formatTimestamp(t)}
          </span>
        ))}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-white/10 bg-black/40"
        style={{ height: trackHeight }}
      >
        {/* lane guide lines */}
        {Array.from({ length: laneCount }).map((_, i) => (
          <div
            key={i}
            className="absolute inset-x-0 border-b border-white/5"
            style={{ top: (i + 1) * LANE_HEIGHT + i * LANE_GAP - 1, height: 0 }}
          />
        ))}

        {segments.map((seg) => {
          const lane = lanes.get(seg.id) ?? 0;
          const valid = isValidSegment(seg);
          const left = clamp(seg.start / duration, 0, 1) * 100;
          const width = Math.max(
            0.5,
            (clamp(seg.end, seg.start, duration) - clamp(seg.start, 0, duration)) /
              duration
          ) * 100;
          const color = seg.groupId ? groupColor.get(seg.groupId) ?? '#64748b' : '#64748b';
          const selected = editor.selectedSegmentId === seg.id;
          const recording = editor.openSegmentId === seg.id;

          return (
            <div
              key={seg.id}
              onPointerDown={(e) => onBodyPointerDown(e, seg.id)}
              className={`group absolute flex items-center overflow-hidden rounded-md text-[10px] font-medium text-white shadow-sm ${
                recording
                  ? 'z-[5] animate-pulse ring-2 ring-red-400'
                  : selected
                  ? 'ring-2 ring-white'
                  : 'ring-1 ring-black/30'
              } ${valid ? 'cursor-grab active:cursor-grabbing' : 'opacity-60'}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: lane * (LANE_HEIGHT + LANE_GAP),
                height: LANE_HEIGHT,
                background: valid
                  ? `${color}cc`
                  : 'repeating-linear-gradient(45deg,#7f1d1d,#7f1d1d 6px,#991b1b 6px,#991b1b 12px)',
              }}
              title={`${formatTimestamp(seg.start, true)} → ${formatTimestamp(seg.end, true)}`}
            >
              {/* start handle */}
              <span
                onPointerDown={(e) => onHandlePointerDown(e, seg.id, 'start')}
                className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/30 opacity-0 transition-opacity group-hover:opacity-100"
              />
              <span className="pointer-events-none truncate px-2.5">
                {recording ? '● REC ' : ''}
                {formatTimestamp(seg.start)}–{formatTimestamp(seg.end)}
              </span>
              {/* end handle */}
              <span
                onPointerDown={(e) => onHandlePointerDown(e, seg.id, 'end')}
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/30 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          );
        })}

        {/* playhead */}
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-px bg-red-400"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-red-400" />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-white/40">
        <span className="font-mono">
          Playhead {formatTimestamp(currentTime, true)}
          {editor.openSegmentId && (
            <span className="ml-2 animate-pulse font-sans font-medium text-red-400">
              ● Recording — press E to set end
            </span>
          )}
        </span>
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => addSegment({ start: currentTime, end: Math.min(duration, currentTime + 5) })}
        >
          + Add at playhead
        </button>
      </div>
    </div>
  );
}
