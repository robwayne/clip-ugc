# Clip & Splice

A browser-based video **clipping and splicing pipeline**. Upload a source video,
enter timestamp ranges, and the app cuts those ranges out and stitches them into
a single output video — with each individual clip also available to download.

All processing runs **client-side in your browser** using
[`ffmpeg.wasm`](https://ffmpegwasm.netlify.app/). Your videos never leave your
machine, and no server-side storage is required.

## Features

- **Cut & splice** — enter ranges like `00:00 – 00:10`, `00:15 – 00:19`,
  `00:38 – 00:39`, `00:55 – 01:00`; the app extracts each range and concatenates
  them into one video.
- **Optional per-clip downloads** — every segment is also produced as its own
  file, so you can grab individual clips as well as the stitched result.
- **Works with standard formats** — MP4, MKV, MOV, WebM, AVI and more. Every clip
  is normalized to H.264/AAC MP4 so the pieces splice together cleanly regardless
  of the source container.
- **Timeline helpers** — scrub the built-in player and capture the playhead as a
  segment's start/end, seek to a segment, or preview just that range.
- **Flexible timestamps** — accepts `ss`, `mm:ss`, or `hh:mm:ss`, with optional
  fractional seconds (e.g. `01:23.5`). Paste several ranges at once.
- **Session history** — every splice is saved (source metadata + timestamps +
  output name) to `localStorage` so you can revisit and re-edit past sessions.
- **Missing-source handling** — source files themselves aren't stored. Reopening
  a saved session shows a clear warning and lets you reselect the source video to
  keep editing its timestamps.

## How it works

For each session the pipeline:

1. Loads the uploaded file into ffmpeg's in-memory filesystem.
2. Re-encodes each `[start, end]` range into a normalized MP4 clip (frame-accurate
   cuts, consistent codec parameters). These are the optional per-clip downloads.
3. Concatenates the normalized clips with the ffmpeg concat demuxer using stream
   copy (fast, lossless) into the final spliced output.

## Getting started

```bash
npm install        # also copies the ffmpeg core into public/ffmpeg
npm run dev        # start the dev server at http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

The ffmpeg WebAssembly core (`@ffmpeg/core`) is copied into `public/ffmpeg/`
by `scripts/copy-ffmpeg-core.mjs` (run automatically before `dev` and `build`),
so the engine loads from the app's own origin without depending on a CDN.

## Tech stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS
- `@ffmpeg/ffmpeg` (WebAssembly) for all video processing
- `localStorage` for session history

## Notes & limitations

- Processing happens on the user's device, so large videos take longer and use
  more memory than a server-side encoder would.
- The first render downloads the ffmpeg core (~30&nbsp;MB), which is then cached
  by the browser.
- Some containers (e.g. certain `.mkv` files) aren't natively previewable in the
  `<video>` element even though ffmpeg can still process them; in that case the
  duration may show as unknown but clipping still works.
