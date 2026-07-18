'use client';

import { useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import type { SourceMeta } from '@/lib/types';
import { buildSourceMeta, probeDuration } from '@/lib/media';
import { formatDuration, formatTimestamp } from '@/lib/time';

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg';

/** Pick the session's background-audio track source and preview it. */
export function AudioPanel({
  audioUrl,
  audioMeta,
}: {
  audioUrl: string | null;
  audioMeta: SourceMeta | null;
}) {
  const {
    editor,
    setAudioTrackVideo,
    setAudioTrackFile,
    replaceAudioTrackFile,
    clearAudioTrack,
  } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [probing, setProbing] = useState(false);
  const [time, setTime] = useState(0);

  const a = editor.audioSource;

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProbing(true);
    const dur = await probeDuration(file);
    setProbing(false);
    if (a?.kind === 'file') replaceAudioTrackFile(file, buildSourceMeta(file, dur));
    else setAudioTrackFile(file, buildSourceMeta(file, dur));
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active ? 'border-brand-400 bg-brand-500/10 text-white' : 'border-white/15 text-white/70 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="card">
      <div className="mb-2">
        <h2 className="text-sm font-semibold">Background audio</h2>
        <p className="mt-0.5 text-xs text-white/50">
          Pick one audio track source. A group can then use a segment of it as its background audio
          — the group&apos;s video audio is muted and replaced at splice.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chip('None', a == null, () => clearAudioTrack())}
        {editor.sources.map((s) =>
          chip(
            `🎬 ${s.meta.name}`,
            a?.kind === 'video' && a.sourceId === s.id,
            () => setAudioTrackVideo(s.id)
          )
        )}
        {chip('⬆ Upload audio…', a?.kind === 'file', () => fileRef.current?.click())}
        <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={onUpload} />
      </div>

      {probing && <p className="mt-2 text-xs text-white/40">Reading audio…</p>}

      {a && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-xs">
              <span className="font-medium">
                {a.kind === 'video' ? '🎬 ' : '🎵 '}
                {audioMeta?.name ?? 'audio source'}
              </span>
              {audioMeta?.duration != null && (
                <span className="text-white/40"> · {formatDuration(audioMeta.duration)}</span>
              )}
            </div>
            <button className="btn-ghost px-2 py-1 text-xs text-red-300" onClick={() => clearAudioTrack()}>
              Remove
            </button>
          </div>

          {audioUrl ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                className="mt-2 w-full"
              />
              <p className="mt-1 font-mono text-[11px] text-white/40">
                Playhead {formatTimestamp(time, true)} — note times here to set a group&apos;s audio
                segment below.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-amber-200">
              {a.kind === 'file'
                ? 'Audio file not loaded — click “Upload audio…” to reselect it.'
                : 'The chosen video isn’t loaded — reselect it in the Sources panel.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
