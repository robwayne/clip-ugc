// Client-side video processing with ffmpeg.wasm.
//
// The unit of work is a single splice (`renderSplice`): an ordered list of
// segments is cut from the source and concatenated into one video. A group is
// spliced by passing just that group's segments, so groups can be spliced and
// downloaded independently without processing anything else. The optional
// "final" video reuses the per-group results via `concatRenderedVideos`.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { RenderProgress, SpliceResult, Segment } from './types';
import { isValidSegment } from './groups';

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/** Load (once) and return a ready ffmpeg instance. */
export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message));
    }

    // Core files are copied into /public/ffmpeg at build time so they load
    // from this app's own origin. toBlobURL wraps them in blob URLs, which
    // keeps things working even under a strict cross-origin-embedder-policy.
    const base = '/ffmpeg';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

/**
 * Abort any in-flight processing by terminating the ffmpeg worker. Pending
 * exec() calls reject, and the singleton is reset so the next render reloads a
 * fresh worker. Used to cancel a splice.
 */
export function terminateFFmpeg(): void {
  if (ffmpegSingleton) {
    try {
      ffmpegSingleton.terminate();
    } catch {
      /* ignore */
    }
  }
  ffmpegSingleton = null;
  loadPromise = null;
}

/** Error thrown when a render is cancelled by the user. */
export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderCancelledError';
  }
}

/** Derive a safe base filename (no extension, no path separators). */
function sanitizeBaseName(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]+$/, '');
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_');
  return cleaned.replace(/^_|_$/g, '') || 'video';
}

function extensionFromName(name: string): string {
  const match = name.match(/\.([^./\\]+)$/);
  return match ? match[1].toLowerCase() : 'mp4';
}

/**
 * Splice an ordered list of segments from `file` into a single video.
 *
 * This is the core unit of work: it processes ONLY the segments passed in, so a
 * single group can be spliced and downloaded without touching any other group.
 * Each segment is re-encoded to a normalized clip in ffmpeg's in-memory FS,
 * then the clips are concatenated (stream copy) into one output.
 */
export async function renderSplice(
  file: File,
  segments: Segment[],
  opts: {
    onProgress?: (progress: RenderProgress) => void;
    onLog?: (msg: string) => void;
    outputBaseName?: string;
    label?: string;
    signal?: AbortSignal;
  } = {}
): Promise<SpliceResult> {
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new RenderCancelledError();
  };

  const ordered = segments.filter(isValidSegment);
  if (ordered.length === 0) {
    throw new Error('Add at least one valid segment (end must be after start).');
  }

  throwIfAborted();
  const ffmpeg = await getFFmpeg(opts.onLog);
  const report = (ratio: number, stage: string) =>
    opts.onProgress?.({ ratio: Math.max(0, Math.min(1, ratio)), stage });

  const inputExt = extensionFromName(file.name);
  const inputName = `input.${inputExt}`;
  const base = sanitizeBaseName(opts.outputBaseName ?? file.name);
  const label = sanitizeBaseName(opts.label ?? 'spliced');

  const scratchFiles = new Set<string>([inputName]);

  report(0.02, 'Loading source video…');
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Reserve ~90% of the bar for clip extraction, the rest for the concat step.
  const clipShare = 0.9;
  const perClip = clipShare / ordered.length;
  let clipBaseRatio = 0.05;
  let currentClipNumber = 0;

  const progressHandler = ({ progress }: { progress: number }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    report(clipBaseRatio + clamped * perClip, `Cutting clip ${currentClipNumber} of ${ordered.length}…`);
  };
  ffmpeg.on('progress', progressHandler);

  try {
    const clipNames: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      throwIfAborted();
      const seg = ordered[i];
      currentClipNumber = i + 1;
      clipBaseRatio = 0.05 + i * perClip;
      const duration = seg.end - seg.start;
      const clipName = `clip_${String(i).padStart(3, '0')}.mp4`;
      scratchFiles.add(clipName);

      report(clipBaseRatio, `Cutting clip ${i + 1} of ${ordered.length}…`);

      await ffmpeg.exec([
        '-ss',
        seg.start.toFixed(3),
        '-i',
        inputName,
        '-t',
        duration.toFixed(3),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-ac',
        '2',
        '-vsync',
        'cfr',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        clipName,
      ]);
      clipNames.push(clipName);
    }

    ffmpeg.off('progress', progressHandler);
    throwIfAborted();
    report(0.95, 'Stitching clips…');

    const outName = 'out.mp4';
    scratchFiles.add(outName);
    await concatFiles(ffmpeg, clipNames, outName, scratchFiles);

    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([toArrayBuffer(data)], { type: 'video/mp4' });
    const duration = ordered.reduce((sum, s) => sum + (s.end - s.start), 0);

    report(1, 'Done');
    return {
      blob,
      url: URL.createObjectURL(blob),
      filename: `${base}_${label}.mp4`,
      duration,
    };
  } finally {
    if (!signal?.aborted) {
      ffmpeg.off('progress', progressHandler);
      await cleanup(ffmpeg, scratchFiles);
    }
  }
}

/**
 * Concatenate already-rendered group videos into one output, using stream copy
 * (fast, lossless). Lets the optional "final" video reuse per-group results
 * instead of re-encoding everything.
 */
export async function concatRenderedVideos(
  parts: Array<{ blob: Blob }>,
  opts: {
    outputBaseName?: string;
    label?: string;
    durationSeconds?: number;
    signal?: AbortSignal;
    onProgress?: (progress: RenderProgress) => void;
    onLog?: (msg: string) => void;
  } = {}
): Promise<SpliceResult> {
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new RenderCancelledError();
  };
  if (parts.length === 0) throw new Error('Nothing to combine.');

  throwIfAborted();
  const ffmpeg = await getFFmpeg(opts.onLog);
  const report = (ratio: number, stage: string) =>
    opts.onProgress?.({ ratio: Math.max(0, Math.min(1, ratio)), stage });

  const base = sanitizeBaseName(opts.outputBaseName ?? 'video');
  const label = sanitizeBaseName(opts.label ?? 'final');
  const scratchFiles = new Set<string>();

  try {
    report(0.1, 'Loading group videos…');
    const names: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      throwIfAborted();
      const name = `part_${String(i).padStart(3, '0')}.mp4`;
      await ffmpeg.writeFile(name, await fetchFile(parts[i].blob));
      scratchFiles.add(name);
      names.push(name);
    }

    throwIfAborted();
    report(0.5, 'Combining…');
    const outName = 'combined.mp4';
    scratchFiles.add(outName);
    await concatFiles(ffmpeg, names, outName, scratchFiles);

    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([toArrayBuffer(data)], { type: 'video/mp4' });
    report(1, 'Done');
    return {
      blob,
      url: URL.createObjectURL(blob),
      filename: `${base}_${label}.mp4`,
      duration: opts.durationSeconds ?? 0,
    };
  } finally {
    if (!signal?.aborted) await cleanup(ffmpeg, scratchFiles);
  }
}

/** Concatenate FS files into `outName` (stream copy), or copy a single input. */
async function concatFiles(
  ffmpeg: FFmpeg,
  inputs: string[],
  outName: string,
  scratchFiles: Set<string>
): Promise<void> {
  if (inputs.length === 1) {
    const data = await ffmpeg.readFile(inputs[0]);
    await ffmpeg.writeFile(outName, data);
    return;
  }
  const listName = `list_${outName}.txt`;
  scratchFiles.add(listName);
  const body = inputs.map((n) => `file '${n}'`).join('\n');
  await ffmpeg.writeFile(listName, new TextEncoder().encode(body));
  await ffmpeg.exec([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listName,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outName,
  ]);
}

async function cleanup(ffmpeg: FFmpeg, scratchFiles: Set<string>): Promise<void> {
  for (const name of scratchFiles) {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      /* ignore */
    }
  }
}

/** Normalize ffmpeg.readFile output (Uint8Array | string) to an ArrayBuffer. */
function toArrayBuffer(data: Uint8Array | string): ArrayBuffer {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer;
  }
  return data.slice().buffer;
}

/** Release the object URL held by a splice result. */
export function revokeSplice(result: SpliceResult | null | undefined): void {
  if (result?.url) URL.revokeObjectURL(result.url);
}
