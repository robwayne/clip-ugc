'use client';

import { useApp } from '@/context/AppContext';
import type { ClipSession } from '@/lib/types';
import { formatBytes, formatDuration, formatTimestamp } from '@/lib/time';

export function HistoryView() {
  const { history, openSession, deleteSession, setView } = useApp();

  if (history.length === 0) {
    return (
      <div className="card text-center">
        <div className="text-4xl">🕘</div>
        <p className="mt-3 text-sm font-medium">No saved sessions yet</p>
        <p className="mt-1 text-sm text-white/50">
          Sessions are saved automatically after you splice a video.
        </p>
        <button className="btn-primary mt-4" onClick={() => setView('editor')}>
          Go to editor
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/50">
        {history.length} saved session{history.length === 1 ? '' : 's'}. Source files
        aren&apos;t stored — reopen a session to re-edit its timestamps and reselect the
        video.
      </p>
      {history.map((session) => (
        <HistoryCard
          key={session.id}
          session={session}
          onOpen={() => openSession(session)}
          onDelete={() => {
            if (confirm(`Delete "${session.title}" from history?`)) {
              deleteSession(session.id);
            }
          }}
        />
      ))}
    </div>
  );
}

function HistoryCard({
  session,
  onOpen,
  onDelete,
}: {
  session: ClipSession;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const totalOutput = session.segments.reduce(
    (sum, s) => (s.end > s.start ? sum + (s.end - s.start) : sum),
    0
  );
  const date = new Date(session.updatedAt);

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{session.title}</h3>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {session.sources.length === 1
              ? `Source: ${session.sources[0].meta.name}`
              : `${session.sources.length} sources: ${session.sources
                  .map((s) => s.meta.name)
                  .join(', ')}`}
          </p>
          <p className="mt-0.5 text-xs text-white/40">
            {session.segments.length} segment
            {session.segments.length === 1 ? '' : 's'}
            {session.groups.length > 0 && (
              <> · {session.groups.length} group{session.groups.length === 1 ? '' : 's'}</>
            )}{' '}
            · output {formatDuration(totalOutput)} · saved {date.toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-secondary" onClick={onOpen}>
            Open &amp; retry
          </button>
          <button className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {session.segments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {session.segments.map((s, i) => {
            const color = s.groupId
              ? session.groups.find((g) => g.id === s.groupId)?.color
              : undefined;
            return (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-white/60"
              >
                {color && (
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                )}
                {formatTimestamp(s.start)} – {formatTimestamp(s.end)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
