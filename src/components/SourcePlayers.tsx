'use client';

import type { EditorSource } from '@/context/AppContext';
import { formatTimestamp } from '@/lib/time';

interface SourcePlayersProps {
  sources: EditorSource[];
  urls: Record<string, string>;
  activeSourceId: string | null;
  focusedSourceId: string | null;
  currentTime: number;
  onActivate: (id: string) => void;
  registerEl: (id: string, el: HTMLVideoElement | null) => void;
  onTime: (id: string, t: number) => void;
}

/**
 * One video player per source video, laid out side by side (up to 4). The
 * active player (editing target) is ringed; the one currently playing during a
 * cross-source preview is highlighted green.
 */
export function SourcePlayers({
  sources,
  urls,
  activeSourceId,
  focusedSourceId,
  currentTime,
  onActivate,
  registerEl,
  onTime,
}: SourcePlayersProps) {
  if (sources.length === 0) return null;

  return (
    <div className="card">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${sources.length}, minmax(0, 1fr))` }}
      >
        {sources.map((source, i) => {
          const active = source.id === activeSourceId;
          const focused = source.id === focusedSourceId;
          const url = urls[source.id] ?? null;
          const label = String.fromCharCode(65 + i);
          return (
            <div
              key={source.id}
              onClick={() => onActivate(source.id)}
              className={`cursor-pointer overflow-hidden rounded-lg border transition-colors ${
                active
                  ? 'border-brand-400 ring-1 ring-brand-400'
                  : focused
                  ? 'border-green-400/60'
                  : 'border-white/10 hover:border-white/25'
              }`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    active ? 'bg-brand-600/40 text-brand-100' : 'bg-white/10 text-white/60'
                  }`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={source.meta.name}>
                  {source.meta.name}
                </span>
                {active && <span className="text-[10px] uppercase text-brand-300">active</span>}
                {!active && focused && <span className="text-[10px] uppercase text-green-300">playing</span>}
              </div>
              {url ? (
                <>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    ref={(el) => registerEl(source.id, el)}
                    src={url}
                    controls
                    onTimeUpdate={(e) => onTime(source.id, e.currentTarget.currentTime)}
                    className="w-full bg-black"
                    style={{ maxHeight: '45vh' }}
                  />
                  {active && (
                    <div className="px-2 py-1 text-right font-mono text-[10px] text-white/40">
                      {formatTimestamp(currentTime, true)}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center bg-black/40 px-2 text-center text-xs text-amber-200">
                  File unavailable — reselect in the Sources panel.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
