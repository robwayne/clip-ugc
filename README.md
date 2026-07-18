# Clip & Splice

A browser-based video **clipping and splicing pipeline**. Upload a source video,
enter timestamp ranges, and the app cuts those ranges out and stitches them into
a single output video — with each group also downloadable as its own splice.

All processing runs **client-side in your browser** using
[`ffmpeg.wasm`](https://ffmpegwasm.netlify.app/). Your videos never leave your
machine, and no server-side storage is required.

## Features

- **Cut & splice** — enter ranges like `00:00 – 00:10`, `00:15 – 00:19`,
  `00:38 – 00:39`, `00:55 – 01:00`; the app extracts each range and concatenates
  them into one video.
- **Multiple source videos** — add up to **4** linked sources to one session and
  combine clips from different videos. Each source gets its **own video player**,
  shown side by side (2 → halves, 3 → thirds, 4 → quarters). New segments default
  to the active source (like the active group); each segment has a source dropdown
  to change which video it's cut from. The timeline follows the active source; a
  group can mix segments from any sources and is spliced into one video. Playback
  (preview, play group, loop) plays each source in its own player, in turn.
- **Multiple tabs** — open several tabs to edit different videos and sessions at
  once. Each tab keeps its own sources, segments, groups, playback, and save
  state; keyboard shortcuts only affect the active tab. Opening a saved session
  from history opens it in its own tab.
- **Visual timeline** — a draggable track under the player: drag empty space to
  create a segment, drag a bar to move it, drag its edges to trim, and click to
  seek. Overlapping segments stack into lanes and are color-coded by group.
- **Keyboard in/out marking** — press <kbd>S</kbd> while the video plays to open a
  segment at the current time and <kbd>E</kbd> to set its end and close it. New
  segments inherit the previous segment's group. Pressing <kbd>S</kbd> again before
  closing resets the open segment's start; pressing <kbd>E</kbd> again after
  closing (before the next <kbd>S</kbd>) adjusts the last segment's end.
- **Groups** — organize segments into named, colored groups. Each group splices
  on its own (individually downloadable), and all groups are stitched together in
  order into the final video. Segments can be duplicated (independent copies), so
  the same clip can appear multiple times within a group. With no groups, all
  segments splice together exactly as before.
- **Reorder & preview** — drag the ⠿ handle (or use the ↑/↓ buttons) to reorder
  clips within a group; that order drives both playback and the final splice.
  Hit **Play group** to preview a group's clips back-to-back — as if already
  concatenated — or **Play all** to preview the whole final splice, without
  rendering anything.
- **Loop** — 🔁 loop any single segment or a whole group so it keeps replaying.
  Only one thing loops at a time; starting a new loop takes over, and the active
  loop is highlighted.
- **Per-segment mute** — 🔊/🔇 mute any individual segment. A muted segment plays
  silently in the preview (its audio drops out for that stretch and returns for the
  next unmuted segment), and its audio is removed from the spliced output — the clip
  is baked with a silent track so it concatenates cleanly with unmuted clips.
- **Background audio per group** — set one **audio track source** for the session
  (audio extracted from one of the source videos, or an uploaded .mp3/.wav). Each
  group can then use a **segment** of it (long enough to cover the group's video
  length) as its background audio: at splice, the group's video audio is muted and
  replaced by that audio segment. Coverage is validated before you can splice.
  Pressing **Play group** on such a group previews the result — the video players
  are muted and the background audio is overlaid across the whole group.
- **Collapsible groups** — each group in the Segments list is an accordion; click
  the ▾/▸ caret to hide or show its segments.
- **Per-group splice & download** (primary flow) — splice and download each
  group on its own, saved using the group name, without processing any other
  group. Each group has its own splice/progress/cancel/download. Combining every
  group into one final video is an **optional** step that reuses the already
  spliced groups when available (fast).
- **Cancel a splice** — stop an in-progress splice at any time; the ffmpeg worker
  is terminated and reloaded for the next run.
- **Cut reuse (caching)** — every cut clip is kept in ffmpeg's memory keyed by
  source + start + end, so an identical cut is reused across groups and repeated
  splices instead of being re-encoded (splicing a group whose cuts already exist
  is near-instant).
- **Time estimate** — splicing shows a live ETA alongside the progress bar and
  percentage.
- **Save & variations** — save the current project to history at any time, or
  **save as variation** to fork the latest edits of a history-opened project into
  a new, differently named session, leaving the original intact.
- **Works with standard formats** — MP4, MKV, MOV, WebM, AVI and more. Every clip
  is normalized to H.264/AAC MP4 so the pieces splice together cleanly regardless
  of the source container.
- **Timeline helpers** — scrub the built-in player and capture the playhead as a
  segment's start/end, seek to a segment, or preview just that range.
- **Flexible timestamps** — accepts `ss`, `mm:ss`, or `hh:mm:ss`, with optional
  fractional seconds (e.g. `01:23.5`). Paste several ranges at once.
- **Session history** — saved projects (source metadata + timestamps + groups)
  live in `localStorage` so you can revisit and re-edit past sessions.
- **Missing-source handling** — source files themselves aren't stored. Reopening
  a saved session shows a clear warning and lets you reselect the source video to
  keep editing its timestamps.

## How it works

The unit of work is a single splice of one group. When you splice a group:

1. Loads the source into ffmpeg's in-memory filesystem (once per run).
2. Re-encodes each of that group's `[start, end]` ranges into a normalized MP4
   clip (frame-accurate cuts, consistent codec parameters). These clips live only
   in ffmpeg's virtual filesystem as concat inputs and are deleted afterwards.
3. Concatenates the clips with the ffmpeg concat demuxer using stream copy (fast,
   lossless) into that group's video, saved by the group name.

Only the group you asked for is processed, so groups can be spliced and
downloaded independently. The optional **Combine all groups** step stitches the
already-spliced group videos together (stream copy) when they're available, and
otherwise splices everything from the source.

Cut clips are cached in ffmpeg's virtual filesystem (keyed by source + start +
end, LRU-capped), so a cut that already exists — in another group or an earlier
splice — is reused rather than re-encoded. The single ffmpeg worker is also
guarded so two tabs can't splice into the same filesystem at once.

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
