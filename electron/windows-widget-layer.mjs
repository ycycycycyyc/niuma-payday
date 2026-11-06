import { createRequire } from 'node:module';
import path from 'node:path';
import { app } from 'electron';

const require = createRequire(import.meta.url);
const guards = new WeakMap();
const WM_WINDOWPOSCHANGED = 0x0047;
const SWP_NOSIZE_NOMOVE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010;
let native;

function user32() {
  if (native) return native;
  const koffi = require(app.isPackaged ? path.join(process.resourcesPath, 'native', 'koffi.node') : 'koffi');
  const dll = koffi.load('user32.dll');
  native = {
    shell: dll.func('uintptr_t __stdcall GetShellWindow()'),
    findChild: dll.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 cls, str16 title)'),
    sibling: dll.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd, unsigned int command)'),
    style: dll.func('int32_t __stdcall GetWindowLongW(uintptr_t hwnd, int index)'),
    position: dll.func('int __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int w, int h, unsigned int flags)'),
  };
  return native;
}

// Explorer may host desktop icons in Progman itself or in a top-level WorkerW.
// Place the widget immediately ABOVE the desktop, otherwise Explorer can cover it.
function desktopSurface(api) {
  const shell = api.shell();
  if (!shell || api.findChild(shell, 0, 'SHELLDLL_DefView', null)) return shell;
  let worker = 0;
  while ((worker = api.findChild(0, worker, 'WorkerW', null))) {
    if (api.findChild(worker, 0, 'SHELLDLL_DefView', null)) return worker;
  }
  return shell;
}

function lower(window, api) {
  const handle = window.getNativeWindowHandle();
  // Windows guarantees that HWND values passed across process architectures fit in 32 bits.
  const hwnd = handle.readUInt32LE();
  const desktop = desktopSurface(api);
  let after = 1; // HWND_BOTTOM when there is no Explorer desktop.
  if (desktop) {
    after = api.sibling(desktop, 3); // GW_HWNDPREV
    if (after === hwnd) return;
    if (after && (api.style(after, -20) & 0x0008)) after = 0; // HWND_TOP of the non-topmost band
  } else if (!api.sibling(hwnd, 2)) {
    return;
  }
  if (!api.position(hwnd, after, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE)) {
    throw new Error('Windows 未能将浮窗移到桌面层');
  }
}

export function setWindowsWidgetLayer(window, layer) {
  const previous = guards.get(window);
  if (layer === 'top') {
    if (previous) {
      guards.delete(window);
      window.unhookWindowMessage(WM_WINDOWPOSCHANGED);
      window.off('show', previous);
      window.setFocusable(true);
      window.setSkipTaskbar(true); // setFocusable(true) also adds a taskbar entry on Windows.
    }
    window.setAlwaysOnTop(true, 'floating');
    return;
  }
  if (previous) return;
  const api = user32();
  let adjusting = false;
  const settle = () => {
    if (adjusting || window.isDestroyed() || !window.isVisible()) return;
    adjusting = true;
    try { lower(window, api); } finally { adjusting = false; }
  };
  let queued = false;
  const schedule = () => {
    if (adjusting || queued) return;
    // Leave Chromium's window procedure before changing the z-order. A queued
    // callback from an old bottom session must never undo a tray recovery.
    queued = true;
    setImmediate(() => {
      queued = false;
      if (guards.get(window) !== schedule) return;
      try { settle(); } catch (error) { console.warn('Unable to restore widget z-order:', error.message); }
    });
  };
  guards.set(window, schedule);
  try {
    window.setAlwaysOnTop(false);
    window.setFocusable(false); // WS_EX_NOACTIVATE keeps exposed controls clickable without raising the card.
    settle();
    window.on('show', schedule);
    window.hookWindowMessage(WM_WINDOWPOSCHANGED, schedule);
  } catch (error) {
    setWindowsWidgetLayer(window, 'top');
    throw error;
  }
}
