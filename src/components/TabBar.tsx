'use client';

import { useApp } from '@/context/AppContext';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, newTab, closeTab } = useApp();

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/10 pb-2">
      {tabs.map((t) => {
        const active = t.tabId === activeTabId;
        return (
          <div
            key={t.tabId}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-transparent text-white/55 hover:bg-white/5'
            }`}
          >
            <button
              onClick={() => setActiveTab(t.tabId)}
              className="max-w-[12rem] truncate"
              title={t.title}
            >
              {t.title}
              {t.isDirty && <span className="text-amber-300" title="Unsaved changes"> •</span>}
            </button>
            <button
              onClick={() => {
                if (t.isDirty && !confirm('Close this tab? Unsaved changes will be lost.')) return;
                closeTab(t.tabId);
              }}
              title="Close tab"
              aria-label="Close tab"
              className="rounded px-1 leading-none text-white/30 hover:bg-white/10 hover:text-white"
            >
              ×
            </button>
          </div>
        );
      })}
      <button onClick={newTab} className="btn-ghost px-2 py-1 text-sm" title="Open a new tab">
        + New tab
      </button>
    </div>
  );
}
