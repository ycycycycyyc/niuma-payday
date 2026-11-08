import { createRoot } from 'react-dom/client';
import App from './App';
import { DEFAULT_STATE, normalizeState } from './lib/store';
import { recordSavingsEntry } from '../shared/savings.mjs';

// The real App uses its ordinary desktop API against a private, temporary
// profile. No local storage, native bridge or remote calendar is accessed.
export function renderPreviewDashboard(root: HTMLElement) {
  let profile = structuredClone(DEFAULT_STATE);
  const subscribers = new Set<(state: unknown) => void>();
  const initialPrivacy = new Promise<void>(resolve => {
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.data?.channel !== 'niuma-preview' ||
        event.data.action !== 'privacy' || typeof event.data.privacy !== 'boolean') return;
      profile = { ...profile, privacy: event.data.privacy };
      resolve();
      for (const subscriber of subscribers) subscriber(structuredClone(profile));
    });
  });
  const notify = (action: 'widget' | 'state' | 'ready') => {
    window.parent.postMessage({ channel: 'niuma-preview', action, ...(action === 'state' && { state: profile }) }, '*');
  };
  const showWidget = async () => notify('widget');
  const unchanged = async () => {};
  window.niuma = {
    platform: 'preview',
    getState: async () => { await initialPrivacy; return structuredClone(profile); },
    setState: async value => {
      profile = { ...normalizeState(value), savings: profile.savings };
      notify('state');
      return structuredClone(profile);
    },
    writeSavingsEntry: async (entry, previous) => {
      profile = { ...profile, savings: recordSavingsEntry(profile, entry, previous) };
      notify('state');
      return structuredClone(profile);
    },
    onStateChanged: callback => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    refreshCalendar: async () => ({ status: 'demo', message: '演示日历按周一至周五计算。', calendar: profile.calendar }),
    showWidget, hideWidget: unchanged, restoreMain: unchanged,
    minimize: showWidget, maximize: unchanged, close: showWidget,
    onWindowState: () => () => {},
  };
  notify('ready');
  document.documentElement.classList.add('preview-dashboard-document');
  createRoot(root).render(<App />);
}
