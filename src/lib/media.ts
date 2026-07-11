import type { SourceMeta } from './types';

/**
 * Read the duration (seconds) of a video File using a hidden <video> element.
 * Resolves with null if the browser cannot decode enough to report a duration
 * (some containers like certain .mkv files are not natively playable but can
 * still be processed by ffmpeg.wasm).
 */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(value);
    };

    video.onloadedmetadata = () => {
      const d = video.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    video.onerror = () => finish(null);
    // Fallback timeout so we never hang the UI.
    setTimeout(() => finish(null), 8000);
    video.src = url;
  });
}

export function buildSourceMeta(file: File, duration: number | null): SourceMeta {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    duration,
  };
}

/** Heuristic: does a reselected file plausibly match a stored source? */
export function matchesSource(file: File, meta: SourceMeta): boolean {
  return file.name === meta.name && file.size === meta.size;
}
