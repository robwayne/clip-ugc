'use client';

import { useCallback, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type { EditorSource } from '@/context/AppContext';
import { buildSourceMeta, matchesSource, probeDuration } from '@/lib/media';
import { formatBytes, formatDuration } from '@/lib/time';

const ACCEPT = 'video/*,.mkv,.mp4,.mov,.webm,.avi,.m4v,.ogv';

export function SourcesPanel() {
  const { editor, addSource, replaceSourceFile, removeSource, setActiveSource } = useApp();
  const addInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [probing, setProbing] = useState(false);

  const sources = editor.sources;

  const handleAdd = useCallback(
    async (file: File) => {
      setProbing(true);
      const duration = await probeDuration(file);
      setProbing(false);
      addSource(file, buildSourceMeta(file, duration));
    },
    [addSource]
  );

  const onAddInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => void handleAdd(f));
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    Array.from(e.dataTransfer.files ?? []).forEach((f) => void handleAdd(f));
  };

  if (sources.length === 0) {
    return (
      <div className="space-y-3">
        <ReselectBanner />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => addInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? 'border-brand-400 bg-brand-500/10' : 'border-white/15 bg-white/[0.02] hover:border-white/30'
          }`}
        >
          <div className="text-4xl">🎬</div>
          <p className="mt-3 text-sm font-medium">
            {probing ? 'Reading video…' : 'Drop video(s) here or click to browse'}
          </p>
          <p className="mt-1 text-xs text-white/40">
            Add one or more sources — MP4, MKV, MOV, WebM, AVI…
          </p>
        </div>
        <input ref={addInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={onAddInput} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Source videos</h2>
        <p className="mt-0.5 text-xs text-white/50">
          Segments are cut from the active source. Add multiple videos to combine clips from
          different sources — each segment can pick its own.
        </p>
      </div>

      <div className="space-y-2">
        {sources.map((s, i) => (
          <SourceRow
            key={s.id}
            source={s}
            label={String.fromCharCode(65 + i)}
            active={editor.activeSourceId === s.id}
            onActivate={() => setActiveSource(s.id)}
            onReselect={(file, meta) => replaceSourceFile(s.id, file, meta)}
            onRemove={() => {
              const n = editor.segments.filter((seg) => seg.sourceId === s.id).length;
              if (n > 0 && !confirm(`Remove "${s.meta.name}"? Its ${n} segment${n === 1 ? '' : 's'} will be deleted.`))
                return;
              removeSource(s.id);
            }}
          />
        ))}
      </div>

      <div className="mt-3">
        <button className="btn-secondary" onClick={() => addInputRef.current?.click()}>
          + Add source video
        </button>
        <input ref={addInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={onAddInput} />
      </div>
    </div>
  );
}

function SourceRow({
  source,
  label,
  active,
  onActivate,
  onReselect,
  onRemove,
}: {
  source: EditorSource;
  label: string;
  active: boolean;
  onActivate: () => void;
  onReselect: (file: File, meta: ReturnType<typeof buildSourceMeta>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [probing, setProbing] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const missing = source.file === null;

  const onReselectInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMismatch(
      !matchesSource(file, source.meta)
        ? `"${file.name}" (${formatBytes(file.size)}) doesn't match the original "${source.meta.name}" (${formatBytes(source.meta.size)}). Timestamps may not line up.`
        : null
    );
    setProbing(true);
    const duration = await probeDuration(file);
    setProbing(false);
    onReselect(file, buildSourceMeta(file, duration));
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        active ? 'border-white/30 bg-white/[0.06]' : missing ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onActivate} className="flex min-w-0 items-center gap-2 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-xs font-semibold text-brand-100">
            {label}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{source.meta.name}</span>
            <span className="block text-xs text-white/40">
              {formatBytes(source.meta.size)}
              {source.meta.duration != null && <> · {formatDuration(source.meta.duration)}</>}
              {missing && <span className="text-amber-300"> · file unavailable</span>}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {active && <span className="text-[10px] uppercase text-brand-300">active</span>}
          {!active && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={onActivate}>
              Use
            </button>
          )}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => inputRef.current?.click()}>
            {missing ? 'Reselect' : 'Replace'}
          </button>
          <button className="btn-ghost px-2 py-1 text-xs text-red-300 hover:text-red-200" onClick={onRemove} title="Remove source">
            ✕
          </button>
        </div>
      </div>
      {probing && <p className="mt-2 text-xs text-white/40">Reading video…</p>}
      {mismatch && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {mismatch}
        </p>
      )}
      {missing && !probing && (
        <p className="mt-2 text-xs text-amber-200">
          This source isn&apos;t loaded. Reselect the file to splice or preview its segments.
        </p>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onReselectInput} />
    </div>
  );
}

function ReselectBanner() {
  const { editor } = useApp();
  const missing = editor.sources.filter((s) => s.file === null);
  if (missing.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium text-amber-200">⚠️ Source video(s) unavailable</p>
      <p className="mt-1 text-amber-100/80">
        This session references {missing.map((s) => s.meta.name).join(', ')}, but the file(s)
        aren&apos;t loaded. Add them below to keep editing.
      </p>
    </div>
  );
}
