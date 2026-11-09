import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createProfileBackup, createProfileFileStore, isProfileDocument, parseProfileBackup, profileRevision } from '../shared/profile-backup.mjs';
import { DEFAULT_STATE, deleteSavingsEntry, exportProfileBackup, getProfileRecovery, importProfileBackup, readState, writeState } from '../src/lib/store.ts';

const state = () => ({ ...structuredClone(DEFAULT_STATE), configured: true, settings: { ...structuredClone(DEFAULT_STATE.settings), monthlySalary: 12_345 },
  savings: { '2026-01': { month: '2026-01', currency: 'CNY' as const, salaryCents: 1_234_500, rentCents: 200_000, livingCents: 300_000 } } });

function workspace(t: TestContext) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-backup-test-'));
  t.after(() => {
    const absolute = path.resolve(folder);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('niuma-backup-test-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return path.join(folder, 'state.json');
}

function web(t: TestContext, initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  for (const [key, value] of Object.entries({ localStorage: storage, window: { navigator: { userAgent: 'Chrome', locks: { request: async (_name: string, callback: () => unknown) => callback() } } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { values, storage };
}

test('portable backups round-trip exact monthly snapshots and reject damaged rows before import', () => {
  const original = state();
  const backup = createProfileBackup(original, new Date('2026-11-09T00:00:00Z'));
  assert.deepEqual(parseProfileBackup('\uFEFF' + JSON.stringify(backup)).profile, original);
  assert.throws(() => parseProfileBackup({ ...backup, version: 99 }), /BACKUP_INVALID/);
  assert.throws(() => parseProfileBackup({ ...backup, profile: { ...original, savings: { '2026-01': { ...original.savings['2026-01'], rentCents: -1 } } } }), /BACKUP_INVALID/);
  assert.throws(() => parseProfileBackup('{'), /BACKUP_INVALID/);
  assert.throws(() => parseProfileBackup(' '.repeat(5 * 1024 * 1024 + 1)), /BACKUP_INVALID/);
  const reordered = { savings: original.savings, ...original, settings: { ...original.settings, dayOverrides: {} } };
  assert.equal(profileRevision(reordered), profileRevision(original));
});

test('legacy daily profiles are migrated without inventing a monthly salary', () => {
  const legacy = { version: 2, configured: true, settings: { dailySalary: 900, currency: 'HKD', region: 'CN', payday: 15 }, privacy: true };
  const backup = parseProfileBackup(legacy);
  assert.equal(backup.profile.configured, false);
  assert.equal(backup.profile.settings?.monthlySalary, 0);
  assert.equal(backup.profile.settings?.currency, 'HKD');
  assert.equal(isProfileDocument(backup.profile), true);
  assert.deepEqual(parseProfileBackup(backup), backup);
  const rawCurrent = parseProfileBackup(state());
  assert.equal(rawCurrent.createdAt, null);
  assert.deepEqual(parseProfileBackup(rawCurrent), rawCurrent);
  assert.throws(() => parseProfileBackup({ ...backup, createdAt: 'not-a-date' }), /BACKUP_INVALID/);
  assert.throws(() => parseProfileBackup({ ...backup, createdAt: undefined }), /BACKUP_INVALID/);
});

test('native snapshots rotate valid documents and preserve the exact corrupt source before recovering', t => {
  const filename = workspace(t);
  const original = state();
  const files = createProfileFileStore(fs, filename);
  assert.equal(files.load(), null);
  files.save(original);
  const changed = { ...original, privacy: true };
  files.save(changed);
  assert.deepEqual(JSON.parse(fs.readFileSync(files.backupName(1), 'utf8')), original);
  fs.writeFileSync(filename, '{"broken":', 'utf8');
  const reopened = createProfileFileStore(fs, filename);
  assert.deepEqual(reopened.load(), original);
  assert.equal(reopened.status().status, 'recovered');
  assert.equal(fs.readFileSync(filename, 'utf8'), '{"broken":');
  const quarantines = fs.readdirSync(path.dirname(filename)).filter(name => name.startsWith('state.json.corrupt-'));
  assert.equal(quarantines.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(filename), quarantines[0]), 'utf8'), '{"broken":');
  reopened.save(original);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(files.backupName(1), 'utf8')), original);
});

test('an unpreservable corrupt file blocks calendar-only and profile writes', t => {
  const filename = workspace(t);
  fs.writeFileSync(filename, 'damaged original', 'utf8');
  const restricted = Object.create(fs);
  restricted.writeFileSync = (file: string, ...args: any[]) => {
    if (file.includes('.corrupt-')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return (fs.writeFileSync as any)(file, ...args);
  };
  const files = createProfileFileStore(restricted, filename);
  assert.equal(files.load(), null);
  assert.equal(files.status().status, 'blocked');
  assert.throws(() => files.save({ version: 3, configured: false, calendar: {} }), /PROFILE_RECOVERY_REQUIRED/);
  assert.throws(() => files.save(state()), /PROFILE_RECOVERY_REQUIRED/);
  assert.equal(fs.readFileSync(filename, 'utf8'), 'damaged original');
  assert.equal(fs.existsSync(filename + '.tmp'), false);
});

test('rename failure leaves the original intact and a successful import retains the previous profile', t => {
  const filename = workspace(t);
  const original = state();
  fs.writeFileSync(filename, JSON.stringify(original), 'utf8');
  const failing = Object.create(fs);
  failing.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); };
  const files = createProfileFileStore(failing, filename);
  files.load();
  assert.throws(() => files.save({ ...original, privacy: true }), /locked/);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), original);
  const healthy = createProfileFileStore(fs, filename);
  healthy.load();
  const imported = { ...original, settings: { ...original.settings, monthlySalary: 77_777 }, savings: {} };
  healthy.save(parseProfileBackup(createProfileBackup(imported)).profile);
  assert.deepEqual(JSON.parse(fs.readFileSync(healthy.backupName(1), 'utf8')), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), imported);
});

test('browser corruption recovers without writing over the source; subsequent saves retain recovery evidence', async t => {
  const original = state();
  const { values } = web(t, { 'niuma.payday.v3': '{broken', 'niuma.payday.v3.backup.1': JSON.stringify(original) });
  assert.deepEqual(await readState(), original);
  assert.equal(values.get('niuma.payday.v3'), '{broken');
  assert.equal((await getProfileRecovery()).status, 'recovered');
  assert.equal([...values.keys()].filter(key => key.includes('.corrupt.')).length, 1);
  await writeState({ ...original, privacy: true });
  assert.equal((await readState()).privacy, true);
  assert.ok([...values.values()].includes('{broken'));
  assert.deepEqual(JSON.parse(values.get('niuma.payday.v3.backup.1')!), original);
});

test('a missing browser primary recovers a valid snapshot without writing a new primary', async t => {
  const original = state();
  const { values } = web(t, { 'niuma.payday.v3.backup.1': JSON.stringify(original) });
  assert.deepEqual(await readState(), original);
  assert.equal(values.has('niuma.payday.v3'), false);
  const recovery = await getProfileRecovery();
  assert.equal(recovery.status, 'recovered');
  assert.match(recovery.message, /主资料缺失/);
  assert.equal([...values.keys()].filter(key => key.includes('.corrupt.')).length, 0);
});

test('an empty browser primary is preserved verbatim before recovering a valid snapshot', async t => {
  const original = state();
  const { values } = web(t, { 'niuma.payday.v3': '', 'niuma.payday.v3.backup.1': JSON.stringify(original) });
  assert.deepEqual(await readState(), original);
  assert.equal(values.get('niuma.payday.v3'), '');
  const recovery = await getProfileRecovery();
  assert.equal(recovery.status, 'recovered');
  assert.match(recovery.message, /异常原内容已保留/);
  const preserved = [...values.entries()].filter(([key]) => key.includes('.corrupt.'));
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0][1], '');
});

test('browser imports require the preview revision, back up local data, and preserve exact deleted snapshots on undo', async t => {
  const original = state();
  const { values } = web(t, { 'niuma.payday.v3': JSON.stringify(original) });
  const baseline = profileRevision((await exportProfileBackup()).profile);
  const imported = { ...original, settings: { ...original.settings, monthlySalary: 66_666 }, savings: {} };
  await writeState({ ...original, privacy: true });
  await assert.rejects(importProfileBackup(createProfileBackup(imported), baseline), /BACKUP_CONFLICT/);
  assert.equal((await readState()).settings.monthlySalary, original.settings.monthlySalary);
  const current = await readState();
  await importProfileBackup(createProfileBackup(imported), profileRevision(current));
  assert.deepEqual(JSON.parse(values.get('niuma.payday.v3.backup.1')!), current);
  assert.deepEqual(await readState(), imported);
  await importProfileBackup(createProfileBackup(original), profileRevision(imported));
  await deleteSavingsEntry(original.savings['2026-01']);
  assert.deepEqual((await readState()).savings, {});
});

test('raw state documents remain importable after UI preview has already parsed them', async t => {
  const original = state();
  web(t, { 'niuma.payday.v3': JSON.stringify(original) });
  const incoming = { ...original, settings: { ...original.settings, monthlySalary: 9876 } };
  const preview = parseProfileBackup(JSON.stringify(incoming));
  assert.equal(preview.createdAt, null);
  assert.deepEqual(await importProfileBackup(preview, profileRevision(original)), incoming);
});
