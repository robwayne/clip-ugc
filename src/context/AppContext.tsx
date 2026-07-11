'use client';

// App-wide state: the current editor session (source file + segments) plus the
// persisted history. Kept in a context so switching between the Editor and
// History views preserves the in-memory File (letting users retry edits without
// reselecting), while history itself survives reloads via localStorage.
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClipSession, Segment, SourceMeta } from '@/lib/types';
import { makeId } from '@/lib/id';
import {
  buildSession,
  deleteSession as deleteFromStore,
  loadHistory,
  upsertSession,
} from '@/lib/history';

export type View = 'editor' | 'history';

interface EditorState {
  /** Stable id so re-saving updates the same history entry. */
  sessionId: string;
  createdAt: number;
  title: string;
  /** The live source file, if available in this session. */
  file: File | null;
  /** Source metadata (persists even when the file is gone). */
  source: SourceMeta | null;
  segments: Segment[];
}

interface AppContextValue {
  view: View;
  setView: (v: View) => void;

  editor: EditorState;
  setTitle: (title: string) => void;
  setSourceFile: (file: File, source: SourceMeta) => void;
  clearSource: () => void;
  setSegments: (segments: Segment[]) => void;
  addSegment: (segment?: Partial<Segment>) => void;
  updateSegment: (id: string, patch: Partial<Segment>) => void;
  removeSegment: (id: string) => void;
  resetEditor: () => void;

  history: ClipSession[];
  saveCurrentSession: (outputName?: string) => void;
  openSession: (session: ClipSession) => void;
  deleteSession: (id: string) => void;

  /** True when a stored session was opened but its file needs reselecting. */
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
  };
}

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

  const setSegments = useCallback((segments: Segment[]) => {
    setEditor((e) => ({ ...e, segments }));
  }, []);

  const addSegment = useCallback((segment?: Partial<Segment>) => {
    setEditor((e) => {
      const last = e.segments[e.segments.length - 1];
      const defaultStart = segment?.start ?? (last ? last.end : 0);
      const defaultEnd = segment?.end ?? defaultStart + 5;
      return {
        ...e,
        segments: [
          ...e.segments,
          { id: makeId(), start: defaultStart, end: defaultEnd },
        ],
      };
    });
  }, []);

  const updateSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setEditor((e) => ({
      ...e,
      segments: e.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeSegment = useCallback((id: string) => {
    setEditor((e) => ({ ...e, segments: e.segments.filter((s) => s.id !== id) }));
  }, []);

  const resetEditor = useCallback(() => {
    setEditor(emptyEditor());
  }, []);

  const saveCurrentSession = useCallback(
    (outputName?: string) => {
      setEditor((e) => {
        if (!e.source) return e;
        const session = buildSession({
          id: e.sessionId,
          createdAt: e.createdAt,
          title: e.title.trim() || e.source.name,
          source: e.source,
          segments: e.segments,
          outputName: outputName ?? `${e.title.trim() || 'output'}.mp4`,
        });
        setHistory(upsertSession(session));
        return e;
      });
    },
    []
  );

  const openSession = useCallback((session: ClipSession) => {
    setEditor((prev) => {
      // If the currently loaded file matches this session's source, keep it.
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
        segments: session.segments.map((s) => ({
          id: makeId(),
          start: s.start,
          end: s.end,
        })),
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
      setSegments,
      addSegment,
      updateSegment,
      removeSegment,
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
      setSegments,
      addSegment,
      updateSegment,
      removeSegment,
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
