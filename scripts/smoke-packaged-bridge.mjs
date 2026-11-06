/**
 * Exercise the released preload, main module, sender guard and state file with
 * simulated Electron windows, frame handles and IPC transport.
 * Requires Node >=22.15 and installed dev dependencies.
 * node scripts/smoke-packaged-bridge.mjs [path/to/app.asar]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import asar from '@electron/asar';

const originalCwd = process.cwd();
const archiveArg = process.argv.slice(2).find(value => !value.startsWith('--'));
const archive = path.resolve(archiveArg ?? 'release/win-unpacked/resources/app.asar');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-packaged-bridge-'));
const root = path.join(work, '测试 空格', 'resources', 'app.asar');
const profile = path.join(work, 'test-profile');
fs.mkdirSync(profile, { recursive: true });
asar.extractAll(archive, root);

const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const mainURL = pathToFileURL(path.join(root, 'electron/main.mjs')).href;
const archiveHash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const report = {
  kind: 'Packaged preload and main IPC on Node with simulated frame and transport; no native window or UI',
  archiveHash,
  passed: [],
  error: null,
};

function pass(description) {
  report.passed.push(description);
  console.log('PASS', description);
}

const noop = () => {};
const handlers = new Map();
const windows = [];
const paths = { userData: profile, sessionData: profile };
let cursor = { x: 0, y: 0 };
const screen = Object.assign(new EventEmitter(), {
  getCursorScreenPoint: () => cursor,
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
});
const app = Object.assign(new EventEmitter(), {
  commandLine: { hasSwitch: () => false },
  getPath: name => paths[name],
  getAppPath: () => root,
  setPath(name, value) {
    paths[name] = value;
  },
  requestSingleInstanceLock: () => true,
  whenReady: async () => {},
  isReady: () => true,
  setName: noop,
  setAppUserModelId: noop,
  isPackaged: true,
  quit() {
    this.emit('before-quit');
    this.emit('will-quit');
  },
});
const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };

class Tray extends EventEmitter {
  setToolTip() {}
  setContextMenu() {}
  destroy() {}
}

function frameFor(owner, subframe = false) {
  const contents = owner.webContents;
  const frame = {
    processId: 100 + contents.id,
    routingId: subframe ? 2 : 1,
    frameTreeNodeId: 1000 + contents.id + (subframe ? 100 : 0),
    url: contents.url,
    isDestroyed: () => false,
    detached: false,
    parent: subframe ? contents.mainFrame : null,
  };
  frame.top = subframe ? frame.parent : frame;
  return frame;
}

class BrowserWindow extends EventEmitter {
  static fromWebContents(sender) {
    return windows.find(window => window.webContents === sender);
  }

  static getAllWindows() {
    return windows;
  }

  static fromId(id) {
    return windows.find(window => window.id === id);
  }

  constructor(options) {
    super();
    this.options = options;
    this.visible = false;
    this.minimized = false;
    this.mouseIgnored = false;
    this.destroyed = false;
    this.id = windows.length + 1;
    this.bounds = { x: 0, y: 0, ...options };
    this.webContents = Object.assign(new EventEmitter(), {
      id: this.id,
      url: '',
      getURL() {
        return this.url;
      },
      getType: () => 'window',
      isDestroyed: () => false,
      setWindowOpenHandler: noop,
      session: { setPermissionCheckHandler: noop, setPermissionRequestHandler: noop },
      send: (channel, value) => this.bridgeEvents?.emit(channel, {}, structuredClone(value)),
    });

    // Each property read returns a new wrapper around the same native frame IDs.
    Object.defineProperty(this.webContents, 'mainFrame', { get: () => frameFor(this) });
    windows.push(this);
  }

  loadFile(file, options = {}) {
    const hash = options.hash ? '#' + options.hash : '';
    this.webContents.url = pathToFileURL(file).href + hash;
    this.bridgeEvents = new EventEmitter();
    const ipcRenderer = Object.assign(this.bridgeEvents, {
      invoke: async (channel, ...args) => {
        const senderFrame = frameFor(this);
        const event = {
          sender: this.webContents,
          senderFrame,
          processId: senderFrame.processId,
          frameId: senderFrame.routingId,
        };
        const result = await handlers.get(channel)(event, ...structuredClone(args));
        return structuredClone(result);
      },
    });
    const contextBridge = {
      exposeInMainWorld: (name, api) => {
        assert.equal(name, 'niuma');
        this.bridge = api;
      },
    };
    const sandbox = {
      require(name) {
        assert.equal(name, 'electron');
        return { ipcRenderer, contextBridge };
      },
      process: { platform: 'win32' },
    };
    vm.runInNewContext(preload, sandbox, { filename: 'packaged-preload.cjs' });
    queueMicrotask(() => this.emit('ready-to-show'));
    return Promise.resolve();
  }

  show() {
    this.visible = true;
  }

  showInactive() {
    this.show();
  }

  hide() {
    this.visible = false;
    this.emit('hide');
  }

  isVisible() {
    return this.visible;
  }

  isMinimized() {
    return this.minimized;
  }

  isMaximized() {
    return false;
  }

  minimize() {
    if (!this.minimized) {
      this.minimized = true;
      this.emit('minimize');
    }
  }

  restore() {
    if (this.minimized) {
      this.minimized = false;
      this.emit('restore');
    }
  }

  close() {
    let prevented = false;
    this.emit('close', {
      preventDefault() {
        prevented = true;
      },
    });
    if (!prevented) {
      this.destroyed = true;
      this.emit('closed');
    }
  }

  isDestroyed() {
    return this.destroyed;
  }

  getBounds() {
    return this.bounds;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  focus() {}
  setIgnoreMouseEvents(ignore) {
    this.mouseIgnored = ignore;
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
}

const electronHost = {
  app,
  BrowserWindow,
  ipcMain,
  Menu: { setApplicationMenu: noop, buildFromTemplate: template => template },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  powerMonitor: new EventEmitter(),
  screen,
  Tray,
};
globalThis.__niumaElectronTestHost = electronHost;
const exportsList = Object.keys(electronHost).join(', ');
const hostModule = 'export const {' + exportsList + '} = globalThis.__niumaElectronTestHost;';
const hostURL = 'data:text/javascript,' + encodeURIComponent(hostModule);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: hostURL, shortCircuit: true };
    return next(specifier, context);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('offline fixture', { status: 503 });

try {
  const oldCardPosition = { x: 260, y: 310 };
  fs.writeFileSync(path.join(profile, 'desktop.json'), JSON.stringify({ widgetPosition: oldCardPosition }));
  await import(mainURL);
  await Promise.resolve();
  const api = windows[0].bridge;
  await api.getState();
  pass('packaged preload reads state through actual IPC guard with distinct same-frame wrappers');

  const state = {
    version: 2,
    configured: true,
    privacy: false,
    goal: { name: '咖啡', amount: 25 },
    settings: {
      dailySalary: 680,
      currency: 'CNY',
      region: 'CN',
      startTime: '09:00',
      endTime: '18:00',
      autoWidget: true,
      lunchEnabled: false,
      lunchStart: '12:00',
      lunchEnd: '13:00',
      payday: 10,
      dayOverrides: {},
    },
  };
  await api.setState(state);
  assert.equal((await api.getState()).settings.dailySalary, 680);
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
  assert.equal(saved.settings.startTime, '09:00');
  pass('actual packaged main handler persists daily salary and working hours on disk');

  await assert.rejects(api.setState({ ...state, settings: { ...state.settings, dailySalary: -1 } }));
  const childFrame = frameFor(windows[0], true);
  const childEvent = {
    sender: windows[0].webContents,
    senderFrame: childFrame,
    frameId: childFrame.routingId,
    processId: childFrame.processId,
  };
  const protectedRead = handlers.get('niuma:get-state');
  await assert.rejects(async () => protectedRead(childEvent));
  await assert.rejects(async () => protectedRead({ ...childEvent, sender: new EventEmitter() }));
  pass('invalid salary, child-frame caller, and foreign window rejected');

  await api.showWidget();
  assert.equal(windows.length, 2);
  const widgetApi = windows[1].bridge;
  const widget = windows[1];
  const releaseVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!['1.0.0', '1.0.1'].includes(releaseVersion)) {
    const bounds = widget.getBounds();
    assert.deepEqual(bounds, { width: 350, height: 232, x: oldCardPosition.x, y: oldCardPosition.y - 72 });
    screen.emit('display-metrics-changed');
    assert.deepEqual(widget.getBounds(), bounds);
    if (process.platform === 'win32' || process.platform === 'darwin') {
      cursor = { x: bounds.x + 40, y: bounds.y + 71 };
      await new Promise(resolve => setTimeout(resolve, 70));
      assert.equal(widget.mouseIgnored, true);
      cursor.y++;
      // The native draggable card does not necessarily deliver a DOM mouseleave.
      await new Promise(resolve => setTimeout(resolve, 70));
      assert.equal(widget.mouseIgnored, false);
      pass('packaged widget passes pet-lane clicks through and restores card hit testing without DOM mouse events');
    }
    pass('floating window preserves the legacy card position across display changes');
  }
  assert.equal((await widgetApi.getState()).settings.dailySalary, 680);
  let received = null;
  const unsubscribe = widgetApi.onStateChanged(value => {
    received = value;
  });
  await api.setState({ ...state, privacy: true });
  assert.equal(received?.privacy, true);
  unsubscribe();
  await widgetApi.restoreMain();
  assert.equal(windows[0].isMinimized(), false);
  assert.equal(windows[1].isVisible(), false);
  pass('packaged widget bridge can read state, receive actual main broadcasts and request restoration');

  app.quit();
  app.removeAllListeners();
  screen.removeAllListeners();
  electronHost.powerMonitor.removeAllListeners();
  handlers.clear();
  windows.length = 0;
  await import(mainURL + '?fresh-main=2');
  await Promise.resolve();
  const reloaded = await windows[0].bridge.getState();
  assert.equal(reloaded.privacy, true);
  assert.equal(reloaded.settings.dailySalary, 680);
  assert.equal(reloaded.settings.endTime, '18:00');
  pass('fresh main-process instance reads persisted salary, hours and privacy from isolated disk');
} catch (error) {
  report.error = error.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  app.quit();
  hook.deregister();
  globalThis.fetch = originalFetch;
  const artifacts = path.join(originalCwd, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'packaged-transport-result.json'), JSON.stringify(report, null, 2));
}
