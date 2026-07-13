// Client-side video processing with ffmpeg.wasm.
//
// Pipeline for a project:
//   1. Write the uploaded source into the in-memory FS.
//   2. For each segment, re-encode a normalized clip (H.264 / AAC / mp4).
//      Re-encoding gives frame-accurate cut boundaries and makes every clip
//      share identical codec parameters.
//   3. For each bucket (group, plus a trailing ungrouped bucket) concatenate its
//      clips with the concat demuxer using stream copy into a per-bucket splice.
//   4. Concatenate every clip, in bucket order, into the single final output.
//
// Because each segment is produced as its own file, individual clips are also
// available for optional download, and each bucket produces its own splice.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type {
  Group,
  RenderProgress,
  RenderResult,
  RenderedBucket,
  Segment,
} from './types';
import { computeBuckets, isValidSegment } from './groups';

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
 * Run the full clip + splice pipeline for a project with optional groups.
 */
export async function renderProject(
  file: File,
  segments: Segment[],
  groups: Group[],
  opts: {
    onProgress?: (progress: RenderProgress) => void;
    onLog?: (msg: string) => void;
    outputBaseName?: string;
  } = {}
): Promise<RenderResult> {
  // Build render order from buckets, keeping only valid segments.
  const buckets = computeBuckets(segments, groups)
    .map((b) => ({ ...b, segments: b.segments.filter(isValidSegment) }))
    .filter((b) => b.segments.length > 0);

  const orderedSegments: Segment[] = buckets.flatMap((b) => b.segments);
  if (orderedSegments.length === 0) {
    throw new Error('Add at least one valid segment (end must be after start).');
  }

  const ffmpeg = await getFFmpeg(opts.onLog);
  const report = (ratio: number, stage: string) =>
    opts.onProgress?.({ ratio: Math.max(0, Math.min(1, ratio)), stage });

  const inputExt = extensionFromName(file.name);
  const inputName = `input.${inputExt}`;
  const base = sanitizeBaseName(opts.outputBaseName ?? file.name);

  const scratchFiles = new Set<string>([inputName]);

  report(0.02, 'Loading source video…');
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Reserve ~80% of the bar for clip extraction, the rest for concat steps.
  const clipShare = 0.8;
  const perClip = clipShare / orderedSegments.length;
  let clipBaseRatio = 0.05;
  let currentClipNumber = 0;

  const progressHandler = ({ progress }: { progress: number }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    report(
      clipBaseRatio + clamped * perClip,
      `Cutting clip ${currentClipNumber} of ${orderedSegments.length}…`
    );
  };
  ffmpeg.on('progress', progressHandler);

  // Map each ordered segment to its produced clip filename + blob.
  const clipFileFor = new Map<Segment, string>();
  const result: RenderResult = {
    clips: [],
    buckets: [],
    final: { blob: new Blob(), url: '', filename: '', duration: 0 },
  };

  const concat = async (inputs: string[], outName: string): Promise<void> => {
    if (inputs.length === 1) {
      // Copy the single input to the output name so callers can read it back.
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
  };

  try {
    // 1. Extract every segment clip.
    for (let i = 0; i < orderedSegments.length; i++) {
      const seg = orderedSegments[i];
      currentClipNumber = i + 1;
      clipBaseRatio = 0.05 + i * perClip;
      const duration = seg.end - seg.start;
      const clipName = `clip_${String(i).padStart(3, '0')}.mp4`;
      scratchFiles.add(clipName);

      report(clipBaseRatio, `Cutting clip ${i + 1} of ${orderedSegments.length}…`);

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

      clipFileFor.set(seg, clipName);
      const clipData = await ffmpeg.readFile(clipName);
      const clipBlob = new Blob([toArrayBuffer(clipData)], { type: 'video/mp4' });
      result.clips.push({
        index: i,
        start: seg.start,
        end: seg.end,
        groupId: seg.groupId,
        blob: clipBlob,
        url: URL.createObjectURL(clipBlob),
        filename: `${base}_clip${i + 1}.mp4`,
      });
    }

    const multipleBuckets = buckets.length > 1;

    // 2. Build a splice per bucket.
    ffmpeg.off('progress', progressHandler); // per-clip weighting no longer applies
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      report(
        0.85 + (b / buckets.length) * 0.1,
        `Splicing ${bucket.name}…`
      );
      const inputs = bucket.segments.map((s) => clipFileFor.get(s)!);
      const outName = `bucket_${b}.mp4`;
      scratchFiles.add(outName);
      await concat(inputs, outName);

      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([toArrayBuffer(data)], { type: 'video/mp4' });
      const rendered: RenderedBucket = {
        groupId: bucket.groupId,
        name: bucket.name,
        color: bucket.color,
        segmentCount: bucket.segments.length,
        blob,
        url: URL.createObjectURL(blob),
        filename: `${base}_${sanitizeBaseName(bucket.name)}.mp4`,
        duration: bucket.segments.reduce((sum, s) => sum + (s.end - s.start), 0),
      };
      result.buckets.push(rendered);
    }

    // 3. Final output = all clips in bucket order. Reuse the single bucket's
    //    splice when there is only one bucket.
    report(0.96, 'Finalizing output…');
    const totalDuration = orderedSegments.reduce((sum, s) => sum + (s.end - s.start), 0);

    if (!multipleBuckets) {
      const only = result.buckets[0];
      result.final = {
        blob: only.blob,
        url: URL.createObjectURL(only.blob),
        filename: `${base}_spliced.mp4`,
        duration: totalDuration,
      };
    } else {
      const finalName = 'final.mp4';
      scratchFiles.add(finalName);
      const inputs = orderedSegments.map((s) => clipFileFor.get(s)!);
      await concat(inputs, finalName);
      const data = await ffmpeg.readFile(finalName);
      const blob = new Blob([toArrayBuffer(data)], { type: 'video/mp4' });
      result.final = {
        blob,
        url: URL.createObjectURL(blob),
        filename: `${base}_spliced.mp4`,
        duration: totalDuration,
      };
    }

    report(1, 'Done');
    return result;
  } finally {
    ffmpeg.off('progress', progressHandler);
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
  return data.slice().buffer;
}

/** Release object URLs held by a render result. */
export function revokeRenderResult(result: RenderResult | null): void {
  if (!result) return;
  for (const clip of result.clips) URL.revokeObjectURL(clip.url);
  for (const bucket of result.buckets) URL.revokeObjectURL(bucket.url);
  if (result.final.url) URL.revokeObjectURL(result.final.url);
}
