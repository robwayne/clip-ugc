'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTimestamp, parseTimestamp } from '@/lib/time';

interface GroupAudioControlProps {
  groupId: string;
  audio: { start: number; end: number } | null;
  groupVideoDuration: number;
  audioUrl: string | null;
  audioSourceDuration: number | null;
  onChange: (audio: { start: number; end: number } | null) => void;
}

/** Per-group background-audio segment editor. */
export function GroupAudioControl({
  audio,
  groupVideoDuration,
  audioUrl,
  audioSourceDuration,
  onChange,
}: GroupAudioControlProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      if (stopAtRef.current != null && el.currentTime >= stopAtRef.current) {
        el.pause();
        stopAtRef.current = null;
      }
    };
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [audioUrl]);

  if (!audio) {
    return (
      <div className="mb-2 ml-7 flex items-center gap-2">
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() =>
            onChange({ start: 0, end: Math.max(groupVideoDuration, 0.1) })
          }
        >
          🎵 Add background audio
        </button>
        <span className="text-[11px] text-white/35">
          replaces this group&apos;s video audio at splice
        </span>
      </div>
    );
  }

  const len = audio.end - audio.start;
  const covers = len + 0.05 >= groupVideoDuration;
  const overrun =
    audioSourceDuration != null && audio.start + groupVideoDuration > audioSourceDuration + 0.05;

  const preview = () => {
    const el = audioRef.current;
    if (!el || !(audio.end > audio.start)) return;
    el.currentTime = Math.max(0, audio.start);
    stopAtRef.current = audio.end;
    void el.play().catch(() => {});
  };

  return (
    <div className="mb-2 ml-7 rounded-lg border border-brand-500/20 bg-brand-500/[0.05] p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <span className="mb-1.5 text-xs font-medium text-brand-100">🎵 Background audio</span>
        <AudioTimeField label="Start" value={audio.start} onCommit={(v) => onChange({ ...audio, start: v })} />
        <span className="mb-1.5 text-white/30">→</span>
        <AudioTimeField label="End" value={audio.end} onCommit={(v) => onChange({ ...audio, end: v })} />
        <div className="mb-0.5 flex items-center gap-1">
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={preview}
            disabled={!audioUrl}
            title={audioUrl ? 'Preview this audio segment' : 'Audio source not loaded'}
          >
            ▶ Preview
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs text-red-300 hover:text-red-200"
            onClick={() => onChange(null)}
            title="Remove background audio"
          >
            ✕
          </button>
        </div>
      </div>
      <p className={`mt-1 text-[11px] ${covers && !overrun ? 'text-white/45' : 'text-amber-300'}`}>
        {covers && !overrun
          ? `Covers the group’s ${formatTimestamp(groupVideoDuration)} of video · video audio will be muted`
          : overrun
          ? 'Audio segment extends past the end of the audio source'
          : `Audio (${formatTimestamp(len)}) is shorter than the group’s ${formatTimestamp(groupVideoDuration)} of video`}
      </p>
      {audioUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
      )}
    </div>
  );
}

function AudioTimeField({
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
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        className={`w-24 rounded-lg border bg-black/30 px-2 py-1 text-center font-mono text-sm outline-none focus:border-brand-400 ${
          error ? 'border-red-500' : 'border-white/15'
        }`}
        placeholder="mm:ss"
        aria-label={`Audio ${label} timestamp`}
      />
    </label>
  );
}
