'use client';

import { useEffect, useState } from 'react';
import type { Group, Segment } from '@/lib/types';
import { formatTimestamp, parseTimestamp } from '@/lib/time';

interface SegmentRowProps {
  label: string;
  segment: Segment;
  duration: number | null;
  groups: Group[];
  selected: boolean;
  open: boolean;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: (e: React.DragEvent) => void;
  onDropRow: (e: React.DragEvent) => void;
  onSelect: () => void;
  onUpdate: (patch: Partial<Segment>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onChangeGroup: (groupId: string | null) => void;
  onSetStart: () => void;
  onSetEnd: () => void;
  onSeekStart: () => void;
  onPreview: () => void;
}

export function SegmentRow({
  label,
  segment,
  duration,
  groups,
  selected,
  open,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDropRow,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
  onChangeGroup,
  onSetStart,
  onSetEnd,
  onSeekStart,
  onPreview,
}: SegmentRowProps) {
  const invalid = !(segment.end > segment.start);
  const outOfRange =
    duration != null && (segment.start < 0 || segment.end > duration + 0.5);

  return (
    <li
      onClick={onSelect}
      onDragOver={onDragOverRow}
      onDrop={onDropRow}
      className={`rounded-lg border p-3 transition-colors ${
        dragging ? 'opacity-40' : ''
      } ${dragOver ? 'border-t-2 border-t-brand-400' : ''} ${
        open
          ? 'border-red-400/60 bg-red-500/[0.06]'
          : selected
          ? 'border-white/40 bg-white/[0.06]'
          : invalid || outOfRange
          ? 'border-amber-500/40 bg-amber-500/[0.04]'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="mb-2 flex h-6 shrink-0 cursor-grab items-center px-0.5 text-white/30 hover:text-white active:cursor-grabbing"
          title="Drag to reorder within this group"
          aria-label="Drag to reorder"
        >
          ⠿
        </span>
        <span
          className={`mb-2 flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
            open ? 'animate-pulse bg-red-500/40 text-red-100' : 'bg-brand-600/30 text-brand-100'
          }`}
        >
          {open ? '●' : label}
        </span>

        <TimeField
          label="Start"
          value={segment.start}
          onCommit={(v) => onUpdate({ start: v })}
        />
        <span className="mb-2 text-white/30">→</span>
        <TimeField label="End" value={segment.end} onCommit={(v) => onUpdate({ end: v })} />

        <label className="block" onClick={(e) => e.stopPropagation()}>
          <span className="label">Group</span>
          <select
            value={segment.groupId ?? ''}
            onChange={(e) => onChangeGroup(e.target.value || null)}
            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <div
          className="mb-0.5 flex flex-1 flex-wrap items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onSetStart} title="Set start to playhead">
            Set start
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onSetEnd} title="Set end to playhead">
            Set end
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onSeekStart} title="Seek to start">
            Seek
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onPreview} title="Preview this range">
            ▶
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(-1)} title="Move earlier in group">
            ↑
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(1)} title="Move later in group">
            ↓
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onDuplicate} title="Duplicate segment">
            ⧉
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs text-red-300 hover:text-red-200"
            onClick={onRemove}
            title="Remove segment"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-1 pl-9 text-xs text-white/40">
        {invalid
          ? 'End must be after start.'
          : outOfRange
          ? 'This range extends beyond the video length.'
          : `Duration ${formatTimestamp(segment.end - segment.start, true)}`}
      </div>
    </li>
  );
}

/**
 * A timestamp text field that accepts flexible formats and commits on blur /
 * Enter, re-formatting when the underlying value changes externally.
 */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(() => formatTimestamp(value, true));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatTimestamp(value, true));
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const parsed = parseTimestamp(text);
    if (parsed == null) {
      setError(true);
      setText(formatTimestamp(value, true));
      setTimeout(() => setError(false), 1200);
      return;
    }
    setError(false);
    onCommit(Math.round(parsed * 1000) / 1000);
    setText(formatTimestamp(parsed, true));
  };

  return (
    <label className="block" onClick={(e) => e.stopPropagation()}>
      <span className="label">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        className={`w-24 rounded-lg border bg-black/30 px-2 py-1.5 text-center font-mono text-sm outline-none focus:border-brand-400 ${
          error ? 'border-red-500' : 'border-white/15'
        }`}
        placeholder="mm:ss"
        aria-label={`${label} timestamp`}
      />
    </label>
  );
}
