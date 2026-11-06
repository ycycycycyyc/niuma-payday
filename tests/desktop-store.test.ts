import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DEFAULT_STATE, readState, writeState } from '../src/lib/store.ts';
import { describeDesktopError, isDesktopHost } from '../src/lib/desktop-error.ts';

const requested = () => ({ ...structuredClone(DEFAULT_STATE), configured: true, settings: { ...structuredClone(DEFAULT_STATE.settings), dailySalary: 680 } });

function host(t: TestContext, bridge: unknown, agent = 'Electron/45.2.3') {
  const browserWrites: string[] = [];
  const browserReads: string[] = [];
  const storage = {
    setItem(key: string) { browserWrites.push(key); },
    getItem(key: string) { browserReads.push(key); return null; },
  };
  for (const [key, value] of Object.entries({ window: { niuma: bridge, navigator: { userAgent: agent } }, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { browserWrites, browserReads };
}
const storageBridge = (setState: (value: unknown) => Promise<unknown>) => ({ setState, getState: async () => null, onStateChanged: () => () => {} });

test('a missing Electron preload cannot silently save or load a browser profile', async t => {
  const browser = host(t, undefined);
  assert.equal(isDesktopHost(), true);
  await assert.rejects(readState(), /NIUMA_BRIDGE_MISSING/);
  await assert.rejects(writeState(requested()), /NIUMA_BRIDGE_MISSING/);
  assert.deepEqual(browser, { browserWrites: [], browserReads: [] });
});

test('a desktop write failure preserves the actionable reason and never falls back to browser storage', async t => {
  const browser = host(t, storageBridge(async () => { throw new Error("Error invoking remote method 'niuma:set-state': Error: [SAVE_PERMISSION] 拒绝写入"); }));
  await assert.rejects(writeState(requested()), error => {
    assert.match(describeDesktopError(error, 'save'), /读写权限/);
    return true;
  });
  assert.deepEqual(browser.browserWrites, []);
});

test('an empty, legacy, or mismatched desktop receipt cannot be reported as a confirmed save', async t => {
  const state = requested();
  let next: unknown;
  const browser = host(t, storageBridge(async () => next));
  for (const reply of [undefined, null, { version: 1 }, DEFAULT_STATE, { ...state, settings: { ...state.settings, dailySalary: 1 } },
    { ...state, settings: { ...state.settings, dayOverrides: { '2026-11-07': 'work' } } }, { ...state, privacy: true }]) {
    next = reply;
    await assert.rejects(writeState(state), /NIUMA_WRITE_UNCONFIRMED/);
  }
  assert.deepEqual(browser.browserWrites, []);
});

test('a valid acknowledged write uses the main-process calendar even if it changed while saving', async t => {
  const state = requested();
  const calendar = { 'CN-2026': { region: 'CN', year: 2026, holidays: { '2026-10-01': '国庆节' }, makeupWorkdays: {},
    fetchedAt: '2026-11-01T00:00:00.000Z', source: 'https://example.com/calendar/2026' } };
  host(t, storageBridge(async () => ({ ...state, calendar })));
  const result = await writeState(state);
  assert.equal(result.configured, true);
  assert.equal(result.settings.dailySalary, 680);
  assert.deepEqual(result.calendar, calendar);
});

test('a genuine web preview can still save locally without Electron', async t => {
  const browser = host(t, undefined, 'Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36');
  assert.equal(isDesktopHost(), false);
  const state = requested();
  assert.deepEqual(await writeState(state), state);
  assert.deepEqual(browser.browserWrites, ['niuma.payday.v2']);
});

test('desktop diagnostics cover missing bridges, authorization, space, locked files and uncertain writes', () => {
  assert.equal(isDesktopHost(), false);
  assert.match(describeDesktopError('NIUMA_BRIDGE_MISSING', 'widget'), /桌面组件未正确连接/);
  assert.match(describeDesktopError('Error: [WINDOW_NOT_TRUSTED] refused', 'widget'), /未识别当前窗口/);
  assert.match(describeDesktopError(new Error('ENOSPC'), 'save'), /空间不足/);
  assert.match(describeDesktopError(new Error('EBUSY'), 'save'), /文件正被占用/);
  assert.match(describeDesktopError('NIUMA_WRITE_UNCONFIRMED', 'save'), /无法确认/);
  assert.match(describeDesktopError('Unexpected native window initialization error', 'widget'), /Unexpected native window/);
});
