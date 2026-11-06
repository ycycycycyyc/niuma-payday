import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATE, normalizeState, type AppState } from '../src/lib/store.ts';
import { DEFAULT_SETTINGS } from '../src/lib/salary.ts';
import type { CalendarYear } from '../shared/calendar.mjs';
import { migrateLegacyProfile } from '../shared/profile-migration.mjs';

const calendarYear = (changes: Partial<CalendarYear> = {}): CalendarYear => ({
  region: 'CN',
  year: 2026,
  holidays: { '2026-10-01': '国庆节' },
  makeupWorkdays: { '2026-10-10': '国庆节' },
  fetchedAt: '2026-09-01T00:00:00.000Z',
  source: 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json',
  ...changes,
});

const configuredState = (): AppState => ({
  ...structuredClone(DEFAULT_STATE),
  configured: true,
  settings: {
    ...structuredClone(DEFAULT_SETTINGS),
    monthlySalary: 16_800,
    currency: 'HKD',
    region: 'HK',
    autoWidget: false,
    dayOverrides: { '2026-11-07': 'work', '2026-11-09': 'rest' },
  },
  goal: { name: '周末电影', amount: 120 },
  privacy: true,
  calendar: { 'CN-2026': calendarYear() },
});

test('v1 monthly salary is retained for review without silently activating a changed calendar policy', () => {
  const oldState = {
    version: 1, configured: true,
    settings: { monthlySalary: 15_000, currency: 'CNY', startTime: '09:00', endTime: '18:00', workdays: [1, 2, 3, 4, 5] },
    goal: { name: '咖啡', amount: 30 }, privacy: true,
  };
  const result = normalizeState(JSON.parse(JSON.stringify(oldState)));
  assert.equal(result.version, 3);
  assert.equal(result.configured, false);
  assert.equal(result.settings.monthlySalary, 15_000);
  assert.equal('dailySalary' in result.settings, false);
  assert.deepEqual(result.goal, oldState.goal);
  assert.equal(result.privacy, true);
  assert.equal(normalizeState({ ...oldState, settings: { dailySalary: 15_000 } }).settings.monthlySalary, 0);
});

test('valid v3 state survives JSON persistence with manual exceptions and cached holidays', () => {
  const original = configuredState();
  const persisted = JSON.parse(JSON.stringify(original));
  const result = normalizeState(persisted);
  assert.deepEqual(result, original);
  assert.equal(result.settings.monthlySalary, 16_800);
  assert.equal(result.settings.dayOverrides['2026-11-07'], 'work');
  assert.equal(result.settings.dayOverrides['2026-11-09'], 'rest');
  assert.equal(result.settings.autoWidget, false);
});

test('invalid v3 settings restore safe defaults and turn off real mode', () => {
  const invalidSettings = [
    { monthlySalary: 0 }, { monthlySalary: -1 }, { monthlySalary: NaN }, { monthlySalary: Infinity },
    { monthlySalary: '800' }, { monthlySalary: 1_000_000_001 }, { startTime: '25:00' },
    { endTime: '09:00' }, { currency: 'XYZ' }, { region: 'US' }, { autoWidget: 'yes' },
    { dayOverrides: { '2026-02-30': 'work' } }, { dayOverrides: { '2026-11-07': 'holiday' } },
    { paydayMode: 'unknown' }, { payday: 0 },
  ];
  for (const invalid of invalidSettings) {
    const state = configuredState();
    const result = normalizeState({ ...state, settings: { ...DEFAULT_SETTINGS, ...invalid } });
    assert.equal(result.configured, false, JSON.stringify(invalid));
    assert.deepEqual(result.settings, DEFAULT_SETTINGS, JSON.stringify(invalid));
    assert.deepEqual(result.goal, state.goal);
  }
});

test('missing monthly amount cannot activate a v3 state using the default rate', () => {
  assert.equal(normalizeState({ version: 3, configured: true, settings: { currency: 'HKD' } }).configured, false);
  assert.equal(normalizeState({ version: 3, configured: 'true', settings: DEFAULT_SETTINGS }).configured, false);
});

test('daily profiles preserve HKD plus mainland holidays and all preferences while requiring a monthly amount', () => {
  const current = configuredState();
  const { monthlySalary: _monthly, paydayMode: _mode, ...preferences } = current.settings;
  const legacy = { ...current, version: 2, settings: { ...preferences, dailySalary: 680, region: 'CN' } };
  const migrated = migrateLegacyProfile(JSON.parse(JSON.stringify(legacy)));
  const result = normalizeState(migrated);
  assert.equal(result.version, 3);
  assert.equal(result.configured, false);
  assert.equal(result.settings.monthlySalary, 0);
  assert.equal(result.settings.currency, 'HKD');
  assert.equal(result.settings.region, 'CN');
  assert.equal(result.settings.paydayMode, 'fixed-day');
  assert.equal(result.settings.payday, legacy.settings.payday);
  assert.equal(result.settings.autoWidget, false);
  assert.deepEqual(result.settings.dayOverrides, legacy.settings.dayOverrides);
  assert.deepEqual(result.goal, legacy.goal);
  assert.equal(result.privacy, true);
  assert.deepEqual(result.calendar, legacy.calendar);
  assert.equal('dailySalary' in result.settings, false);
  // A restart of the already migrated, unconfigured document keeps the preferences.
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(result))), result);
  assert.deepEqual(migrateLegacyProfile(result), result);
});

test('new installations default to the last workday while legacy fixed dates remain explicit', () => {
  assert.equal(normalizeState(null).settings.paydayMode, 'last-workday');
  const old = { version: 2, configured: true, settings: { dailySalary: 500, payday: 10, currency: 'HKD', region: 'CN' } };
  const result = normalizeState(old);
  assert.equal(result.settings.paydayMode, 'fixed-day');
  assert.equal(result.settings.payday, 10);
  assert.equal(result.settings.currency, 'HKD');
  assert.equal(result.settings.region, 'CN');
});

test('legacy first-run documents retain privacy, goals and calendars before salary settings exist', () => {
  const legacy = { version: 2, configured: false, privacy: true, goal: { name: '电影', amount: 100 },
    calendar: { 'CN-2026': calendarYear() } };
  const migrated = migrateLegacyProfile(JSON.parse(JSON.stringify(legacy))) as AppState;
  // The main process sees a complete v3 document before its own strict validation.
  assert.equal(migrated.version, 3);
  assert.equal(migrated.configured, false);
  assert.equal(migrated.settings.monthlySalary, 0);
  assert.equal(migrated.privacy, true);
  const result = normalizeState(migrated);
  assert.deepEqual(result.goal, legacy.goal);
  assert.deepEqual(result.calendar, legacy.calendar);
  assert.equal(result.privacy, true);
  assert.equal(result.settings.monthlySalary, 0);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(result))), result);
});

test('damaged calendar entries are discarded individually without losing the valid cached year', () => {
  const valid = calendarYear();
  const result = normalizeState({
    ...configuredState(),
    calendar: {
      'CN-2026': valid,
      'HK-2026': calendarYear(), // key does not match region
      'CN-2027': calendarYear({ year: 2027 }), // holiday dates belong to 2026
      'CN-2028': calendarYear({ year: 2028, holidays: { '2028-02-30': '无效日期' } }),
      'CN-2029': null,
      'CN-2030': calendarYear({ year: 2030, holidays: {}, makeupWorkdays: {} }),
      'CN-2031': calendarYear({ year: 2031, holidays: { '2031-01-01': '元旦' }, makeupWorkdays: {}, fetchedAt: 'invalid' }),
    },
  });
  assert.deepEqual(result.calendar, { 'CN-2026': valid });
  assert.equal(result.configured, true);
  assert.deepEqual(normalizeState({ ...configuredState(), calendar: [] }).calendar, {});
});

test('bad goal and truthy nonboolean privacy values do not propagate into the app', () => {
  for (const goal of [null, { name: ' ', amount: 25 }, { name: '咖啡', amount: -1 }, { name: '咖啡', amount: '25' }, { name: '咖啡', amount: 100_000_001 }]) {
    const result = normalizeState({ ...configuredState(), goal, privacy: 'true' });
    assert.deepEqual(result.goal, DEFAULT_STATE.goal);
    assert.equal(result.privacy, false);
  }
  const bounded = normalizeState({ ...configuredState(), goal: { name: '  ' + 'a'.repeat(40) + '  ', amount: 25 } });
  assert.equal(bounded.goal.name, 'a'.repeat(32));
});

test('empty or corrupt top-level data enters demo mode with a fresh default object', () => {
  for (const input of [undefined, null, false, 5, 'broken', []]) {
    const result = normalizeState(input);
    assert.equal(result.configured, false);
    assert.deepEqual(result.settings, DEFAULT_SETTINGS);
    assert.deepEqual(result.calendar, {});
  }
  const result = normalizeState(null);
  result.settings.dayOverrides['2026-11-07'] = 'work';
  result.goal.name = 'Changed';
  assert.deepEqual(DEFAULT_SETTINGS.dayOverrides, {});
  assert.equal(DEFAULT_STATE.goal.name, '今天的咖啡自由');
});
