'use client';

import { forwardRef } from 'react';
import { formatTimestamp } from '@/lib/time';

interface PreviewProps {
  url: string | null;
  currentTime: number;
  duration: number | null;
}

/**
 * The source video player. The <video> element is exposed via a forwarded ref
 * so the parent editor can read the playhead and seek when setting timestamps.
 */
export const Preview = forwardRef<HTMLVideoElement, PreviewProps>(function Preview(
  { url, currentTime, duration },
  ref
) {
  if (!url) return null;
  return (
    <div className="card">
      <div className="overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={ref}
          src={url}
          controls
          className="mx-auto max-h-[60vh] w-full bg-black"
        />
      </div>
      <div className="mt-3 flex items-center justify-between font-mono text-xs text-white/60">
        <span>Playhead: {formatTimestamp(currentTime, true)}</span>
        {duration != null && <span>Length: {formatTimestamp(duration, true)}</span>}
      </div>
      <p className="mt-2 text-xs text-white/40">
        Tip: scrub the video, then use the <strong>Set</strong> buttons on a segment
        below to capture the current playhead as its start or end.
      </p>
    </div>
  );
});
