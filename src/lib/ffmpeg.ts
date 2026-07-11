// Client-side video processing with ffmpeg.wasm.
//
// Pipeline for a session:
//   1. Write the uploaded source into the in-memory FS.
//   2. For each requested [start, end] range, re-encode a normalized clip
//      (H.264 / AAC / mp4). Re-encoding gives frame-accurate cut boundaries and
//      makes every clip share the same codec parameters.
//   3. Concatenate all normalized clips with the concat demuxer using stream
//      copy (fast, lossless) into the final stitched output.
//
// Because each clip is produced as its own file, the individual clips are also
// available for optional download — no extra work needed.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { RenderProgress, RenderResult, Segment } from './types';

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
    // Reset so a later attempt can retry loading.
    loadPromise = null;
    throw err;
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
 * Run the full clip + splice pipeline.
 *
 * @param file      The source video file.
 * @param segments  Ordered list of [start, end] ranges (seconds).
 * @param opts      Progress + naming options.
 */
export async function renderClips(
  file: File,
  segments: Segment[],
  opts: {
    onProgress?: (progress: RenderProgress) => void;
    onLog?: (msg: string) => void;
    outputBaseName?: string;
  } = {}
): Promise<RenderResult> {
  const valid = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({ ...s }));

  if (valid.length === 0) {
    throw new Error('Add at least one valid segment (end must be after start).');
  }

  const ffmpeg = await getFFmpeg(opts.onLog);
  const report = (ratio: number, stage: string) =>
    opts.onProgress?.({ ratio: Math.max(0, Math.min(1, ratio)), stage });

  const inputExt = extensionFromName(file.name);
  const inputName = `input.${inputExt}`;
  const base = sanitizeBaseName(opts.outputBaseName ?? file.name);

  // Track files we create so we can always clean them up.
  const scratchFiles = new Set<string>([inputName]);

  report(0.02, 'Loading source video…');
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // ffmpeg's progress events are per-command; scale them into an overall bar.
  // We reserve ~85% of the bar for per-clip extraction and ~15% for concat.
  const clipShare = 0.85;
  const perClip = clipShare / valid.length;
  let clipBaseRatio = 0.05;
  let currentClipIndex = 0;

  const progressHandler = ({ progress }: { progress: number }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    report(clipBaseRatio + clamped * perClip, `Cutting clip ${currentClipIndex + 1} of ${valid.length}…`);
  };
  ffmpeg.on('progress', progressHandler);

  const clipFilenames: string[] = [];
  const result: RenderResult = {
    clips: [],
    output: { blob: new Blob(), url: '', filename: '', duration: 0 },
  };

  try {
    for (let i = 0; i < valid.length; i++) {
      currentClipIndex = i;
      clipBaseRatio = 0.05 + i * perClip;
      const seg = valid[i];
      const duration = seg.end - seg.start;
      const clipName = `clip_${String(i).padStart(3, '0')}.mp4`;
      scratchFiles.add(clipName);

      report(clipBaseRatio, `Cutting clip ${i + 1} of ${valid.length}…`);

      // Input seeking (-ss before -i) with re-encoding is fast and accurate.
      // -t is the clip duration. We normalize to H.264/AAC so every clip shares
      // identical parameters, which lets the concat step use stream copy.
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

      const clipData = await ffmpeg.readFile(clipName);
      const clipBlob = new Blob([toArrayBuffer(clipData)], { type: 'video/mp4' });
      result.clips.push({
        index: i,
        start: seg.start,
        end: seg.end,
        blob: clipBlob,
        url: URL.createObjectURL(clipBlob),
        filename: `${base}_clip${i + 1}.mp4`,
      });
      clipFilenames.push(clipName);
    }

    // If there is only one clip, the "stitched" output is just that clip.
    let outputName = `${base}_spliced.mp4`;
    let totalDuration = valid.reduce((sum, s) => sum + (s.end - s.start), 0);

    if (clipFilenames.length === 1) {
      report(0.95, 'Finalizing output…');
      const single = result.clips[0].blob;
      result.output = {
        blob: single,
        url: URL.createObjectURL(single),
        filename: outputName,
        duration: totalDuration,
      };
    } else {
      report(0.9, 'Stitching clips together…');
      // Build the concat list file.
      const listName = 'concat_list.txt';
      scratchFiles.add(listName);
      const listBody = clipFilenames.map((name) => `file '${name}'`).join('\n');
      await ffmpeg.writeFile(listName, new TextEncoder().encode(listBody));

      const outName = 'output.mp4';
      scratchFiles.add(outName);
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

      const outData = await ffmpeg.readFile(outName);
      const outBlob = new Blob([toArrayBuffer(outData)], { type: 'video/mp4' });
      result.output = {
        blob: outBlob,
        url: URL.createObjectURL(outBlob),
        filename: outputName,
        duration: totalDuration,
      };
    }

    report(1, 'Done');
    return result;
  } finally {
    ffmpeg.off('progress', progressHandler);
    // Best-effort cleanup of the in-memory FS.
    for (const name of scratchFiles) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Normalize ffmpeg.readFile output (Uint8Array | string) to an ArrayBuffer. */
function toArrayBuffer(data: Uint8Array | string): ArrayBuffer {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer;
  }
  // Copy into a standalone ArrayBuffer to avoid referencing wasm memory.
  return data.slice().buffer;
}

/** Release object URLs held by a render result. */
export function revokeRenderResult(result: RenderResult | null): void {
  if (!result) return;
  for (const clip of result.clips) {
    URL.revokeObjectURL(clip.url);
  }
  if (result.output.url) URL.revokeObjectURL(result.output.url);
}
