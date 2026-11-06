import test from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetSession, decideWidget, dismissWidget, getActiveShift, markManualWidget, type SchedulerAppState } from '../shared/scheduler.mjs';

const at = (text: string) => new Date(text);
const base: SchedulerAppState = {
  configured: true,
  settings: { region: 'CN', autoWidget: true, startTime: '09:00', endTime: '18:00', dayOverrides: {} },
  calendar: {
    'CN-2026': {
      region: 'CN', year: 2026, fetchedAt: '2026-01-01T00:00:00.000Z', source: 'https://example.test/2026.json',
      holidays: { '2026-10-01': '国庆节' }, makeupWorkdays: { '2026-10-10': '国庆节调休' },
    },
  },
};

test('a weekday begins and ends at the configured local wall-clock boundaries', () => {
  assert.equal(getActiveShift(base.settings, at('2026-11-06T08:59:59'), base.calendar), null);
  const shift = getActiveShift(base.settings, at('2026-11-06T09:00:00'), base.calendar)!;
  assert.equal(shift.key, 'CN-2026-11-06');
  assert.equal(shift.end.getHours(), 18);
  assert.equal(getActiveShift(base.settings, at('2026-11-06T18:00:00'), base.calendar), null);
});

test('weekends and public holidays do not automatically show; makeup weekends require manual work override', () => {
  for (const day of ['2026-11-07', '2026-11-08', '2026-10-01', '2026-10-10']) {
    assert.equal(decideWidget(base, at(`${day}T10:00:00`), createWidgetSession()).action, 'none');
  }
  const override = { ...base, settings: { ...base.settings, dayOverrides: { '2026-10-10': 'work' as const } } };
  assert.equal(decideWidget(override, at('2026-10-10T10:00:00'), createWidgetSession()).action, 'show');
});

test('overnight shifts keep their start-day classification after midnight, including a holiday boundary', () => {
  const night = { ...base.settings, startTime: '22:00', endTime: '06:00' };
  assert.equal(getActiveShift(night, at('2026-10-01T02:00:00'), base.calendar)?.key, 'CN-2026-09-30');
  assert.equal(getActiveShift(night, at('2026-10-01T22:00:00'), base.calendar), null);
  assert.equal(getActiveShift(night, at('2026-11-07T02:00:00'), base.calendar)?.key, 'CN-2026-11-06');
  assert.equal(getActiveShift(night, at('2026-11-07T06:00:00'), base.calendar), null);
});

test('visible main window postpones automatic popup without consuming the shift', () => {
  const session = createWidgetSession();
  assert.equal(decideWidget(base, at('2026-11-06T10:00:00'), session, true).action, 'none');
  assert.equal(decideWidget(base, at('2026-11-06T10:01:00'), session, false).action, 'show');
});

test('automatic widget appears once, stays during lunch, then hides at end of shift', () => {
  const shown = decideWidget(base, at('2026-11-06T09:00:00'), createWidgetSession());
  assert.equal(shown.action, 'show');
  assert.equal(decideWidget(base, at('2026-11-06T12:30:00'), shown.session).action, 'none');
  const ended = decideWidget(base, at('2026-11-06T18:00:00'), shown.session);
  assert.equal(ended.action, 'hide');
  assert.equal(decideWidget(base, at('2026-11-09T09:00:00'), ended.session).action, 'show');
});

test('hiding or restoring main suppresses repeated popup for that shift, and resets on the next workday', () => {
  const now = at('2026-11-06T10:00:00');
  const dismissed = dismissWidget(base, now, createWidgetSession());
  assert.equal(decideWidget(base, at('2026-11-06T11:00:00'), dismissed).action, 'none');
  assert.equal(decideWidget(base, at('2026-11-09T10:00:00'), dismissed).action, 'show');
});

test('manual widget can remain visible on holidays and after work, independent of automatic switch', () => {
  const manual = markManualWidget(base, at('2026-10-01T10:00:00'), createWidgetSession());
  assert.equal(manual.visibleMode, 'manual');
  assert.equal(decideWidget(base, at('2026-10-01T20:00:00'), manual).action, 'none');
  assert.equal(decideWidget({ ...base, settings: { ...base.settings, autoWidget: false } }, at('2026-11-06T10:00:00'), manual).action, 'none');
});

test('switching auto off, choosing rest today, or receiving a holiday update closes an automatic widget', () => {
  const now = at('2026-11-06T10:00:00');
  const shown = decideWidget(base, now, createWidgetSession()).session;
  assert.equal(decideWidget({ ...base, settings: { ...base.settings, autoWidget: false } }, now, shown).action, 'hide');
  assert.equal(decideWidget({ ...base, settings: { ...base.settings, dayOverrides: { '2026-11-06': 'rest' } } }, now, shown).action, 'hide');
  const holiday = { ...base, calendar: { 'CN-2026': { ...base.calendar!['CN-2026'], holidays: { '2026-11-06': '测试假期' } } } };
  assert.equal(decideWidget(holiday, now, shown).action, 'hide');
});

test('incomplete setup, invalid clocks and disabled automation never start a popup', () => {
  const now = at('2026-11-06T10:00:00');
  assert.equal(decideWidget(null, now, createWidgetSession()).action, 'none');
  assert.equal(decideWidget({ ...base, configured: false }, now, createWidgetSession()).action, 'none');
  assert.equal(decideWidget({ ...base, settings: { ...base.settings, autoWidget: false } }, now, createWidgetSession()).action, 'none');
  assert.equal(getActiveShift({ ...base.settings, startTime: '25:00' }, now), null);
  assert.equal(getActiveShift({ ...base.settings, startTime: '09:00', endTime: '09:00' }, now), null);
  assert.equal(getActiveShift(base.settings, new Date('invalid')), null);
});
