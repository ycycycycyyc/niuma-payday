import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DEFAULT_STATE, writeDayOverrides } from '../src/lib/store.ts';

const key = 'niuma.payday.v3';
const profile = () => ({ ...structuredClone(DEFAULT_STATE), configured: true });

function globals(t: TestContext, window: unknown, localStorage: unknown) {
  for (const [name, value] of Object.entries({ window, localStorage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
}

function waitingWeb(t: TestContext) {
  const values = new Map([[key, JSON.stringify(profile())]]);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  globals(t, { navigator: { userAgent: 'Chrome', locks: { request: async (_name: string, callback: () => unknown) => { entered(); await gate; return callback(); } } } },
    { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } });
  return { values, waiting, release };
}

test('a queued schedule save merges only changed dates into the profile read after its lock is granted', async t => {
  const { values, waiting, release } = waitingWeb(t);
  const pending = writeDayOverrides({ '2026-11-10': 'work' }, { '2026-11-10': null });
  await waiting;
  const external = { ...profile(), privacy: true, settings: { ...profile().settings, monthlySalary: 22_222, dayOverrides: { '2026-11-11': 'rest' } } };
  values.set(key, JSON.stringify(external));
  release();
  const saved = await pending;
  assert.deepEqual(saved.settings.dayOverrides, { '2026-11-10': 'work', '2026-11-11': 'rest' });
  assert.equal(saved.settings.monthlySalary, 22_222);
  assert.equal(saved.privacy, true);
  assert.deepEqual(JSON.parse(values.get(key)!).settings.dayOverrides, saved.settings.dayOverrides);
});

test('a concurrent change to the same day rejects the queued save without replacing the newer profile', async t => {
  const { values, waiting, release } = waitingWeb(t);
  const pending = writeDayOverrides({ '2026-11-10': 'work' }, { '2026-11-10': null });
  await waiting;
  const external = { ...profile(), settings: { ...profile().settings, dayOverrides: { '2026-11-10': 'rest' } } };
  const original = JSON.stringify(external);
  values.set(key, original);
  release();
  await assert.rejects(pending, /其他窗口更新/);
  assert.equal(values.get(key), original);
});

test('desktop schedule receipts must be configured and acknowledge every requested date', async t => {
  let reply: unknown;
  const bridge = { getState: async () => null, setState: async () => null, onStateChanged: () => () => {}, writeDayOverrides: async () => reply };
  globals(t, { niuma: bridge, navigator: { userAgent: 'Electron/45.2.3' } }, { getItem() { throw new Error('desktop cannot use browser storage'); } });
  const patch = { '2026-11-10': 'work' as const, '2026-11-11': null };
  const acknowledged = { ...profile(), settings: { ...profile().settings, dayOverrides: { '2026-11-10': 'work', '2026-11-12': 'rest' } } };
  for (reply of [null, undefined, profile(), { ...acknowledged, configured: false }, { ...acknowledged, settings: { ...acknowledged.settings, dayOverrides: { '2026-11-10': 'work', '2026-11-11': 'rest' } } }]) {
    await assert.rejects(writeDayOverrides(patch), /NIUMA_WRITE_UNCONFIRMED/);
  }
  reply = acknowledged;
  assert.deepEqual(await writeDayOverrides(patch), acknowledged);
});

test('unconfigured web profiles cannot persist schedule changes', async t => {
  const values = new Map([[key, JSON.stringify(DEFAULT_STATE)]]);
  globals(t, { navigator: { userAgent: 'Chrome' } }, { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value) });
  await assert.rejects(writeDayOverrides({ '2026-11-10': 'work' }), /SCHEDULE_UNCONFIGURED/);
  assert.deepEqual(JSON.parse(values.get(key)!), DEFAULT_STATE);
});
