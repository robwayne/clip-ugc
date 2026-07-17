'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { SourcePicker } from './SourcePicker';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { GroupsBar } from './GroupsBar';
import { SegmentList } from './SegmentList';
import { RenderPanel } from './RenderPanel';

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
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  // Active back-to-back playback sequence (used for previewing a range or a
  // whole group as if its clips were already concatenated). When `loop` is set
  // it restarts from the first range instead of stopping at the end.
  const sequenceRef = useRef<{
    ranges: Array<{ start: number; end: number }>;
    i: number;
    loop: boolean;
  } | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loopingKey, setLoopingKey] = useState<string | null>(null);

  // Manage the object URL for the loaded file.
  useEffect(() => {
    if (!editor.file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(editor.file);
    setObjectUrl(url);
    setCurrentTime(0);
    return () => URL.revokeObjectURL(url);
  }, [editor.file]);

  // Keep the playhead readout in sync.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onEnded = () => {
      sequenceRef.current = null;
      setPlayingKey(null);
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
    };
  }, [objectUrl]);

  // Drive sequential (back-to-back) playback with a requestAnimationFrame loop.
  // Checking every frame (~16ms) rather than on `timeupdate` (~250ms) keeps clip
  // boundaries tight, so a group plays as if its clips were already concatenated.
  useEffect(() => {
    if (!playingKey) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const seq = sequenceRef.current;
      if (video && seq) {
        const range = seq.ranges[seq.i];
        if (range && video.currentTime >= range.end - 0.01) {
          const next = seq.i + 1;
          if (next < seq.ranges.length) {
            seq.i = next;
            video.currentTime = seq.ranges[next].start;
          } else if (seq.loop) {
            // Loop: jump back to the first range and keep playing.
            seq.i = 0;
            video.currentTime = seq.ranges[0].start;
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
  }, [playingKey]);

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  // Pause playback when this tab is switched away from, so a hidden tab's video
  // doesn't keep playing.
  useEffect(() => {
    if (!isActive) {
      videoRef.current?.pause();
      sequenceRef.current = null;
      setPlayingKey(null);
      setLoopingKey(null);
    }
  }, [isActive]);

  // Keyboard shortcuts: S marks a segment start, E marks the end. Active only
  // for the focused tab, when a video is loaded and focus isn't in a control.
  useEffect(() => {
    if (!objectUrl || !isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        el?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      ) {
        return;
      }
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
  }, [objectUrl, isActive, markStart, markEnd]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    sequenceRef.current = null;
    setPlayingKey(null);
    setLoopingKey(null);
    video.currentTime = Math.max(0, seconds);
    video.focus?.();
  }, []);

  // Play an ordered list of ranges back-to-back, optionally looping. Starting
  // any playback replaces whatever was playing/looping (only one at a time).
  const startSequence = useCallback(
    (ranges: Array<{ start: number; end: number }>, key: string, loop: boolean) => {
      const video = videoRef.current;
      const valid = ranges.filter((r) => r.end > r.start);
      if (!video || valid.length === 0) return;
      sequenceRef.current = { ranges: valid, i: 0, loop };
      setPlayingKey(key);
      setLoopingKey(loop ? key : null);
      video.currentTime = Math.max(0, valid[0].start);
      video.play().catch(() => {
        // Autoplay blocked (e.g. no user gesture); leave the sequence armed so
        // the user can start playback from the video controls.
      });
    },
    []
  );

  const playSegments = useCallback(
    (ranges: Array<{ start: number; end: number }>, key: string) =>
      startSequence(ranges, key, false),
    [startSequence]
  );

  // Toggle looping for a set of ranges: clicking the one already looping stops.
  const loopSegments = useCallback(
    (ranges: Array<{ start: number; end: number }>, key: string) => {
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
    const video = videoRef.current;
    sequenceRef.current = null;
    setPlayingKey(null);
    setLoopingKey(null);
    video?.pause();
  }, []);

  const previewRange = useCallback(
    (start: number, end: number) => playSegments([{ start, end }], `preview:${start}:${end}`),
    [playSegments]
  );

  const handleSaveVariation = useCallback(() => {
    const suggestion = `${editor.title.trim() || 'Untitled'} (variation)`;
    const name = window.prompt('Name this variation', suggestion);
    if (name && name.trim()) saveAsVariation(name.trim());
  }, [editor.title, saveAsVariation]);

  const duration = editor.source?.duration ?? null;

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
            disabled={!editor.source || !isDirty}
            title={
              existsInHistory ? 'Update this saved project' : 'Save this project to history'
            }
          >
            {existsInHistory ? 'Save' : 'Save project'}
          </button>
          {existsInHistory && (
            <button
              className="btn-ghost"
              onClick={handleSaveVariation}
              disabled={!editor.source}
              title="Save the current edits as a new named session, keeping the original"
            >
              Save as variation…
            </button>
          )}
          <span className="text-xs text-white/40">
            {!editor.source
              ? 'Load a video to save'
              : isDirty
              ? existsInHistory
                ? 'Unsaved changes'
                : 'Not saved yet'
              : 'All changes saved'}
          </span>
        </div>
      </div>

      <SourcePicker />

      {objectUrl && (
        <Preview ref={videoRef} url={objectUrl} currentTime={currentTime} duration={duration} />
      )}

      {objectUrl && duration != null && duration > 0 && (
        <Timeline duration={duration} currentTime={currentTime} onSeek={seekTo} />
      )}

      {editor.source && <GroupsBar />}

      {editor.source && (
        <SegmentList
          duration={duration}
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

      {editor.source && <RenderPanel />}
    </div>
  );
}
