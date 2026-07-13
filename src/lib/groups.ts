// Shared logic for organizing segments into render "buckets".
//
// A bucket is one unit that gets spliced together: each group (in group order)
// plus a trailing bucket for any ungrouped segments. Both the renderer and the
// UI use computeBuckets() so ordering and naming always agree.
import type { Group, Segment } from './types';

export interface Bucket {
  groupId: string | null;
  name: string;
  color: string | null;
  segments: Segment[];
}

/** Palette used when creating new groups (cycled by index). */
export const GROUP_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#22c55e', // green
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#ef4444', // red
  '#14b8a6', // teal
];

export function nextGroupColor(existing: Group[]): string {
  return GROUP_COLORS[existing.length % GROUP_COLORS.length];
}

/**
 * Group segments into ordered buckets. Groups come first in their own order,
 * then a single "Ungrouped" bucket for any segment with no group. When there
 * are no groups at all, everything falls into one bucket named "All segments",
 * which reproduces the original flat splice behavior.
 */
export function computeBuckets(segments: Segment[], groups: Group[]): Bucket[] {
  const buckets: Bucket[] = [];

  for (const group of groups) {
    buckets.push({
      groupId: group.id,
      name: group.name,
      color: group.color,
      segments: segments.filter((s) => s.groupId === group.id),
    });
  }

  const ungrouped = segments.filter(
    (s) => s.groupId == null || !groups.some((g) => g.id === s.groupId)
  );
  if (ungrouped.length > 0) {
    buckets.push({
      groupId: null,
      name: groups.length > 0 ? 'Ungrouped' : 'All segments',
      color: null,
      segments: ungrouped,
    });
  }

  return buckets;
}

/** Is a segment a usable clip (positive duration)? */
export function isValidSegment(s: Segment): boolean {
  return Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start;
}

/** Total output seconds across all valid segments. */
export function totalOutputDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => (isValidSegment(s) ? sum + (s.end - s.start) : sum), 0);
}
