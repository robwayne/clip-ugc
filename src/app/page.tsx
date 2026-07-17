'use client';

import { useApp } from '@/context/AppContext';
import { Header } from '@/components/Header';
import { Workspace } from '@/components/Workspace';
import { HistoryView } from '@/components/HistoryView';

export default function Home() {
  const { view } = useApp();
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-6">
        {view === 'editor' ? (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">
                Cut a video, splice the moments you want
              </h1>
              <p className="mt-1 text-sm text-white/50">
                Upload a source video, mark timestamp ranges, and splice each group
                on its own. Open multiple tabs to edit several videos at once.
                Everything runs locally in your browser.
              </p>
            </div>
            <Workspace />
          </>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">History</h1>
              <p className="mt-1 text-sm text-white/50">
                Revisit and re-edit previous clipping sessions.
              </p>
            </div>
            <HistoryView />
          </>
        )}
        <footer className="mt-12 border-t border-white/10 pt-4 text-center text-xs text-white/30">
          Clip &amp; Splice · client-side video editing with ffmpeg.wasm
        </footer>
      </main>
    </div>
  );
}
