'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { SourcesPanel } from './SourcesPanel';
import { Preview } from './Preview';
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
    setTitle,
    markStart,
    markEnd,
    saveProject,
    saveAsVariation,
    isDirty,
    existsInHistory,
  } = useApp();
  const isActive = tabId === activeTabId;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

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

  // ---- Which source is shown in the player (follows the active source when
  //      idle; the playback sequence drives it across sources) ----
  const [displaySourceId, setDisplaySourceId] = useState<string | null>(editor.activeSourceId);
  const displayRef = useRef(displaySourceId);
  useEffect(() => {
    displayRef.current = displaySourceId;
  }, [displaySourceId]);

  // ---- Playback sequence (back-to-back ranges across sources, optional loop) ----
  const sequenceRef = useRef<{ ranges: PlayRange[]; i: number; loop: boolean } | null>(null);
  const switchingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loopingKey, setLoopingKey] = useState<string | null>(null);

  // When idle, keep the displayed source in sync with the active source.
  useEffect(() => {
    if (!sequenceRef.current) {
      setDisplaySourceId(editor.activeSourceId);
      setCurrentTime(0);
    }
  }, [editor.activeSourceId]);

  const displayUrl = displaySourceId ? urls[displaySourceId] ?? null : null;
  const displaySource = editor.sources.find((s) => s.id === displaySourceId) ?? null;
  const duration = displaySource?.meta.duration ?? null;

  const enterRange = useCallback((idx: number) => {
    const seq = sequenceRef.current;
    const video = videoRef.current;
    if (!seq || !video) return;
    seq.i = idx;
    const r = seq.ranges[idx];
    if (displayRef.current !== r.sourceId) {
      // Switch the player to this range's source; seek+play once it loads.
      switchingRef.current = true;
      pendingSeekRef.current = r.start;
      setDisplaySourceId(r.sourceId);
    } else {
      video.currentTime = Math.max(0, r.start);
      void video.play().catch(() => {});
    }
  }, []);

  // Player event wiring (re-bound when the displayed source changes).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onLoaded = () => {
      if (pendingSeekRef.current != null) {
        video.currentTime = Math.max(0, pendingSeekRef.current);
        pendingSeekRef.current = null;
        if (sequenceRef.current) void video.play().catch(() => {});
        switchingRef.current = false;
      }
    };
    const onEnded = () => {
      sequenceRef.current = null;
      setPlayingKey(null);
      setLoopingKey(null);
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('ended', onEnded);
    };
  }, [displayUrl]);

  // Drive sequential playback with rAF for tight clip boundaries.
  useEffect(() => {
    if (!playingKey) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const seq = sequenceRef.current;
      if (video && seq && !switchingRef.current) {
        const range = seq.ranges[seq.i];
        if (range && video.currentTime >= range.end - 0.01) {
          const next = seq.i + 1;
          if (next < seq.ranges.length) {
            enterRange(next);
          } else if (seq.loop) {
            enterRange(0);
          } else {
            video.pause();
            sequenceRef.current = null;
            setPlayingKey(null);
            setLoopingKey(null);
            return;
          }
        }
        setCurrentTime(video.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingKey, enterRange]);

  // Pause playback when this tab is switched away from.
  useEffect(() => {
    if (!isActive) {
      videoRef.current?.pause();
      sequenceRef.current = null;
      switchingRef.current = false;
      setPlayingKey(null);
      setLoopingKey(null);
    }
  }, [isActive]);

  // Keyboard shortcuts: S/E mark on the active source's video.
  useEffect(() => {
    if (!displayUrl || !isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        markStart(videoRef.current?.currentTime ?? 0);
      } else if (key === 'e') {
        e.preventDefault();
        markEnd(videoRef.current?.currentTime ?? 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [displayUrl, isActive, markStart, markEnd]);

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  const seekTo = useCallback((seconds: number) => {
    sequenceRef.current = null;
    switchingRef.current = false;
    pendingSeekRef.current = null;
    setPlayingKey(null);
    setLoopingKey(null);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
    video.focus?.();
  }, []);

  const startSequence = useCallback(
    (ranges: PlayRange[], key: string, loop: boolean) => {
      const valid = ranges.filter((r) => r.end > r.start && urlsRef.current[r.sourceId]);
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
        videoRef.current?.pause();
        return;
      }
      startSequence(ranges, key, true);
    },
    [loopingKey, startSequence]
  );

  const stopPlayback = useCallback(() => {
    sequenceRef.current = null;
    switchingRef.current = false;
    setPlayingKey(null);
    setLoopingKey(null);
    videoRef.current?.pause();
    // Revert the player to the active source.
    setDisplaySourceId(editor.activeSourceId);
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

      {displayUrl && (
        <Preview ref={videoRef} url={displayUrl} currentTime={currentTime} duration={duration} />
      )}

      {displayUrl && displaySourceId && duration != null && duration > 0 && (
        <Timeline
          duration={duration}
          currentTime={currentTime}
          onSeek={seekTo}
          sourceId={displaySourceId}
        />
      )}

      {hasSources && <GroupsBar />}

      {hasSources && (
        <SegmentList
          duration={duration}
          displaySourceId={displaySourceId}
          getCurrentTime={getCurrentTime}
          seekTo={seekTo}
          previewRange={previewRange}
          playSegments={playSegments}
          loopSegments={loopSegments}
          stopPlayback={stopPlayback}
          playingKey={playingKey}
          loopingKey={loopingKey}
        />
      )}

      {hasSources && <RenderPanel />}
    </div>
  );
}
