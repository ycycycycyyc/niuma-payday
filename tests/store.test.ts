import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STATE, normalizeState, type AppState } from '../src/lib/store.ts';
import { DEFAULT_SETTINGS } from '../src/lib/salary.ts';
import type { CalendarYear } from '../shared/calendar.mjs';

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
    dailySalary: 800,
    currency: 'HKD',
    region: 'HK',
    autoWidget: false,
    dayOverrides: { '2026-11-07': 'work', '2026-11-09': 'rest' },
  },
  goal: { name: '周末电影', amount: 120 },
  privacy: true,
  calendar: { 'CN-2026': calendarYear() },
});

test('v1 monthly salary is never interpreted as a daily salary or silently configured', () => {
  const oldState = {
    version: 1, configured: true,
    settings: { monthlySalary: 15_000, currency: 'CNY', startTime: '09:00', endTime: '18:00', workdays: [1, 2, 3, 4, 5] },
    goal: { name: '咖啡', amount: 30 }, privacy: true,
  };
  const result = normalizeState(JSON.parse(JSON.stringify(oldState)));
  assert.equal(result.version, 2);
  assert.equal(result.configured, false);
  assert.equal(result.settings.dailySalary, DEFAULT_SETTINGS.dailySalary);
  assert.equal('monthlySalary' in result.settings, false);
  assert.deepEqual(result.goal, oldState.goal);
  assert.equal(result.privacy, true);
  // A daily-looking field in a legacy version must also require confirmation.
  assert.equal(normalizeState({ ...oldState, settings: { ...DEFAULT_SETTINGS, dailySalary: 15_000 } }).configured, false);
});

test('valid v2 state survives JSON persistence with manual exceptions and cached holidays', () => {
  const original = configuredState();
  const persisted = JSON.parse(JSON.stringify(original));
  const result = normalizeState(persisted);
  assert.deepEqual(result, original);
  assert.equal(result.settings.dailySalary, 800);
  assert.equal(result.settings.dayOverrides['2026-11-07'], 'work');
  assert.equal(result.settings.dayOverrides['2026-11-09'], 'rest');
  assert.equal(result.settings.autoWidget, false);
});

test('invalid v2 settings restore safe defaults and turn off real mode', () => {
  const invalidSettings = [
    { dailySalary: 0 }, { dailySalary: -1 }, { dailySalary: NaN }, { dailySalary: Infinity },
    { dailySalary: '800' }, { dailySalary: 1_000_000_001 }, { startTime: '25:00' },
    { endTime: '09:00' }, { currency: 'XYZ' }, { region: 'US' }, { autoWidget: 'yes' },
    { dayOverrides: { '2026-02-30': 'work' } }, { dayOverrides: { '2026-11-07': 'holiday' } },
  ];
  for (const invalid of invalidSettings) {
    const state = configuredState();
    const result = normalizeState({ ...state, settings: { ...DEFAULT_SETTINGS, ...invalid } });
    assert.equal(result.configured, false, JSON.stringify(invalid));
    assert.deepEqual(result.settings, DEFAULT_SETTINGS, JSON.stringify(invalid));
    assert.deepEqual(result.goal, state.goal);
  }
});

test('missing daily amount cannot activate a v2 state using the default rate', () => {
  assert.equal(normalizeState({ version: 2, configured: true, settings: { currency: 'HKD' } }).configured, false);
  assert.equal(normalizeState({ version: 2, configured: 'true', settings: DEFAULT_SETTINGS }).configured, false);
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
