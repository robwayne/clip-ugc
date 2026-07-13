// Shared domain types for the clipping pipeline.

/** A single trim range on the source timeline, in seconds. */
export interface Segment {
  id: string;
  start: number;
  end: number;
  /** Group this segment belongs to, or null when ungrouped. */
  groupId: string | null;
}

/** A named, colored bucket that segments can be assigned to. */
export interface Group {
  id: string;
  name: string;
  /** Hex color used on the timeline and in the UI. */
  color: string;
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
  segments: Array<{ start: number; end: number; groupId: string | null }>;
  groups: Group[];
  outputName: string;
}

/** A produced clip (single trimmed segment) available for optional download. */
export interface RenderedClip {
  index: number;
  start: number;
  end: number;
  groupId: string | null;
  blob: Blob;
  url: string;
  filename: string;
}

/** A produced splice of one bucket (group, or the ungrouped set). */
export interface RenderedBucket {
  groupId: string | null;
  name: string;
  color: string | null;
  segmentCount: number;
  blob: Blob;
  url: string;
  filename: string;
  duration: number;
}

/** The full result of a render. */
export interface RenderResult {
  /** One normalized clip per rendered segment. */
  clips: RenderedClip[];
  /** One splice per bucket (group + trailing ungrouped). */
  buckets: RenderedBucket[];
  /** The single stitched output: all buckets concatenated in order. */
  final: {
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
