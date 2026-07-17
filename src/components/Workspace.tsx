'use client';

// The editor workspace: a tab bar plus one mounted Editor per open tab. Every
// tab stays mounted (inactive ones hidden) so each keeps its own video element,
// playback, and render results while you switch between them. Each Editor is
// wrapped in a TabScope so its useApp() calls resolve to that tab.
import { TabScope, useApp } from '@/context/AppContext';
import { Editor } from './Editor';
import { TabBar } from './TabBar';

export function Workspace() {
  const { tabs, activeTabId } = useApp();
  return (
    <div>
      <TabBar />
      <div className="mt-5">
        {tabs.map((t) => (
          <TabScope.Provider key={t.tabId} value={t.tabId}>
            <div className={t.tabId === activeTabId ? '' : 'hidden'}>
              <Editor />
            </div>
          </TabScope.Provider>
        ))}
      </div>
    </div>
  );
}
