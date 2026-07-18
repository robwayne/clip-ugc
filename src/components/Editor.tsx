'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { SourcesPanel } from './SourcesPanel';
import { SourcePlayers } from './SourcePlayers';
import { AudioPanel } from './AudioPanel';
import { Timeline } from './Timeline';
import { GroupsBar } from './GroupsBar';
import { SegmentList } from './SegmentList';
import { RenderPanel } from './RenderPanel';

/** A range to play, tagged with the source video it belongs to. */
export interface PlayRange {
  start: number;
  end: number;
  sourceId: string;
}

export function Editor() {
  const {
    editor,
    tabId,
    activeTabId,
    setActiveSource,
    setTitle,
    markStart,
    markEnd,
    saveProject,
    saveAsVariation,
    isDirty,
    existsInHistory,
  } = useApp();
  const isActive = tabId === activeTabId;

  // One <video> element per source, registered by the players grid.
  const elsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const registerEl = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) elsRef.current.set(id, el);
    else elsRef.current.delete(id);
  }, []);
  const getEl = (id: string | null) => (id ? elsRef.current.get(id) ?? null : null);
  const pauseAllExcept = (keepId: string | null) => {
    elsRef.current.forEach((el, id) => {
      if (id !== keepId) el.pause();
    });
  };

  // ---- Per-source object URLs ----
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const s of editor.sources) if (s.file) next[s.id] = URL.createObjectURL(s.file);
    setUrls(next);
    return () => {
      Object.values(next).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [editor.sources]);

  // ---- Object URL for an uploaded audio-track file ----
  const [audioFileUrl, setAudioFileUrl] = useState<string | null>(null);
  useEffect(() => {
    const a = editor.audioSource;
    if (a?.kind === 'file' && a.file) {
      const u = URL.createObjectURL(a.file);
      setAudioFileUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setAudioFileUrl(null);
  }, [editor.audioSource]);

  // The source the timeline + playhead follow: the active source when idle, or
  // the source currently playing during a cross-source sequence.
  const [focusedSourceId, setFocusedSourceId] = useState<string | null>(editor.activeSourceId);
  const focusedRef = useRef(focusedSourceId);
  useEffect(() => {
    focusedRef.current = focusedSourceId;
  }, [focusedSourceId]);
  const [currentTime, setCurrentTime] = useState(0);

  // ---- Playback sequence across per-source players ----
  const sequenceRef = useRef<{ ranges: PlayRange[]; i: number; loop: boolean } | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loopingKey, setLoopingKey] = useState<string | null>(null);

  // When idle, the focused source tracks the active source.
  useEffect(() => {
    if (!sequenceRef.current) {
      setFocusedSourceId(editor.activeSourceId);
      setCurrentTime(getEl(editor.activeSourceId)?.currentTime ?? 0);
    }
  }, [editor.activeSourceId]);

  const onTime = useCallback((id: string, t: number) => {
    if (id === focusedRef.current) setCurrentTime(t);
  }, []);

  const enterRange = useCallback((idx: number) => {
    const seq = sequenceRef.current;
    if (!seq) return;
    seq.i = idx;
    const r = seq.ranges[idx];
    const el = elsRef.current.get(r.sourceId);
    pauseAllExcept(r.sourceId);
    setFocusedSourceId(r.sourceId);
    if (!el) return;
    el.currentTime = Math.max(0, r.start);
    void el.play().catch(() => {});
  }, []);

  // rAF loop advances the sequence with tight clip boundaries.
  useEffect(() => {
    if (!playingKey) return;
    let raf = 0;
    const tick = () => {
      const seq = sequenceRef.current;
      if (seq) {
        const r = seq.ranges[seq.i];
        const el = elsRef.current.get(r.sourceId);
        if (el) {
          if (el.currentTime >= r.end - 0.01) {
            const next = seq.i + 1;
            if (next < seq.ranges.length) {
              enterRange(next);
            } else if (seq.loop) {
              enterRange(0);
            } else {
              el.pause();
              sequenceRef.current = null;
              setPlayingKey(null);
              setLoopingKey(null);
              return;
            }
          }
          setCurrentTime(el.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingKey, enterRange]);

  // Pause everything when the tab is switched away from.
  useEffect(() => {
    if (!isActive) {
      pauseAllExcept(null);
      sequenceRef.current = null;
      setPlayingKey(null);
      setLoopingKey(null);
    }
  }, [isActive]);

  // Keyboard shortcuts: S/E mark on the active source's player.
  useEffect(() => {
    if (!isActive || !editor.activeSourceId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        markStart(getEl(editor.activeSourceId)?.currentTime ?? 0);
      } else if (key === 'e') {
        e.preventDefault();
        markEnd(getEl(editor.activeSourceId)?.currentTime ?? 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, editor.activeSourceId, markStart, markEnd]);

  const getCurrentTime = useCallback(
    () => getEl(editor.activeSourceId)?.currentTime ?? 0,
    [editor.activeSourceId]
  );

  const seekTo = useCallback(
    (seconds: number) => {
      sequenceRef.current = null;
      setPlayingKey(null);
      setLoopingKey(null);
      const target = focusedRef.current;
      setFocusedSourceId(editor.activeSourceId);
      const el = getEl(target);
      if (!el) return;
      el.currentTime = Math.max(0, seconds);
      el.focus?.();
    },
    [editor.activeSourceId]
  );

  const startSequence = useCallback(
    (ranges: PlayRange[], key: string, loop: boolean) => {
      const valid = ranges.filter((r) => r.end > r.start && elsRef.current.has(r.sourceId));
      if (valid.length === 0) return;
      sequenceRef.current = { ranges: valid, i: 0, loop };
      setPlayingKey(key);
      setLoopingKey(loop ? key : null);
      enterRange(0);
    },
    [enterRange]
  );

  const playSegments = useCallback(
    (ranges: PlayRange[], key: string) => startSequence(ranges, key, false),
    [startSequence]
  );

  const loopSegments = useCallback(
    (ranges: PlayRange[], key: string) => {
      if (loopingKey === key) {
        sequenceRef.current = null;
        setPlayingKey(null);
        setLoopingKey(null);
        pauseAllExcept(null);
        setFocusedSourceId(editor.activeSourceId);
        return;
      }
      startSequence(ranges, key, true);
    },
    [loopingKey, startSequence, editor.activeSourceId]
  );

  const stopPlayback = useCallback(() => {
    sequenceRef.current = null;
    setPlayingKey(null);
    setLoopingKey(null);
    pauseAllExcept(null);
    setFocusedSourceId(editor.activeSourceId);
  }, [editor.activeSourceId]);

  const previewRange = useCallback(
    (start: number, end: number, sourceId: string) =>
      playSegments([{ start, end, sourceId }], `preview:${sourceId}:${start}:${end}`),
    [playSegments]
  );

  const handleSaveVariation = useCallback(() => {
    const suggestion = `${editor.title.trim() || 'Untitled'} (variation)`;
    const name = window.prompt('Name this variation', suggestion);
    if (name && name.trim()) saveAsVariation(name.trim());
  }, [editor.title, saveAsVariation]);

  const hasSources = editor.sources.length > 0;
  const focusedSource = editor.sources.find((s) => s.id === focusedSourceId) ?? null;
  const focusedHasFile = focusedSource ? urls[focusedSource.id] != null : false;
  const duration = focusedSource?.meta.duration ?? null;

  // Resolve the audio track source to a preview URL + metadata.
  const audioSrc = editor.audioSource;
  const audioMeta =
    audioSrc == null
      ? null
      : audioSrc.kind === 'file'
      ? audioSrc.meta
      : editor.sources.find((s) => s.id === audioSrc.sourceId)?.meta ?? null;
  const audioUrl =
    audioSrc == null
      ? null
      : audioSrc.kind === 'file'
      ? audioFileUrl
      : urls[audioSrc.sourceId] ?? null;

  return (
    <div className="space-y-5">
      <div className="card">
        <label className="label" htmlFor="session-title">
          Session name
        </label>
        <input
          id="session-title"
          className="input"
          value={editor.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled clip session"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary"
            onClick={saveProject}
            disabled={!hasSources || !isDirty}
            title={existsInHistory ? 'Update this saved project' : 'Save this project to history'}
          >
            {existsInHistory ? 'Save' : 'Save project'}
          </button>
          {existsInHistory && (
            <button
              className="btn-ghost"
              onClick={handleSaveVariation}
              disabled={!hasSources}
              title="Save the current edits as a new named session, keeping the original"
            >
              Save as variation…
            </button>
          )}
          <span className="text-xs text-white/40">
            {!hasSources
              ? 'Add a video to save'
              : isDirty
              ? existsInHistory
                ? 'Unsaved changes'
                : 'Not saved yet'
              : 'All changes saved'}
          </span>
        </div>
      </div>

      <SourcesPanel />

      {hasSources && (
        <SourcePlayers
          sources={editor.sources}
          urls={urls}
          activeSourceId={editor.activeSourceId}
          focusedSourceId={focusedSourceId}
          currentTime={currentTime}
          onActivate={setActiveSource}
          registerEl={registerEl}
          onTime={onTime}
        />
      )}

      {focusedHasFile && focusedSourceId && duration != null && duration > 0 && (
        <Timeline
          duration={duration}
          currentTime={currentTime}
          onSeek={seekTo}
          sourceId={focusedSourceId}
        />
      )}

      {hasSources && <AudioPanel audioUrl={audioUrl} audioMeta={audioMeta} />}

      {hasSources && <GroupsBar />}

      {hasSources && (
        <SegmentList
          duration={duration}
          displaySourceId={focusedSourceId}
          getCurrentTime={getCurrentTime}
          seekTo={seekTo}
          previewRange={previewRange}
          playSegments={playSegments}
          loopSegments={loopSegments}
          stopPlayback={stopPlayback}
          playingKey={playingKey}
          loopingKey={loopingKey}
          audioUrl={audioUrl}
          audioSourceDuration={audioMeta?.duration ?? null}
        />
      )}

      {hasSources && <RenderPanel />}
    </div>
  );
}
