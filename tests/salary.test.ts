import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSalary, DEFAULT_SETTINGS, earningsBetween, validateSettings, type SalarySettings, type CalendarCache } from '../src/lib/salary.ts';

process.env.TZ = 'Asia/Shanghai';
const settings = (changes: Partial<SalarySettings> = {}): SalarySettings => ({ ...DEFAULT_SETTINGS, dailySalary: 800, lunchEnabled: true, dayOverrides: {}, ...changes });
const at = (date: string) => new Date(date);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const calendar: CalendarCache = {
  'CN-2026': { region: 'CN', year: 2026, holidays: { '2026-01-01': '元旦', '2026-10-01': '国庆节', '2026-10-02': '国庆节' }, makeupWorkdays: { '2026-10-10': '国庆节' }, fetchedAt: '2026-01-01T00:00:00Z', source: 'https://example.test/CN-2026.json' },
  'CN-2027': { region: 'CN', year: 2027, holidays: { '2027-01-01': '元旦' }, makeupWorkdays: {}, fetchedAt: '2026-11-01T00:00:00Z', source: 'https://example.test/CN-2027.json' },
  'HK-2026': { region: 'HK', year: 2026, holidays: { '2026-12-25': '圣诞节' }, makeupWorkdays: {}, fetchedAt: '2026-01-01T00:00:00Z', source: 'https://example.test/HK-2026.json' },
};

test('daily salary accrues over paid seconds without depending on month length', () => {
  const s = calculateSalary(settings(), at('2026-11-05T11:00:00'), calendar);
  assert.equal(s.workingDaysInMonth, 21); assert.equal(s.completedWorkdays, 3);
  assert.equal(s.status, 'working'); assert.equal(s.elapsedPaidSeconds, 7200); assert.equal(s.totalPaidSeconds, 28800);
  close(s.todayEarned, 200); close(s.monthEarned, 2600); close(s.progress, .25);
  assert.equal(calculateSalary(settings(), at('2027-02-01T11:00:00')).dailySalary, 800);
  assert.equal(s.calendarNotice, null);
});
test('optional unpaid lunch pauses earnings at exact boundaries', () => {
  const start = calculateSalary(settings(), at('2026-11-05T12:00:00'));
  const during = calculateSalary(settings(), at('2026-11-05T12:59:59'));
  const end = calculateSalary(settings(), at('2026-11-05T13:00:00'));
  assert.equal(start.status, 'break'); assert.equal(during.status, 'break'); assert.equal(end.status, 'working');
  close(start.todayEarned, 300); close(during.todayEarned, start.todayEarned); close(end.todayEarned, start.todayEarned);
});
test('before work, after work, and weekends do not inflate salary', () => {
  const before = calculateSalary(settings(), at('2026-11-05T08:59:59'));
  const after = calculateSalary(settings(), at('2026-11-05T23:59:59'));
  const saturday = calculateSalary(settings(), at('2026-11-07T15:00:00'));
  assert.equal(before.status, 'before'); assert.equal(before.todayEarned, 0);
  assert.equal(after.status, 'after'); assert.equal(after.remainingSeconds, 0); close(after.todayEarned, 800);
  assert.equal(saturday.status, 'off'); assert.equal(saturday.todayEarned, 0); assert.equal(saturday.shiftStart, null); close(saturday.monthEarned, 4000);
});
test('sleep/reopen derives the same amount directly from wall-clock time', () => {
  const first = calculateSalary(settings(), at('2026-11-05T09:00:00'));
  const reopened = calculateSalary(settings(), at('2026-11-05T17:00:00'));
  assert.equal(first.todayEarned, 0); close(reopened.todayEarned, 700);
  assert.deepEqual(reopened, calculateSalary(settings(), at('2026-11-05T17:00:00')));
});
test('month sum uses day count times entered daily salary', () => {
  const s = calculateSalary(settings(), at('2026-11-30T23:59:59'));
  close(s.monthEarned, 16800); assert.equal(s.completedWorkdays, 21); assert.equal(s.progress, 1);
});
test('known holidays exclude weekdays and a makeup weekend stays manual', () => {
  const holiday = calculateSalary(settings(), at('2026-10-01T15:00:00'), calendar);
  assert.equal(holiday.status, 'off'); assert.equal(holiday.todayEarned, 0); assert.equal(holiday.workingDaysInMonth, 20); assert.match(holiday.dayReason, /国庆节/);
  const makeup = calculateSalary(settings(), at('2026-10-10T15:00:00'), calendar);
  assert.equal(makeup.status, 'off'); assert.match(makeup.dayReason, /调休/);
});
test('manual work and rest override calendar only on the chosen date and persist in totals', () => {
  const manual = settings({ dayOverrides: { '2026-10-01': 'work', '2026-10-10': 'work', '2026-11-05': 'rest' } });
  assert.equal(calculateSalary(manual, at('2026-10-01T11:00:00'), calendar).todayEarned, 200);
  assert.equal(calculateSalary(manual, at('2026-10-10T11:00:00'), calendar).status, 'working');
  assert.equal(calculateSalary(manual, at('2026-10-11T11:00:00'), calendar).status, 'off');
  assert.equal(calculateSalary(manual, at('2026-11-05T11:00:00'), calendar).status, 'off');
  assert.equal(calculateSalary(manual, at('2026-11-30T23:00:00'), calendar).monthEarned, 16000);
});
test('Hong Kong and mainland caches remain separate', () => {
  const hk = calculateSalary(settings({ region: 'HK' }), at('2026-12-25T14:00:00'), calendar);
  const cn = calculateSalary(settings(), at('2026-12-25T14:00:00'), calendar);
  assert.equal(hk.status, 'off'); assert.match(hk.dayReason, /圣诞节/); assert.equal(cn.status, 'working');
});
test('unknown year uses weekday estimate with explicit notice', () => {
  const s = calculateSalary(settings(), at('2028-01-03T11:00:00'), calendar);
  assert.equal(s.status, 'working'); assert.ok(s.calendarNotice); assert.match(s.dayReason, /2028/);
});
test('overnight shift uses its start day, including after-midnight lunch and weekend', () => {
  const night = settings({ startTime: '22:00', endTime: '06:00', lunchStart: '02:00', lunchEnd: '03:00' });
  const s = calculateSalary(night, at('2026-11-07T02:30:00'));
  assert.equal(s.status, 'break'); assert.equal(s.shiftStart?.getDate(), 6); assert.equal(s.shiftEnd?.getDate(), 7);
  assert.equal(s.elapsedPaidSeconds, 14400); assert.equal(s.totalPaidSeconds, 25200); close(s.todayEarned, 800 * 4 / 7);
  assert.equal(s.week.find(day => day.isToday)?.date.getDate(), 6);
  const ended = calculateSalary(night, at('2026-11-07T06:00:00'));
  assert.equal(ended.status, 'off'); close(ended.monthEarned, 4000);
});
test('overnight year boundary follows prior shift into holiday without leaking monthly totals', () => {
  const night = settings({ startTime: '22:00', endTime: '06:00', lunchEnabled: false });
  const s = calculateSalary(night, at('2027-01-01T02:00:00'), calendar);
  assert.equal(s.shiftStart?.getFullYear(), 2026); close(s.todayEarned, 400); assert.equal(s.monthEarned, 0); assert.equal(s.status, 'working');
  assert.equal(calculateSalary(night, at('2027-01-01T06:00:00'), calendar).status, 'off');
});
test('payday clamps to short month and counts calendar days', () => {
  const before = calculateSalary(settings({ payday: 31 }), at('2027-02-27T19:00:00'));
  const onDay = calculateSalary(settings({ payday: 31 }), at('2027-02-28T23:00:00'));
  const after = calculateSalary(settings({ payday: 10 }), at('2026-11-11T01:00:00'));
  assert.equal(before.nextPayday.getDate(), 28); assert.equal(before.daysToPayday, 1); assert.equal(onDay.daysToPayday, 0);
  assert.equal(after.nextPayday.getMonth(), 11); assert.equal(after.daysToPayday, 29);
});
test('week starts Monday and future earnings stay zero', () => {
  const s = calculateSalary(settings(), at('2026-11-05T15:00:00'));
  assert.equal(s.week.length, 7); assert.equal(s.week[0].label, '周一'); assert.equal(s.week[0].date.getDate(), 2);
  assert.equal(s.week[3].isToday, true); assert.equal(s.week[4].isFuture, true); assert.equal(s.week[4].earned, 0);
});
test('default setup accrues during lunch', () => {
  const s = calculateSalary(DEFAULT_SETTINGS, at('2026-11-05T12:30:00'));
  assert.equal(s.status, 'working'); assert.equal(s.totalPaidSeconds, 32400); close(s.todayEarned, DEFAULT_SETTINGS.dailySalary * 3.5 / 9);
});
test('paid-break timer excludes unpaid lunch, off-hours, weekends and holidays', () => {
  close(earningsBetween(settings(), at('2026-11-05T11:30:00'), at('2026-11-05T13:30:00')), 100);
  close(earningsBetween(settings(), at('2026-11-06T17:00:00'), at('2026-11-09T10:00:00')), 200);
  assert.equal(earningsBetween(settings(), at('2026-11-07T11:00:00'), at('2026-11-08T15:00:00')), 0);
  assert.equal(earningsBetween(settings(), at('2026-11-05T12:00:00'), at('2026-11-05T13:00:00')), 0);
  assert.equal(earningsBetween(settings(), at('2026-10-01T09:00:00'), at('2026-10-02T18:00:00'), calendar), 0);
});
test('paid-break timer follows night shift across year boundary', () => {
  const night = settings({ startTime: '22:00', endTime: '06:00', lunchEnabled: false });
  close(earningsBetween(night, at('2026-12-31T23:00:00'), at('2027-01-01T02:00:00'), calendar), 300);
  close(earningsBetween(night, at('2026-12-31T22:00:00'), at('2027-01-02T06:00:00'), calendar), 800);
});
test('rejects invalid salary, time, date override and lunch settings', () => {
  assert.deepEqual(validateSettings(settings()), {});
  assert.ok(validateSettings(settings({ dailySalary: NaN })).dailySalary); assert.ok(validateSettings(settings({ dailySalary: 0 })).dailySalary);
  assert.ok(validateSettings(settings({ startTime: '24:00' })).startTime); assert.ok(validateSettings(settings({ endTime: '09:00' })).endTime);
  assert.ok(validateSettings(settings({ dayOverrides: { '2026-02-30': 'work' } })).dayOverrides);
  assert.ok(validateSettings(settings({ payday: 1.5 })).payday);
  assert.ok(validateSettings(settings({ lunchStart: '08:00', lunchEnd: '10:00' })).lunchEnd);
  assert.ok(validateSettings(settings({ lunchStart: '09:00', lunchEnd: '18:00' })).lunchEnd);
  assert.throws(() => calculateSalary(settings({ dailySalary: -1 }), new Date()), RangeError);
  assert.throws(() => calculateSalary(settings(), new Date('invalid')), RangeError);
});
test('DST shifts use elapsed time while dates remain local', () => {
  const originalZone = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const days = settings({ startTime: '00:00', endTime: '08:00', lunchEnabled: false, dayOverrides: { '2026-03-08': 'work', '2026-11-01': 'work' } });
    const spring = calculateSalary(days, at('2026-03-08T08:00:00'));
    assert.equal(spring.totalPaidSeconds, 25200); close(spring.todayEarned, 800); assert.equal(spring.daysToPayday, 2);
    const fall = calculateSalary(days, at('2026-11-01T08:00:00'));
    assert.equal(fall.totalPaidSeconds, 32400); close(fall.todayEarned, 800);
  } finally { process.env.TZ = originalZone; }
});
