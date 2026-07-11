// Shared domain types for the clipping pipeline.

/** A single trim range on the source timeline, in seconds. */
export interface Segment {
  id: string;
  start: number;
  end: number;
}

/** Metadata about a source video. Files themselves are never persisted. */
export interface SourceMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  /** Duration in seconds, or null if it could not be determined. */
  duration: number | null;
}

/** A persisted clipping session (history entry). */
export interface ClipSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: SourceMeta;
  /** Stored without ids; ids are regenerated when loaded into the editor. */
  segments: Array<{ start: number; end: number }>;
  outputName: string;
}

/** A produced clip (single trimmed segment) available for optional download. */
export interface RenderedClip {
  index: number;
  start: number;
  end: number;
  blob: Blob;
  url: string;
  filename: string;
}

/** The full result of a render: individual clips plus the stitched output. */
export interface RenderResult {
  clips: RenderedClip[];
  output: {
    blob: Blob;
    url: string;
    filename: string;
    duration: number;
  };
}

/** Progress callback payload during rendering. */
export interface RenderProgress {
  /** Overall completion ratio, 0..1. */
  ratio: number;
  /** Human-readable stage description. */
  stage: string;
}
