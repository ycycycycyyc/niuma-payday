import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDay } from '../shared/calendar.mjs';
import { applyDayOverridePatch, calculateSalary, dayOverridePatch, DEFAULT_SETTINGS, getScheduleContext, type SalarySettings } from '../src/lib/salary.ts';

process.env.TZ = 'Asia/Shanghai';
const night = (overrides: SalarySettings['dayOverrides'] = {}): SalarySettings => ({
  ...DEFAULT_SETTINGS, startTime: '22:00', endTime: '06:00', lunchEnabled: false, dayOverrides: overrides,
});

test('schedule controls match the active Friday night shift after midnight on a resting Saturday', () => {
  const now = new Date('2026-11-07T01:00:00');
  const settings = night();
  const salary = calculateSalary(settings, now);
  const schedule = getScheduleContext(settings, now);
  assert.equal(schedule.dateKey, '2026-11-06');
  assert.equal(schedule.isPreviousShift, true);
  assert.equal(schedule.working, true);
  assert.equal(schedule.label, '11月6日夜班');
  assert.equal(schedule.date.getTime(), new Date('2026-11-06T00:00:00').getTime());
  assert.equal(salary.shiftStart?.getDate(), schedule.date.getDate());
  assert.equal(classifyDay(now, settings).working, false);
  const overrides = applyDayOverridePatch(settings.dayOverrides, { [schedule.dateKey]: 'rest' });
  assert.equal(overrides['2026-11-06'], 'rest');
  assert.equal(overrides['2026-11-07'], undefined);
  assert.equal(calculateSalary({ ...settings, dayOverrides: overrides }, now).status, 'off');
});

test('at an overnight shift end controls return to the current calendar date', () => {
  const schedule = getScheduleContext(night(), new Date('2026-11-07T06:00:00'));
  assert.equal(schedule.dateKey, '2026-11-07');
  assert.equal(schedule.isPreviousShift, false);
  assert.equal(schedule.working, false);
  assert.equal(schedule.label, '今日班次');
});

test('cross-year and manually enabled weekend shifts keep their start date in controls', () => {
  const newYear = getScheduleContext(night(), new Date('2027-01-01T01:00:00'));
  assert.equal(newYear.dateKey, '2026-12-31');
  assert.equal(newYear.isPreviousShift, true);
  const weekend = getScheduleContext(night({ '2026-11-07': 'work' }), new Date('2026-11-08T02:00:00'));
  assert.equal(weekend.dateKey, '2026-11-07');
  assert.equal(weekend.working, true);
  assert.equal(weekend.reason, '上班 · 手动开启');
  const rest = getScheduleContext(night({ '2026-11-06': 'rest' }), new Date('2026-11-07T02:00:00'));
  assert.equal(rest.dateKey, '2026-11-07');
  assert.equal(rest.isPreviousShift, false);
});

test('daytime controls keep today and invalid settings or dates cannot change the target', () => {
  assert.equal(getScheduleContext(DEFAULT_SETTINGS, new Date('2026-11-06T11:00:00')).dateKey, '2026-11-06');
  assert.throws(() => getScheduleContext(DEFAULT_SETTINGS, new Date('invalid')), /当前时间无效/);
  assert.throws(() => getScheduleContext({ ...DEFAULT_SETTINGS, endTime: '25:00' }, new Date()), /有效/);
});

test('date patches retain unrelated newer overrides, support restoration, and never mutate inputs', () => {
  const original = { '2026-11-06': 'work', '2026-11-08': 'rest' } as const;
  const draft = { '2026-11-06': 'rest', '2026-11-09': 'work' } as const;
  const patch = dayOverridePatch(original, draft);
  assert.deepEqual(patch, { '2026-11-06': 'rest', '2026-11-08': null, '2026-11-09': 'work' });
  const latest = { ...original, '2026-11-10': 'rest' } as const;
  const merged = applyDayOverridePatch(latest, patch, { '2026-11-06': 'work', '2026-11-08': 'rest', '2026-11-09': null });
  assert.deepEqual(merged, { '2026-11-06': 'rest', '2026-11-09': 'work', '2026-11-10': 'rest' });
  assert.equal(latest['2026-11-08'], 'rest');
  assert.equal(original['2026-11-06'], 'work');
  assert.deepEqual(dayOverridePatch(original, { ...original }), {});
});

test('conflicting changes on an edited date and malformed patches are rejected', () => {
  assert.throws(() => applyDayOverridePatch({ '2026-11-06': 'rest' }, { '2026-11-06': 'work' }, { '2026-11-06': null }), /其他窗口更新/);
  assert.throws(() => applyDayOverridePatch({}, { '2026-11-06': 'work' }, {}), /其他窗口更新/);
  assert.throws(() => applyDayOverridePatch({}, { '2026-02-30': 'rest' }), /无效/);
  assert.throws(() => applyDayOverridePatch({}, { '2200-01-01': 'work' }), /无效/);
  assert.throws(() => applyDayOverridePatch({}, { '2026-11-06': 'other' } as never), /无效/);
  assert.throws(() => applyDayOverridePatch({}, null as never), /无效/);
});

test('future scheduling changes only its own month and preserves the weekend default policy', () => {
  const overrides = applyDayOverridePatch({}, { '2026-12-05': 'work', '2026-12-07': 'rest' });
  const settings = { ...DEFAULT_SETTINGS, dayOverrides: overrides };
  assert.equal(classifyDay(new Date('2026-12-05T12:00:00'), settings).working, true);
  assert.equal(classifyDay(new Date('2026-12-06T12:00:00'), settings).working, false);
  assert.equal(classifyDay(new Date('2026-12-07T12:00:00'), settings).working, false);
  assert.equal(calculateSalary(settings, new Date('2026-11-05T12:00:00')).workingDaysInMonth, 21);
  assert.equal(calculateSalary(settings, new Date('2026-12-05T12:00:00')).workingDaysInMonth, 23);
});
