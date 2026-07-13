'use client';

import { useState } from 'react';
import { useApp } from '@/context/AppContext';

/**
 * Manage groups and pick the "active" group that new segments are added to.
 */
export function GroupsBar() {
  const { editor, addGroup, renameGroup, removeGroup, setActiveGroup } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const counts = new Map<string | null, number>();
  for (const s of editor.segments) {
    counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1);
  }

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const commitRename = () => {
    if (editingId && draftName.trim()) renameGroup(editingId, draftName.trim());
    setEditingId(null);
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Groups</h2>
          <p className="mt-0.5 text-xs text-white/50">
            New segments go into the active group. Each group splices on its own;
            all groups splice into the final video.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => addGroup()}>
          + New group
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <ActiveChip
          label="Ungrouped"
          color="#64748b"
          count={counts.get(null) ?? 0}
          active={editor.activeGroupId === null}
          onClick={() => setActiveGroup(null)}
        />
        {editor.groups.map((g) => (
          <div key={g.id} className="flex items-center">
            {editingId === g.id ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-32 rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-sm"
              />
            ) : (
              <div className="flex items-center overflow-hidden rounded-full border border-white/10">
                <ActiveChip
                  label={g.name}
                  color={g.color}
                  count={counts.get(g.id) ?? 0}
                  active={editor.activeGroupId === g.id}
                  onClick={() => setActiveGroup(g.id)}
                  bare
                />
                <button
                  className="px-1.5 py-1 text-xs text-white/40 hover:text-white"
                  onClick={() => startRename(g.id, g.name)}
                  title="Rename group"
                >
                  ✎
                </button>
                <button
                  className="px-1.5 py-1 text-xs text-white/40 hover:text-red-300"
                  onClick={() => {
                    if (confirm(`Delete group "${g.name}"? Its segments become ungrouped.`)) {
                      removeGroup(g.id);
                    }
                  }}
                  title="Delete group"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveChip({
  label,
  color,
  count,
  active,
  onClick,
  bare = false,
}: {
  label: string;
  color: string;
  count: number;
  active: boolean;
  onClick: () => void;
  bare?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
        bare ? '' : 'rounded-full border'
      } ${
        active
          ? bare
            ? 'bg-white/10'
            : 'border-white/40 bg-white/10'
          : bare
          ? 'hover:bg-white/5'
          : 'border-white/10 hover:bg-white/5'
      }`}
      title={active ? 'Active — new segments land here' : 'Make active'}
    >
      <span className="h-3 w-3 rounded-full" style={{ background: color }} />
      <span className="max-w-[10rem] truncate">{label}</span>
      <span className="text-xs text-white/40">{count}</span>
      {active && <span className="text-[10px] uppercase text-brand-300">active</span>}
    </button>
  );
}
