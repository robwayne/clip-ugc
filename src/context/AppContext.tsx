'use client';

// App-wide state. The workspace holds multiple open editor "tabs", each an
// independent session (its own source video, segments, groups, save state), so
// several videos can be edited simultaneously. History is shared and persists
// via localStorage.
//
// Components read the editor and call mutators through useApp(). Which tab those
// resolve to is determined by the nearest <TabScope> (each mounted tab wraps its
// subtree in one); outside a TabScope they resolve to the active tab. This keeps
// every editor component tab-agnostic.
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClipSession, Group, PersistedAudioSource, Segment, SourceMeta } from '@/lib/types';
import { makeId } from '@/lib/id';
import { nextGroupColor } from '@/lib/groups';
import {
  buildSession,
  deleteSession as deleteFromStore,
  loadHistory,
  upsertSession,
} from '@/lib/history';

export type View = 'editor' | 'history';

/** A source video open in the editor. The File is null when it needs reselecting. */
export interface EditorSource {
  id: string;
  meta: SourceMeta;
  file: File | null;
}

/** The session's background-audio track source (one at a time). */
export type EditorAudioSource =
  | { kind: 'video'; sourceId: string }
  | { kind: 'file'; id: string; meta: SourceMeta; file: File | null };

interface EditorState {
  /** Stable identity of this open tab (distinct from sessionId). */
  tabId: string;
  sessionId: string;
  createdAt: number;
  title: string;
  sources: EditorSource[];
  /** Which source new segments default to (like the active group). */
  activeSourceId: string | null;
  /** Background-audio track source, or null. */
  audioSource: EditorAudioSource | null;
  segments: Segment[];
  groups: Group[];
  activeGroupId: string | null;
  selectedSegmentId: string | null;
  openSegmentId: string | null;
  lastClosedSegmentId: string | null;
  savedSnapshot: string | null;
}

/** Lightweight tab descriptor for the tab bar. */
export interface TabMeta {
  tabId: string;
  title: string;
  isDirty: boolean;
  hasSource: boolean;
}

function serializeForSave(e: EditorState): string {
  return JSON.stringify({
    title: e.title.trim(),
    sources: e.sources.map((s) => ({ id: s.id, name: s.meta.name, size: s.meta.size })),
    audioSource: audioSourceKey(e.audioSource),
    segments: e.segments.map((s) => ({
      start: s.start,
      end: s.end,
      groupId: s.groupId,
      sourceId: s.sourceId,
    })),
    groups: e.groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      audio: g.audio ?? null,
    })),
  });
}

function audioSourceKey(a: EditorAudioSource | null): unknown {
  if (!a) return null;
  return a.kind === 'video' ? { kind: 'video', sourceId: a.sourceId } : { kind: 'file', id: a.id };
}

function toPersistedAudio(a: EditorAudioSource | null): PersistedAudioSource | null {
  if (!a) return null;
  return a.kind === 'video'
    ? { kind: 'video', sourceId: a.sourceId }
    : { kind: 'file', id: a.id, meta: a.meta };
}

function computeDirty(e: EditorState): boolean {
  return e.savedSnapshot === null
    ? e.sources.length > 0 && (e.segments.length > 0 || e.title.trim() !== '')
    : serializeForSave(e) !== e.savedSnapshot;
}

function emptyEditor(): EditorState {
  return {
    tabId: makeId(),
    sessionId: makeId(),
    createdAt: Date.now(),
    title: '',
    sources: [],
    activeSourceId: null,
    audioSource: null,
    segments: [],
    groups: [],
    activeGroupId: null,
    selectedSegmentId: null,
    openSegmentId: null,
    lastClosedSegmentId: null,
    savedSnapshot: null,
  };
}

const MIN_SEGMENT = 0.05;
/** Maximum number of source videos allowed per session. */
export const MAX_SOURCES = 4;

/** The public surface, resolved to a specific tab by useApp(). */
interface AppContextValue {
  view: View;
  setView: (v: View) => void;

  // Tabs
  tabs: TabMeta[];
  activeTabId: string;
  tabId: string;
  setActiveTab: (id: string) => void;
  newTab: () => void;
  closeTab: (id: string) => void;

  editor: EditorState;
  setTitle: (title: string) => void;
  // Sources
  addSource: (file: File, meta: SourceMeta) => string;
  replaceSourceFile: (sourceId: string, file: File, meta: SourceMeta) => void;
  removeSource: (sourceId: string) => void;
  setActiveSource: (sourceId: string) => void;

  // Background audio track source
  setAudioTrackVideo: (sourceId: string) => void;
  setAudioTrackFile: (file: File, meta: SourceMeta) => void;
  replaceAudioTrackFile: (file: File, meta: SourceMeta) => void;
  clearAudioTrack: () => void;
  setGroupAudio: (groupId: string, audio: { start: number; end: number } | null) => void;

  addSegment: (segment?: Partial<Segment>) => string;
  updateSegment: (id: string, patch: Partial<Segment>) => void;
  removeSegment: (id: string) => void;
  duplicateSegment: (id: string) => void;
  moveSegmentWithinGroup: (id: string, direction: -1 | 1) => void;
  moveSegmentBefore: (dragId: string, targetId: string) => void;
  setSelectedSegment: (id: string | null) => void;
  markStart: (time: number) => void;
  markEnd: (time: number) => void;

  addGroup: (name?: string) => string;
  renameGroup: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  setActiveGroup: (id: string | null) => void;

  history: ClipSession[];
  saveProject: () => void;
  saveAsVariation: (name: string) => void;
  openSession: (session: ClipSession) => void;
  deleteSession: (id: string) => void;

  needsReselect: boolean;
  isDirty: boolean;
  existsInHistory: boolean;
}

/** Raw provider value: mutators take a tabId; useApp() binds them. */
interface RawContextValue {
  view: View;
  setView: (v: View) => void;
  tabs: EditorState[];
  activeTabId: string;
  setActiveTab: (id: string) => void;
  newTab: () => void;
  closeTab: (id: string) => void;
  history: ClipSession[];
  openSession: (session: ClipSession) => void;
  deleteSession: (id: string) => void;
  m: TabMutators;
}

/** Per-tab mutators, all taking the target tabId first. */
interface TabMutators {
  setTitle: (tabId: string, title: string) => void;
  addSource: (tabId: string, file: File, meta: SourceMeta) => string;
  replaceSourceFile: (tabId: string, sourceId: string, file: File, meta: SourceMeta) => void;
  removeSource: (tabId: string, sourceId: string) => void;
  setActiveSource: (tabId: string, sourceId: string) => void;
  setAudioTrackVideo: (tabId: string, sourceId: string) => void;
  setAudioTrackFile: (tabId: string, file: File, meta: SourceMeta) => void;
  replaceAudioTrackFile: (tabId: string, file: File, meta: SourceMeta) => void;
  clearAudioTrack: (tabId: string) => void;
  setGroupAudio: (tabId: string, groupId: string, audio: { start: number; end: number } | null) => void;
  addSegment: (tabId: string, segment?: Partial<Segment>) => string;
  updateSegment: (tabId: string, id: string, patch: Partial<Segment>) => void;
  removeSegment: (tabId: string, id: string) => void;
  duplicateSegment: (tabId: string, id: string) => void;
  moveSegmentWithinGroup: (tabId: string, id: string, direction: -1 | 1) => void;
  moveSegmentBefore: (tabId: string, dragId: string, targetId: string) => void;
  setSelectedSegment: (tabId: string, id: string | null) => void;
  markStart: (tabId: string, time: number) => void;
  markEnd: (tabId: string, time: number) => void;
  addGroup: (tabId: string, name?: string) => string;
  renameGroup: (tabId: string, id: string, name: string) => void;
  removeGroup: (tabId: string, id: string) => void;
  setActiveGroup: (tabId: string, id: string | null) => void;
  saveProject: (tabId: string) => void;
  saveAsVariation: (tabId: string, name: string) => void;
}

const RawContext = createContext<RawContextValue | null>(null);
/** Scopes the subtree's useApp() to a specific tab. */
export const TabScope = createContext<string | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('editor');
  const [tabs, setTabs] = useState<EditorState[]>(() => [emptyEditor()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].tabId);
  const [history, setHistory] = useState<ClipSession[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const updateTab = useCallback(
    (tabId: string, fn: (e: EditorState) => EditorState) => {
      setTabs((ts) => ts.map((t) => (t.tabId === tabId ? fn(t) : t)));
    },
    []
  );

  // ---- Tab management ----
  const setActiveTab = useCallback((id: string) => setActiveTabId(id), []);

  const newTab = useCallback(() => {
    const tab = emptyEditor();
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(tab.tabId);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.tabId === id);
      if (idx < 0) return ts;
      const next = ts.filter((t) => t.tabId !== id);
      const list = next.length > 0 ? next : [emptyEditor()];
      // Move active selection if we closed the active tab.
      setActiveTabId((current) => {
        if (current !== id) return current;
        const neighbor = list[Math.min(idx, list.length - 1)];
        return neighbor.tabId;
      });
      return list;
    });
  }, []);

  // ---- Editor mutators (tabId-scoped) ----
  const setTitle = useCallback(
    (tabId: string, title: string) => updateTab(tabId, (e) => ({ ...e, title })),
    [updateTab]
  );

  const addSource = useCallback(
    (tabId: string, file: File, meta: SourceMeta) => {
      const id = makeId();
      updateTab(tabId, (e) => {
        if (e.sources.length >= MAX_SOURCES) return e; // cap reached
        return {
          ...e,
          sources: [...e.sources, { id, meta, file }],
          activeSourceId: id,
          title: e.title.trim() === '' && e.sources.length === 0 ? meta.name : e.title,
        };
      });
      return id;
    },
    [updateTab]
  );

  const replaceSourceFile = useCallback(
    (tabId: string, sourceId: string, file: File, meta: SourceMeta) =>
      updateTab(tabId, (e) => ({
        ...e,
        sources: e.sources.map((s) => (s.id === sourceId ? { ...s, file, meta } : s)),
      })),
    [updateTab]
  );

  const removeSource = useCallback(
    (tabId: string, sourceId: string) =>
      updateTab(tabId, (e) => {
        const sources = e.sources.filter((s) => s.id !== sourceId);
        // Segments cut from the removed source are dropped with it.
        const segments = e.segments.filter((s) => s.sourceId !== sourceId);
        const activeSourceId =
          e.activeSourceId === sourceId ? sources[0]?.id ?? null : e.activeSourceId;
        // If the audio track was extracted from this video, drop it too.
        const audioSource =
          e.audioSource?.kind === 'video' && e.audioSource.sourceId === sourceId
            ? null
            : e.audioSource;
        return { ...e, sources, segments, activeSourceId, audioSource };
      }),
    [updateTab]
  );

  const setActiveSource = useCallback(
    (tabId: string, sourceId: string) =>
      updateTab(tabId, (e) => ({ ...e, activeSourceId: sourceId })),
    [updateTab]
  );

  const setAudioTrackVideo = useCallback(
    (tabId: string, sourceId: string) =>
      updateTab(tabId, (e) => ({ ...e, audioSource: { kind: 'video', sourceId } })),
    [updateTab]
  );

  const setAudioTrackFile = useCallback(
    (tabId: string, file: File, meta: SourceMeta) =>
      updateTab(tabId, (e) => ({
        ...e,
        audioSource: { kind: 'file', id: makeId(), meta, file },
      })),
    [updateTab]
  );

  const replaceAudioTrackFile = useCallback(
    (tabId: string, file: File, meta: SourceMeta) =>
      updateTab(tabId, (e) => {
        if (e.audioSource?.kind !== 'file') return e;
        return { ...e, audioSource: { ...e.audioSource, file, meta } };
      }),
    [updateTab]
  );

  const clearAudioTrack = useCallback(
    (tabId: string) =>
      updateTab(tabId, (e) => ({
        ...e,
        audioSource: null,
        // Drop any per-group audio segments — they referenced the old source.
        groups: e.groups.map((g) => ({ ...g, audio: null })),
      })),
    [updateTab]
  );

  const setGroupAudio = useCallback(
    (tabId: string, groupId: string, audio: { start: number; end: number } | null) =>
      updateTab(tabId, (e) => ({
        ...e,
        groups: e.groups.map((g) => (g.id === groupId ? { ...g, audio } : g)),
      })),
    [updateTab]
  );

  const addSegment = useCallback(
    (tabId: string, segment?: Partial<Segment>) => {
      const id = makeId();
      updateTab(tabId, (e) => {
        if (!e.activeSourceId && segment?.sourceId == null) return e; // no source to cut from
        const sourceId = segment?.sourceId ?? e.activeSourceId!;
        const groupId = segment?.groupId !== undefined ? segment.groupId : e.activeGroupId;
        const siblings = e.segments.filter(
          (s) => s.groupId === groupId && s.sourceId === sourceId
        );
        const last = siblings[siblings.length - 1];
        const defaultStart = segment?.start ?? (last ? last.end : 0);
        const defaultEnd = segment?.end ?? defaultStart + 5;
        const newSeg: Segment = {
          id,
          start: defaultStart,
          end: defaultEnd,
          groupId: groupId ?? null,
          sourceId,
        };
        return { ...e, segments: [...e.segments, newSeg], selectedSegmentId: id };
      });
      return id;
    },
    [updateTab]
  );

  const updateSegment = useCallback(
    (tabId: string, id: string, patch: Partial<Segment>) =>
      updateTab(tabId, (e) => ({
        ...e,
        segments: e.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),
    [updateTab]
  );

  const removeSegment = useCallback(
    (tabId: string, id: string) =>
      updateTab(tabId, (e) => ({
        ...e,
        segments: e.segments.filter((s) => s.id !== id),
        selectedSegmentId: e.selectedSegmentId === id ? null : e.selectedSegmentId,
        openSegmentId: e.openSegmentId === id ? null : e.openSegmentId,
        lastClosedSegmentId: e.lastClosedSegmentId === id ? null : e.lastClosedSegmentId,
      })),
    [updateTab]
  );

  const duplicateSegment = useCallback(
    (tabId: string, id: string) => {
      const newId = makeId();
      updateTab(tabId, (e) => {
        const idx = e.segments.findIndex((s) => s.id === id);
        if (idx < 0) return e;
        const copy: Segment = { ...e.segments[idx], id: newId };
        const segments = [...e.segments];
        segments.splice(idx + 1, 0, copy);
        return { ...e, segments, selectedSegmentId: newId };
      });
    },
    [updateTab]
  );

  const moveSegmentWithinGroup = useCallback(
    (tabId: string, id: string, direction: -1 | 1) =>
      updateTab(tabId, (e) => {
        const idx = e.segments.findIndex((s) => s.id === id);
        if (idx < 0) return e;
        const groupId = e.segments[idx].groupId;
        let swapIdx = -1;
        for (let j = idx + direction; j >= 0 && j < e.segments.length; j += direction) {
          if (e.segments[j].groupId === groupId) {
            swapIdx = j;
            break;
          }
        }
        if (swapIdx < 0) return e;
        const segments = [...e.segments];
        [segments[idx], segments[swapIdx]] = [segments[swapIdx], segments[idx]];
        return { ...e, segments };
      }),
    [updateTab]
  );

  const moveSegmentBefore = useCallback(
    (tabId: string, dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      updateTab(tabId, (e) => {
        const segs = [...e.segments];
        const from = segs.findIndex((s) => s.id === dragId);
        if (from < 0) return e;
        const [moved] = segs.splice(from, 1);
        const to = segs.findIndex((s) => s.id === targetId);
        if (to < 0) return e;
        segs.splice(to, 0, moved);
        return { ...e, segments: segs };
      });
    },
    [updateTab]
  );

  const setSelectedSegment = useCallback(
    (tabId: string, id: string | null) =>
      updateTab(tabId, (e) => ({ ...e, selectedSegmentId: id })),
    [updateTab]
  );

  const markStart = useCallback(
    (tabId: string, time: number) => {
      const id = makeId();
      updateTab(tabId, (e) => {
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
        if (!e.activeSourceId) return e; // nothing to cut from
        const prev = e.segments[e.segments.length - 1];
        const groupId = prev ? prev.groupId : e.activeGroupId;
        const newSeg: Segment = {
          id,
          start: time,
          end: time + MIN_SEGMENT,
          groupId: groupId ?? null,
          sourceId: e.activeSourceId,
        };
        return { ...e, segments: [...e.segments, newSeg], openSegmentId: id, selectedSegmentId: id };
      });
    },
    [updateTab]
  );

  const markEnd = useCallback(
    (tabId: string, time: number) =>
      updateTab(tabId, (e) => {
        if (e.openSegmentId) {
          const openId = e.openSegmentId;
          return {
            ...e,
            segments: e.segments.map((s) =>
              s.id === openId ? { ...s, end: Math.max(time, s.start + MIN_SEGMENT) } : s
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
              s.id === lastId ? { ...s, end: Math.max(time, s.start + MIN_SEGMENT) } : s
            ),
            selectedSegmentId: lastId,
          };
        }
        return e;
      }),
    [updateTab]
  );

  const addGroup = useCallback(
    (tabId: string, name?: string) => {
      const id = makeId();
      updateTab(tabId, (e) => {
        const group: Group = {
          id,
          name: name?.trim() || `Group ${e.groups.length + 1}`,
          color: nextGroupColor(e.groups),
        };
        return { ...e, groups: [...e.groups, group], activeGroupId: id };
      });
      return id;
    },
    [updateTab]
  );

  const renameGroup = useCallback(
    (tabId: string, id: string, name: string) =>
      updateTab(tabId, (e) => ({
        ...e,
        groups: e.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      })),
    [updateTab]
  );

  const removeGroup = useCallback(
    (tabId: string, id: string) =>
      updateTab(tabId, (e) => ({
        ...e,
        groups: e.groups.filter((g) => g.id !== id),
        segments: e.segments.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
        activeGroupId: e.activeGroupId === id ? null : e.activeGroupId,
      })),
    [updateTab]
  );

  const setActiveGroup = useCallback(
    (tabId: string, id: string | null) =>
      updateTab(tabId, (e) => ({ ...e, activeGroupId: id })),
    [updateTab]
  );

  const saveProject = useCallback(
    (tabId: string) => {
      updateTab(tabId, (e) => {
        if (e.sources.length === 0) return e;
        const title = e.title.trim() || e.sources[0].meta.name;
        const session = buildSession({
          id: e.sessionId,
          createdAt: e.createdAt,
          title,
          sources: e.sources.map((s) => ({ id: s.id, meta: s.meta })),
          audioSource: toPersistedAudio(e.audioSource),
          segments: e.segments,
          groups: e.groups,
          outputName: `${title}.mp4`,
        });
        setHistory(upsertSession(session));
        const saved = { ...e, title };
        return { ...saved, savedSnapshot: serializeForSave(saved) };
      });
    },
    [updateTab]
  );

  const saveAsVariation = useCallback(
    (tabId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const newId = makeId();
      const now = Date.now();
      updateTab(tabId, (e) => {
        if (e.sources.length === 0) return e;
        const forked = { ...e, sessionId: newId, createdAt: now, title: trimmed };
        const session = buildSession({
          id: newId,
          createdAt: now,
          title: trimmed,
          sources: e.sources.map((s) => ({ id: s.id, meta: s.meta })),
          audioSource: toPersistedAudio(e.audioSource),
          segments: e.segments,
          groups: e.groups,
          outputName: `${trimmed}.mp4`,
        });
        setHistory(upsertSession(session));
        return { ...forked, savedSnapshot: serializeForSave(forked) };
      });
    },
    [updateTab]
  );

  // ---- History ----
  const openSession = useCallback((session: ClipSession) => {
    // Open a saved session in its own new tab, preserving other open work.
    const sources: EditorSource[] = (session.sources ?? []).map((s) => ({
      id: s.id,
      meta: s.meta,
      file: null,
    }));
    const savedAudio = session.audioSource ?? null;
    const audioSource: EditorAudioSource | null = !savedAudio
      ? null
      : savedAudio.kind === 'video'
      ? { kind: 'video', sourceId: savedAudio.sourceId }
      : { kind: 'file', id: savedAudio.id, meta: savedAudio.meta, file: null };
    const opened: EditorState = {
      tabId: makeId(),
      sessionId: session.id,
      createdAt: session.createdAt,
      title: session.title,
      sources,
      activeSourceId: sources[0]?.id ?? null,
      audioSource,
      groups: (session.groups ?? []).map((g) => ({ ...g })),
      segments: session.segments.map((s) => ({
        id: makeId(),
        start: s.start,
        end: s.end,
        groupId: s.groupId ?? null,
        sourceId: s.sourceId,
      })),
      activeGroupId: null,
      selectedSegmentId: null,
      openSegmentId: null,
      lastClosedSegmentId: null,
      savedSnapshot: null,
    };
    const withSnapshot = { ...opened, savedSnapshot: serializeForSave(opened) };
    setTabs((ts) => [...ts, withSnapshot]);
    setActiveTabId(withSnapshot.tabId);
    setView('editor');
  }, []);

  const deleteSession = useCallback((id: string) => {
    setHistory(deleteFromStore(id));
  }, []);

  const mutators = useMemo<TabMutators>(
    () => ({
      setTitle,
      addSource,
      replaceSourceFile,
      removeSource,
      setActiveSource,
      setAudioTrackVideo,
      setAudioTrackFile,
      replaceAudioTrackFile,
      clearAudioTrack,
      setGroupAudio,
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
      saveProject,
      saveAsVariation,
    }),
    [
      setTitle,
      addSource,
      replaceSourceFile,
      removeSource,
      setActiveSource,
      setAudioTrackVideo,
      setAudioTrackFile,
      replaceAudioTrackFile,
      clearAudioTrack,
      setGroupAudio,
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
      saveProject,
      saveAsVariation,
    ]
  );

  const raw = useMemo<RawContextValue>(
    () => ({
      view,
      setView,
      tabs,
      activeTabId,
      setActiveTab,
      newTab,
      closeTab,
      history,
      openSession,
      deleteSession,
      m: mutators,
    }),
    [
      view,
      tabs,
      activeTabId,
      setActiveTab,
      newTab,
      closeTab,
      history,
      openSession,
      deleteSession,
      mutators,
    ]
  );

  return <RawContext.Provider value={raw}>{children}</RawContext.Provider>;
}

export function useApp(): AppContextValue {
  const raw = useContext(RawContext);
  if (!raw) throw new Error('useApp must be used within an AppProvider');
  const scoped = useContext(TabScope);
  const tabId = scoped ?? raw.activeTabId;
  const editor =
    raw.tabs.find((t) => t.tabId === tabId) ??
    raw.tabs.find((t) => t.tabId === raw.activeTabId) ??
    raw.tabs[0];
  const { m } = raw;

  const tabsMeta = useMemo<TabMeta[]>(
    () =>
      raw.tabs.map((t) => ({
        tabId: t.tabId,
        title: t.title.trim() || (t.sources[0] ? t.sources[0].meta.name : 'Untitled'),
        isDirty: computeDirty(t),
        hasSource: t.sources.length > 0,
      })),
    [raw.tabs]
  );

  return useMemo<AppContextValue>(
    () => ({
      view: raw.view,
      setView: raw.setView,
      tabs: tabsMeta,
      activeTabId: raw.activeTabId,
      tabId: editor.tabId,
      setActiveTab: raw.setActiveTab,
      newTab: raw.newTab,
      closeTab: raw.closeTab,
      editor,
      setTitle: (title) => m.setTitle(editor.tabId, title),
      addSource: (file, meta) => m.addSource(editor.tabId, file, meta),
      replaceSourceFile: (sourceId, file, meta) =>
        m.replaceSourceFile(editor.tabId, sourceId, file, meta),
      removeSource: (sourceId) => m.removeSource(editor.tabId, sourceId),
      setActiveSource: (sourceId) => m.setActiveSource(editor.tabId, sourceId),
      setAudioTrackVideo: (sourceId) => m.setAudioTrackVideo(editor.tabId, sourceId),
      setAudioTrackFile: (file, meta) => m.setAudioTrackFile(editor.tabId, file, meta),
      replaceAudioTrackFile: (file, meta) => m.replaceAudioTrackFile(editor.tabId, file, meta),
      clearAudioTrack: () => m.clearAudioTrack(editor.tabId),
      setGroupAudio: (groupId, audio) => m.setGroupAudio(editor.tabId, groupId, audio),
      addSegment: (segment) => m.addSegment(editor.tabId, segment),
      updateSegment: (id, patch) => m.updateSegment(editor.tabId, id, patch),
      removeSegment: (id) => m.removeSegment(editor.tabId, id),
      duplicateSegment: (id) => m.duplicateSegment(editor.tabId, id),
      moveSegmentWithinGroup: (id, dir) => m.moveSegmentWithinGroup(editor.tabId, id, dir),
      moveSegmentBefore: (dragId, targetId) =>
        m.moveSegmentBefore(editor.tabId, dragId, targetId),
      setSelectedSegment: (id) => m.setSelectedSegment(editor.tabId, id),
      markStart: (time) => m.markStart(editor.tabId, time),
      markEnd: (time) => m.markEnd(editor.tabId, time),
      addGroup: (name) => m.addGroup(editor.tabId, name),
      renameGroup: (id, name) => m.renameGroup(editor.tabId, id, name),
      removeGroup: (id) => m.removeGroup(editor.tabId, id),
      setActiveGroup: (id) => m.setActiveGroup(editor.tabId, id),
      history: raw.history,
      saveProject: () => m.saveProject(editor.tabId),
      saveAsVariation: (name) => m.saveAsVariation(editor.tabId, name),
      openSession: raw.openSession,
      deleteSession: raw.deleteSession,
      needsReselect: editor.sources.some((s) => s.file === null),
      isDirty: computeDirty(editor),
      existsInHistory: raw.history.some((s) => s.id === editor.sessionId),
    }),
    [raw, editor, tabsMeta, m]
  );
}
