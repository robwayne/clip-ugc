'use client';

import { useCallback, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { buildSourceMeta, matchesSource, probeDuration } from '@/lib/media';
import { formatBytes, formatDuration } from '@/lib/time';

const ACCEPT = 'video/*,.mkv,.mp4,.mov,.webm,.avi,.m4v,.ogv';

export function SourcePicker() {
  const { editor, setSourceFile, clearSource, needsReselect } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [probing, setProbing] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setMismatch(null);
      // When reselecting for an existing session, warn on an obvious mismatch
      // but still allow it (the user may have renamed or re-exported the file).
      if (needsReselect && editor.source && !matchesSource(file, editor.source)) {
        setMismatch(
          `Heads up: "${file.name}" (${formatBytes(file.size)}) doesn't match the ` +
            `original source "${editor.source.name}" (${formatBytes(editor.source.size)}). ` +
            `Timestamps may not line up.`
        );
      }
      setProbing(true);
      const duration = await probeDuration(file);
      setProbing(false);
      setSourceFile(file, buildSourceMeta(file, duration));
    },
    [needsReselect, editor.source, setSourceFile]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // Loaded and file present: show a compact summary with a swap button.
  if (editor.file) {
    const src = editor.source;
    return (
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{editor.file.name}</div>
            <div className="mt-0.5 text-xs text-white/50">
              {formatBytes(editor.file.size)}
              {src?.duration != null && <> · {formatDuration(src.duration)}</>}
              {editor.file.type && <> · {editor.file.type}</>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button className="btn-ghost" onClick={clearSource}>
              Remove
            </button>
          </div>
        </div>
        {mismatch && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {mismatch}
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    );
  }

  // No file: show dropzone. If a session was opened without its file, show the
  // "source unavailable" warning above it.
  return (
    <div className="space-y-3">
      {needsReselect && editor.source && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div className="text-sm">
              <p className="font-medium text-amber-200">Source video unavailable</p>
              <p className="mt-1 text-amber-100/80">
                This session referenced <strong>{editor.source.name}</strong>
                {editor.source.duration != null && (
                  <> ({formatDuration(editor.source.duration)})</>
                )}
                , but the file isn&apos;t loaded anymore. Reselect it below to keep
                editing the saved timestamps.
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragOver
            ? 'border-brand-400 bg-brand-500/10'
            : 'border-white/15 bg-white/[0.02] hover:border-white/30'
        }`}
      >
        <div className="text-4xl">🎬</div>
        <p className="mt-3 text-sm font-medium">
          {probing ? 'Reading video…' : 'Drop a video here or click to browse'}
        </p>
        <p className="mt-1 text-xs text-white/40">
          MP4, MKV, MOV, WebM, AVI and other standard formats
        </p>
        {mismatch && (
          <p className="mt-3 max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {mismatch}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
