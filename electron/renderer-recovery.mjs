/** Retry a crashed renderer once per native window. A second failure needs an explicit native recovery command. */
export function monitorRendererRecovery(window, { isQuitting, beforeRetry, failed }) {
  const state = { attempted: false, failed: false };
  window.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting() || window.isDestroyed() || details?.reason === 'clean-exit') return;
    beforeRetry();
    if (!state.attempted) {
      state.attempted = true;
      try { window.webContents.reload(); return; } catch { /* Use the same native recovery path as a repeated crash. */ }
    }
    state.failed = true;
    failed();
  });
  return state;
}
