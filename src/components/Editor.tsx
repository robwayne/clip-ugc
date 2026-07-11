'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { SourcePicker } from './SourcePicker';
import { Preview } from './Preview';
import { SegmentList } from './SegmentList';
import { RenderPanel } from './RenderPanel';

export function Editor() {
  const { editor, setTitle } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const stopAtRef = useRef<number | null>(null);

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

  // Track the playhead and enforce preview range stops.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (stopAtRef.current != null && video.currentTime >= stopAtRef.current) {
        video.pause();
        stopAtRef.current = null;
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [objectUrl]);

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    stopAtRef.current = null;
    video.currentTime = Math.max(0, seconds);
    video.focus?.();
  }, []);

  const previewRange = useCallback((start: number, end: number) => {
    const video = videoRef.current;
    if (!video || !(end > start)) return;
    video.currentTime = Math.max(0, start);
    stopAtRef.current = end;
    void video.play();
  }, []);

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
      </div>

      <SourcePicker />

      {objectUrl && (
        <Preview ref={videoRef} url={objectUrl} currentTime={currentTime} duration={duration} />
      )}

      {editor.source && (
        <SegmentList
          duration={duration}
          getCurrentTime={getCurrentTime}
          seekTo={seekTo}
          previewRange={previewRange}
        />
      )}

      {editor.source && <RenderPanel />}
    </div>
  );
}
