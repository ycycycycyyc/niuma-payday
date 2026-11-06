import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDay, dateKey, fetchCalendarYear, isValidCalendarYear, normalizeCalendarCache, parseCalendarYear } from '../shared/calendar.mjs';

const stamp = '2026-11-06T00:00:00Z';
const cnData = { year: 2026, days: [{ date: '2026-01-01', name: '元旦', isOffDay: true }, { date: '2026-01-04', name: '元旦', isOffDay: false }] };
const hkData = { vcalendar: [{ vevent: [
  { dtstart: ['20260101', { value: 'DATE' }], summary: '一月一日' },
  { dtstart: ['20261225', { value: 'DATE' }], summary: '圣诞节' },
  { dtstart: ['20270101', { value: 'DATE' }], summary: '一月一日' },
] }] };
const settings = { region: 'CN' as const, dayOverrides: {} };

test('parses mainland isOffDay and keeps makeup dates separate', () => {
  const result = parseCalendarYear('CN', 2026, cnData, stamp);
  assert.equal(result.holidays['2026-01-01'], '元旦'); assert.equal(result.makeupWorkdays['2026-01-04'], '元旦');
  assert.equal(result.fetchedAt, stamp); assert.ok(isValidCalendarYear(result));
  const cache = { 'CN-2026': result };
  assert.equal(classifyDay(new Date(2026, 0, 1), settings, cache).working, false);
  assert.equal(classifyDay(new Date(2026, 0, 4), settings, cache).working, false);
  assert.equal(classifyDay(new Date(2026, 0, 5), settings, cache).working, true);
});
test('parses official Hong Kong nested JSON and filters year', () => {
  const result = parseCalendarYear('HK', 2026, hkData, stamp);
  assert.deepEqual(result.holidays, { '2026-01-01': '一月一日', '2026-12-25': '圣诞节' });
  assert.deepEqual(result.makeupWorkdays, {}); assert.throws(() => parseCalendarYear('HK', 2028, hkData), /尚未提供/);
});
test('rejects missing years, malformed and conflicting upstream records', () => {
  assert.throws(() => parseCalendarYear('CN', 2027, cnData), /尚未提供/);
  assert.throws(() => parseCalendarYear('CN', 2026, { year: 2026, days: [] }), /尚未提供/);
  assert.throws(() => parseCalendarYear('CN', 2026, { year: 2026, days: [{ date: '2026-02-30', name: 'bad', isOffDay: true }] }));
  assert.throws(() => parseCalendarYear('CN', 2026, { year: 2026, days: [...cnData.days, cnData.days[0]] }), /重复/);
  assert.throws(() => parseCalendarYear('HK', 2026, { vcalendar: [{ vevent: [{ dtstart: ['20260230'], summary: 'bad' }] }] }));
});
test('normalization keeps valid older cache and removes mismatched or damaged entries', () => {
  const entry = parseCalendarYear('CN', 2026, cnData, stamp);
  const cache = { 'CN-2026': entry, 'CN-2027': entry, 'HK-2026': { ...entry, holidays: {} } };
  assert.deepEqual(normalizeCalendarCache(cache), { 'CN-2026': entry });
  assert.equal(classifyDay(new Date(2027, 0, 1), settings, cache).known, false);
  assert.equal(classifyDay(new Date(2027, 0, 1), settings, cache).working, true);
  assert.equal(classifyDay(new Date(2026, 0, 1), settings, cache).known, true);
});
test('manual override precedes holidays or unknown calendars', () => {
  const cache = { 'CN-2026': parseCalendarYear('CN', 2026, cnData) };
  assert.equal(classifyDay(new Date(2026, 0, 1), { ...settings, dayOverrides: { '2026-01-01': 'work' } }, cache).working, true);
  assert.equal(classifyDay(new Date(2026, 0, 5), { ...settings, dayOverrides: { '2026-01-05': 'rest' } }).working, false);
  assert.equal(dateKey(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
});
test('fetch handles BOM and sends no private settings', async () => {
  let observed = '';
  const fake = (async (url: string | URL | Request) => { observed = String(url); return new Response('\uFEFF' + JSON.stringify(cnData), { status: 200 }); }) as typeof fetch;
  const result = await fetchCalendarYear('CN', 2026, fake);
  assert.equal(observed, 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json');
  assert.equal(result.holidays['2026-01-01'], '元旦');
});
test('fetch failures leave an existing cache intact', async () => {
  const cache = { 'CN-2026': parseCalendarYear('CN', 2026, cnData, stamp) };
  const before = JSON.stringify(cache);
  const failed = (async () => new Response('', { status: 404 })) as typeof fetch;
  await assert.rejects(fetchCalendarYear('CN', 2027, failed), /尚未提供/);
  assert.equal(JSON.stringify(cache), before);
});
