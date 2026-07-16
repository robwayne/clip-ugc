'use client';

// App-wide state: the current editor session (source file, segments, groups)
// plus the persisted history. Kept in a context so switching between the Editor
// and History views preserves the in-memory File (letting users retry edits
// without reselecting), while history survives reloads via localStorage.
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClipSession, Group, Segment, SourceMeta } from '@/lib/types';
import { makeId } from '@/lib/id';
import { nextGroupColor } from '@/lib/groups';
import {
  buildSession,
  deleteSession as deleteFromStore,
  loadHistory,
  upsertSession,
} from '@/lib/history';

export type View = 'editor' | 'history';

interface EditorState {
  sessionId: string;
  createdAt: number;
  title: string;
  file: File | null;
  source: SourceMeta | null;
  segments: Segment[];
  groups: Group[];
  /** New segments are assigned to this group (null = ungrouped). */
  activeGroupId: string | null;
  /** Currently highlighted segment (shared between timeline and list). */
  selectedSegmentId: string | null;
  /** Segment currently being recorded via the S key (open, awaiting E). */
  openSegmentId: string | null;
  /** Most recently closed segment, so a repeated E can adjust its end. */
  lastClosedSegmentId: string | null;
}

interface AppContextValue {
  view: View;
  setView: (v: View) => void;

  editor: EditorState;
  setTitle: (title: string) => void;
  setSourceFile: (file: File, source: SourceMeta) => void;
  clearSource: () => void;

  // Segments
  addSegment: (segment?: Partial<Segment>) => string;
  updateSegment: (id: string, patch: Partial<Segment>) => void;
  removeSegment: (id: string) => void;
  duplicateSegment: (id: string) => void;
  moveSegmentWithinGroup: (id: string, direction: -1 | 1) => void;
  moveSegmentBefore: (dragId: string, targetId: string) => void;
  setSelectedSegment: (id: string | null) => void;
  /** S key: open a segment at `time`, or reset the open segment's start. */
  markStart: (time: number) => void;
  /** E key: close the open segment at `time`, or adjust the last one's end. */
  markEnd: (time: number) => void;

  // Groups
  addGroup: (name?: string) => string;
  renameGroup: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  setActiveGroup: (id: string | null) => void;

  resetEditor: () => void;

  history: ClipSession[];
  saveCurrentSession: (outputName?: string) => void;
  openSession: (session: ClipSession) => void;
  deleteSession: (id: string) => void;

  needsReselect: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function emptyEditor(): EditorState {
  return {
    sessionId: makeId(),
    createdAt: Date.now(),
    title: '',
    file: null,
    source: null,
    segments: [],
    groups: [],
    activeGroupId: null,
    selectedSegmentId: null,
    openSegmentId: null,
    lastClosedSegmentId: null,
  };
}

/** Minimum clip length used when opening/adjusting via keyboard. */
const MIN_SEGMENT = 0.05;

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('editor');
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [history, setHistory] = useState<ClipSession[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const setTitle = useCallback((title: string) => {
    setEditor((e) => ({ ...e, title }));
  }, []);

  const setSourceFile = useCallback((file: File, source: SourceMeta) => {
    setEditor((e) => ({
      ...e,
      file,
      source,
      title: e.title.trim() === '' ? source.name : e.title,
    }));
  }, []);

  const clearSource = useCallback(() => {
    setEditor((e) => ({ ...e, file: null }));
  }, []);

  const addSegment = useCallback((segment?: Partial<Segment>) => {
    const id = makeId();
    setEditor((e) => {
      const groupId =
        segment?.groupId !== undefined ? segment.groupId : e.activeGroupId;
      const siblings = e.segments.filter((s) => s.groupId === groupId);
      const last = siblings[siblings.length - 1];
      const defaultStart = segment?.start ?? (last ? last.end : 0);
      const defaultEnd = segment?.end ?? defaultStart + 5;
      const newSeg: Segment = {
        id,
        start: defaultStart,
        end: defaultEnd,
        groupId: groupId ?? null,
      };
      return { ...e, segments: [...e.segments, newSeg], selectedSegmentId: id };
    });
    return id;
  }, []);

  const updateSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setEditor((e) => ({
      ...e,
      segments: e.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeSegment = useCallback((id: string) => {
    setEditor((e) => ({
      ...e,
      segments: e.segments.filter((s) => s.id !== id),
      selectedSegmentId: e.selectedSegmentId === id ? null : e.selectedSegmentId,
      openSegmentId: e.openSegmentId === id ? null : e.openSegmentId,
      lastClosedSegmentId: e.lastClosedSegmentId === id ? null : e.lastClosedSegmentId,
    }));
  }, []);

  // S key. When a segment is already open, reset its start; otherwise open a
  // new segment at `time`, inheriting the group of the most recent segment.
  const markStart = useCallback((time: number) => {
    const id = makeId();
    setEditor((e) => {
      if (e.openSegmentId) {
        return {
          ...e,
          segments: e.segments.map((s) =>
            s.id === e.openSegmentId
              ? { ...s, start: time, end: Math.max(s.end, time + MIN_SEGMENT) }
              : s
          ),
        };
      }
      const prev = e.segments[e.segments.length - 1];
      const groupId = prev ? prev.groupId : e.activeGroupId;
      const newSeg: Segment = {
        id,
        start: time,
        end: time + MIN_SEGMENT,
        groupId: groupId ?? null,
      };
      return {
        ...e,
        segments: [...e.segments, newSeg],
        openSegmentId: id,
        selectedSegmentId: id,
      };
    });
  }, []);

  // E key. Close the open segment at `time`; if none is open, adjust the end of
  // the most recently closed segment instead.
  const markEnd = useCallback((time: number) => {
    setEditor((e) => {
      if (e.openSegmentId) {
        const openId = e.openSegmentId;
        return {
          ...e,
          segments: e.segments.map((s) =>
            s.id === openId
              ? { ...s, end: Math.max(time, s.start + MIN_SEGMENT) }
              : s
          ),
          openSegmentId: null,
          lastClosedSegmentId: openId,
          selectedSegmentId: openId,
        };
      }
      if (e.lastClosedSegmentId) {
        const lastId = e.lastClosedSegmentId;
        return {
          ...e,
          segments: e.segments.map((s) =>
            s.id === lastId
              ? { ...s, end: Math.max(time, s.start + MIN_SEGMENT) }
              : s
          ),
          selectedSegmentId: lastId,
        };
      }
      return e;
    });
  }, []);

  const duplicateSegment = useCallback((id: string) => {
    const newId = makeId();
    setEditor((e) => {
      const idx = e.segments.findIndex((s) => s.id === id);
      if (idx < 0) return e;
      const original = e.segments[idx];
      const copy: Segment = { ...original, id: newId };
      const segments = [...e.segments];
      segments.splice(idx + 1, 0, copy);
      return { ...e, segments, selectedSegmentId: newId };
    });
  }, []);

  const moveSegmentWithinGroup = useCallback((id: string, direction: -1 | 1) => {
    setEditor((e) => {
      const idx = e.segments.findIndex((s) => s.id === id);
      if (idx < 0) return e;
      const groupId = e.segments[idx].groupId;
      // Find the neighbor in the same group in the given direction.
      let swapIdx = -1;
      for (
        let j = idx + direction;
        j >= 0 && j < e.segments.length;
        j += direction
      ) {
        if (e.segments[j].groupId === groupId) {
          swapIdx = j;
          break;
        }
      }
      if (swapIdx < 0) return e;
      const segments = [...e.segments];
      [segments[idx], segments[swapIdx]] = [segments[swapIdx], segments[idx]];
      return { ...e, segments };
    });
  }, []);

  // Reorder by dropping `dragId` immediately before `targetId` in the global
  // segment array. Used for drag-and-drop reordering within a group; because
  // both belong to the same group, this only changes their relative order.
  const moveSegmentBefore = useCallback((dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    setEditor((e) => {
      const segs = [...e.segments];
      const from = segs.findIndex((s) => s.id === dragId);
      if (from < 0) return e;
      const [moved] = segs.splice(from, 1);
      const to = segs.findIndex((s) => s.id === targetId);
      if (to < 0) return e;
      segs.splice(to, 0, moved);
      return { ...e, segments: segs };
    });
  }, []);

  const setSelectedSegment = useCallback((id: string | null) => {
    setEditor((e) => ({ ...e, selectedSegmentId: id }));
  }, []);

  const addGroup = useCallback((name?: string) => {
    const id = makeId();
    setEditor((e) => {
      const group: Group = {
        id,
        name: name?.trim() || `Group ${e.groups.length + 1}`,
        color: nextGroupColor(e.groups),
      };
      return { ...e, groups: [...e.groups, group], activeGroupId: id };
    });
    return id;
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setEditor((e) => ({
      ...e,
      groups: e.groups.map((g) => (g.id === id ? { ...g, name } : g)),
    }));
  }, []);

  const removeGroup = useCallback((id: string) => {
    setEditor((e) => ({
      ...e,
      groups: e.groups.filter((g) => g.id !== id),
      // Segments in the removed group fall back to ungrouped.
      segments: e.segments.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
      activeGroupId: e.activeGroupId === id ? null : e.activeGroupId,
    }));
  }, []);

  const setActiveGroup = useCallback((id: string | null) => {
    setEditor((e) => ({ ...e, activeGroupId: id }));
  }, []);

  const resetEditor = useCallback(() => {
    setEditor(emptyEditor());
  }, []);

  const saveCurrentSession = useCallback((outputName?: string) => {
    setEditor((e) => {
      if (!e.source) return e;
      const session = buildSession({
        id: e.sessionId,
        createdAt: e.createdAt,
        title: e.title.trim() || e.source.name,
        source: e.source,
        segments: e.segments,
        groups: e.groups,
        outputName: outputName ?? `${e.title.trim() || 'output'}.mp4`,
      });
      setHistory(upsertSession(session));
      return e;
    });
  }, []);

  const openSession = useCallback((session: ClipSession) => {
    setEditor((prev) => {
      const keepFile =
        prev.file &&
        prev.source &&
        prev.source.name === session.source.name &&
        prev.source.size === session.source.size
          ? prev.file
          : null;
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
        title: session.title,
        file: keepFile,
        source: session.source,
        groups: (session.groups ?? []).map((g) => ({ ...g })),
        segments: session.segments.map((s) => ({
          id: makeId(),
          start: s.start,
          end: s.end,
          groupId: s.groupId ?? null,
        })),
        activeGroupId: null,
        selectedSegmentId: null,
        openSegmentId: null,
        lastClosedSegmentId: null,
      };
    });
    setView('editor');
  }, []);

  const deleteSession = useCallback((id: string) => {
    setHistory(deleteFromStore(id));
  }, []);

  const needsReselect = editor.source !== null && editor.file === null;

  const value = useMemo<AppContextValue>(
    () => ({
      view,
      setView,
      editor,
      setTitle,
      setSourceFile,
      clearSource,
      addSegment,
      updateSegment,
      removeSegment,
      duplicateSegment,
      moveSegmentWithinGroup,
      moveSegmentBefore,
      setSelectedSegment,
      markStart,
      markEnd,
      addGroup,
      renameGroup,
      removeGroup,
      setActiveGroup,
      resetEditor,
      history,
      saveCurrentSession,
      openSession,
      deleteSession,
      needsReselect,
    }),
    [
      view,
      editor,
      setTitle,
      setSourceFile,
      clearSource,
      addSegment,
      updateSegment,
      removeSegment,
      duplicateSegment,
      moveSegmentWithinGroup,
      moveSegmentBefore,
      setSelectedSegment,
      markStart,
      markEnd,
      addGroup,
      renameGroup,
      removeGroup,
      setActiveGroup,
      resetEditor,
      history,
      saveCurrentSession,
      openSession,
      deleteSession,
      needsReselect,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
