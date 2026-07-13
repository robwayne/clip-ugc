// Persistence of clipping sessions in localStorage.
//
// Only metadata is stored (source name/size/duration, timestamp segments,
// output name, timestamps). The actual video files are never persisted, so a
// reopened session may need the user to reselect its source file.
import type { ClipSession, Group, Segment, SourceMeta } from './types';
import { makeId } from './id';

const STORAGE_KEY = 'clip-ugc:history:v1';
const MAX_SESSIONS = 100;

export function loadHistory(): ClipSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidSession)
      .map(normalizeSession)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function saveHistory(sessions: ClipSession[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = sessions
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Storage full or unavailable; fail silently but log for debugging.
    console.warn('[history] failed to persist', err);
  }
}

/** Insert or update a session, returning the new full list. */
export function upsertSession(session: ClipSession): ClipSession[] {
  const sessions = loadHistory();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  saveHistory(sessions);
  return loadHistory();
}

export function deleteSession(id: string): ClipSession[] {
  const sessions = loadHistory().filter((s) => s.id !== id);
  saveHistory(sessions);
  return sessions;
}

export function clearHistory(): void {
  saveHistory([]);
}

/** Build a session record from live editor state. */
export function buildSession(params: {
  id?: string;
  title: string;
  source: SourceMeta;
  segments: Segment[];
  groups: Group[];
  outputName: string;
  createdAt?: number;
}): ClipSession {
  const now = Date.now();
  return {
    id: params.id ?? makeId(),
    title: params.title,
    createdAt: params.createdAt ?? now,
    updatedAt: now,
    source: params.source,
    segments: params.segments.map((s) => ({
      start: s.start,
      end: s.end,
      groupId: s.groupId ?? null,
    })),
    groups: params.groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    outputName: params.outputName,
  };
}

/** Backfill fields added after the first schema version. */
function normalizeSession(session: ClipSession): ClipSession {
  const groups = Array.isArray(session.groups) ? session.groups : [];
  return {
    ...session,
    groups,
    segments: session.segments.map((s) => ({
      start: s.start,
      end: s.end,
      groupId: (s as { groupId?: string | null }).groupId ?? null,
    })),
  };
}

function isValidSession(value: unknown): value is ClipSession {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number' &&
    typeof s.source === 'object' &&
    Array.isArray(s.segments)
  );
}
