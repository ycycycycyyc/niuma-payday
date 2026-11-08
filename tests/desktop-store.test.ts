import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DEFAULT_STATE, readState, writePrivacy, writeSavingsEntry, writeState } from '../src/lib/store.ts';
import { describeDesktopError, isDesktopHost } from '../src/lib/desktop-error.ts';
import type { SavingsEntry } from '../shared/savings.mjs';

const requested = () => ({ ...structuredClone(DEFAULT_STATE), configured: true, settings: { ...structuredClone(DEFAULT_STATE.settings), monthlySalary: 16_800, currency: 'HKD' as const, region: 'CN' as const } });

function host(t: TestContext, bridge: unknown, agent = 'Electron/45.2.3', initial: Record<string, string> = {}) {
  const browserWrites: string[] = [];
  const browserReads: string[] = [];
  const stored = new Map(Object.entries(initial));
  const storage = {
    setItem(key: string, value: string) { browserWrites.push(key); stored.set(key, value); },
    getItem(key: string) { browserReads.push(key); return stored.get(key) ?? null; },
  };
  for (const [key, value] of Object.entries({ window: { niuma: bridge, navigator: { userAgent: agent } }, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { browserWrites, browserReads };
}
const storageBridge = (setState: (value: unknown) => Promise<unknown>) => ({ setState, getState: async () => null, onStateChanged: () => () => {} });

const deposit: SavingsEntry = { month: '2020-12', currency: 'HKD', salaryCents: 1_680_000, rentCents: 500_000, livingCents: 250_000 };

test('a web ledger survives reloads, stale settings and privacy saves, and rejects lost updates', async t => {
  host(t, undefined, 'Chrome');
  await assert.rejects(writeSavingsEntry(deposit, null), /SAVINGS_UNCONFIGURED/);
  const original = requested();
  await writeState(original);
  const january = { ...deposit, month: '2021-01' };
  await Promise.all([writeSavingsEntry(deposit, null), writeSavingsEntry(january, null)]);
  const revised = { ...deposit, livingCents: 300_001 };
  await writeSavingsEntry(revised, deposit);
  await writeSavingsEntry(revised, deposit);
  await assert.rejects(writeSavingsEntry({ ...deposit, rentCents: 160_000 }, deposit), /SAVINGS_CONFLICT/);
  await writeState({ ...original, settings: { ...original.settings, monthlySalary: 10_000, currency: 'USD' } });
  await writePrivacy(true);
  const reloaded = await readState();
  assert.deepEqual(reloaded.savings, { '2020-12': revised, '2021-01': january });
  assert.equal(reloaded.privacy, true);
  assert.equal(reloaded.settings.currency, 'USD');
});

test('desktop ledger writes require a receipt for the exact month and amounts', async t => {
  let reply: unknown;
  const browser = host(t, { ...storageBridge(async () => null), writeSavingsEntry: async () => reply });
  const state = requested();
  for (reply of [null, state, { ...state, savings: { [deposit.month]: { ...deposit, rentCents: 0 } } }]) {
    await assert.rejects(writeSavingsEntry(deposit, null), /NIUMA_WRITE_UNCONFIRMED/);
  }
  reply = { ...state, savings: { [deposit.month]: deposit } };
  assert.deepEqual(await writeSavingsEntry(deposit, null), reply);
  assert.deepEqual(browser.browserWrites, []);
});

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
  for (const reply of [undefined, null, { version: 1 }, { ...state, version: 2 }, DEFAULT_STATE, { ...state, settings: { ...state.settings, monthlySalary: 1 } },
    { ...state, settings: { ...state.settings, paydayMode: 'fixed-day' } },
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
  assert.equal(result.settings.monthlySalary, 16_800);
  assert.equal(result.settings.currency, 'HKD');
  assert.equal(result.settings.region, 'CN');
  assert.deepEqual(result.calendar, calendar);
});

test('a genuine web preview can still save locally without Electron', async t => {
  const browser = host(t, undefined, 'Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36');
  assert.equal(isDesktopHost(), false);
  const state = requested();
  assert.deepEqual(await writeState(state), state);
  assert.deepEqual(browser.browserWrites, ['niuma.payday.v3']);
});

test('web legacy reads preserve HKD plus mainland preferences and save a separate v3 profile', async t => {
  const legacy = { version: 2, configured: true, privacy: true, goal: { name: '电影', amount: 100 },
    settings: { dailySalary: 680, currency: 'HKD', region: 'CN', payday: 15, startTime: '10:00', endTime: '19:00' } };
  const browser = host(t, undefined, 'Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36',
    { 'niuma.payday.v2': JSON.stringify(legacy) });
  const state = await readState();
  assert.deepEqual(browser.browserReads, ['niuma.payday.v3', 'niuma.payday.v2']);
  assert.equal(state.configured, false);
  assert.equal(state.settings.monthlySalary, 0);
  assert.equal(state.settings.currency, 'HKD');
  assert.equal(state.settings.region, 'CN');
  assert.equal(state.settings.paydayMode, 'fixed-day');
  assert.equal(state.settings.payday, 15);
  assert.deepEqual(state.goal, legacy.goal);
  await writeState(state);
  assert.deepEqual(await readState(), state);
  assert.deepEqual(browser.browserWrites, ['niuma.payday.v3']);
});

test('an unconfigured migration can be acknowledged without activating a zero monthly rate', async t => {
  const state = { ...requested(), configured: false,
    settings: { ...requested().settings, monthlySalary: 0, paydayMode: 'fixed-day' as const, payday: 10 } };
  host(t, storageBridge(async value => JSON.parse(JSON.stringify(value))));
  assert.deepEqual(await writeState(state), state);
  const configured = { ...state, configured: true };
  await assert.rejects(writeState(configured), /NIUMA_WRITE_UNCONFIRMED/);
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
