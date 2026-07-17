'use client';

import { useApp } from '@/context/AppContext';

export function Header() {
  const { view, setView, history, newTab } = useApp();

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0d13]/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <button
          onClick={() => setView('editor')}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-xl">✂️</span>
          <span className="text-lg font-semibold tracking-tight">
            Clip <span className="text-brand-400">&amp;</span> Splice
          </span>
        </button>

        <nav className="flex items-center gap-1">
          <button
            onClick={() => setView('editor')}
            className={
              view === 'editor'
                ? 'btn-secondary'
                : 'btn-ghost'
            }
          >
            Editor
          </button>
          <button
            onClick={() => setView('history')}
            className={view === 'history' ? 'btn-secondary' : 'btn-ghost'}
          >
            History
            {history.length > 0 && (
              <span className="ml-1 rounded-full bg-brand-600/40 px-1.5 text-xs">
                {history.length}
              </span>
            )}
          </button>
          {view === 'editor' && (
            <button onClick={newTab} className="btn-ghost" title="Open a new tab">
              New tab
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
