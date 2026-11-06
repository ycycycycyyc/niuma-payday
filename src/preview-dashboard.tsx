import { createRoot } from 'react-dom/client';
import App from './App';
import { DEFAULT_STATE, normalizeState } from './lib/store';

// The real App uses its ordinary desktop API against a private, temporary
// profile. No local storage, native bridge or remote calendar is accessed.
export function renderPreviewDashboard(root: HTMLElement) {
  let profile = structuredClone(DEFAULT_STATE);
  const notify = (action: 'widget' | 'state') => {
    window.parent.postMessage({ channel: 'niuma-preview', action, ...(action === 'state' && { state: profile }) }, '*');
  };
  const showWidget = async () => notify('widget');
  const unchanged = async () => {};
  window.niuma = {
    platform: 'preview',
    getState: async () => structuredClone(profile),
    setState: async value => {
      profile = normalizeState(value);
      notify('state');
      return structuredClone(profile);
    },
    onStateChanged: () => () => {},
    refreshCalendar: async () => ({ status: 'demo', message: '演示日历按周一至周五计算。', calendar: profile.calendar }),
    showWidget, hideWidget: unchanged, restoreMain: unchanged,
    minimize: showWidget, maximize: unchanged, close: showWidget,
    onWindowState: () => () => {},
  };
  document.documentElement.classList.add('preview-dashboard-document');
  createRoot(root).render(<App />);
}
