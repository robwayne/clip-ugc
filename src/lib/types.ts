// Shared domain types for the clipping pipeline.

/** A single trim range on a source video's timeline, in seconds. */
export interface Segment {
  id: string;
  start: number;
  end: number;
  /** Group this segment belongs to, or null when ungrouped. */
  groupId: string | null;
  /** Which source video this segment is cut from. */
  sourceId: string;
}

/** A persisted reference to a source video (metadata only; no file). */
export interface SourceRefMeta {
  id: string;
  meta: SourceMeta;
}

/** A named, colored bucket that segments can be assigned to. */
export interface Group {
  id: string;
  name: string;
  /** Hex color used on the timeline and in the UI. */
  color: string;
  /**
   * Optional background-audio segment (on the audio track source's timeline).
   * When set, this group's video audio is muted and replaced by this segment
   * at splice. Must be long enough to cover the group's total video duration.
   */
  audio?: { start: number; end: number } | null;
}

/** Persisted reference to the session's background-audio track source. */
export type PersistedAudioSource =
  | { kind: 'video'; sourceId: string }
  | { kind: 'file'; id: string; meta: SourceMeta };

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
  /** All source videos used by this session (metadata only). */
  sources: SourceRefMeta[];
  segments: Array<{
    start: number;
    end: number;
    groupId: string | null;
    sourceId: string;
  }>;
  groups: Group[];
  /** The session's background-audio track source, if any. */
  audioSource?: PersistedAudioSource | null;
  outputName: string;
}

/** A produced splice (one group, or the combined final), ready to download. */
export interface SpliceResult {
  blob: Blob;
  url: string;
  filename: string;
  duration: number;
}

/** Progress callback payload during rendering. */
export interface RenderProgress {
  /** Overall completion ratio, 0..1. */
  ratio: number;
  /** Human-readable stage description. */
  stage: string;
}
