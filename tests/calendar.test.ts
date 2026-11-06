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
test('mainland parsing validates neighboring-year records before filtering to the requested year', () => {
  const result = parseCalendarYear('CN', 2026, { ...cnData, days: [
    { date: '2025-12-31', name: '元旦', isOffDay: true },
    ...cnData.days,
    { date: '2027-01-02', name: '元旦', isOffDay: false },
  ] }, stamp);
  assert.deepEqual(result.holidays, { '2026-01-01': '元旦' });
  assert.deepEqual(result.makeupWorkdays, { '2026-01-04': '元旦' });
  assert.ok(isValidCalendarYear(result));
  assert.throws(() => parseCalendarYear('CN', 2026, { ...cnData, days: [
    { date: '2025-12-31', name: '元旦', isOffDay: true },
  ] }), /尚未提供/);
  for (const badRecord of [
    { date: '2027-02-29', name: '无效日期', isOffDay: true },
    { date: '2027-01-01', name: '', isOffDay: true },
    { date: '2027-01-01', name: '元旦', isOffDay: 'true' },
  ]) {
    assert.throws(() => parseCalendarYear('CN', 2026, { ...cnData, days: [...cnData.days, badRecord] }), /格式/);
  }
  const outsideYear = { date: '2025-12-31', name: '元旦', isOffDay: true };
  assert.throws(() => parseCalendarYear('CN', 2026, { ...cnData, days: [...cnData.days, outsideYear, outsideYear] }), /重复/);
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
  const observed: string[] = [];
  const fake = (async (url: string | URL | Request, options?: RequestInit) => {
    observed.push(String(url));
    assert.deepEqual(Object.keys(options ?? {}).sort(), ['headers', 'signal']);
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    return new Response('\uFEFF' + JSON.stringify(cnData), { status: 200 });
  }) as typeof fetch;
  const result = await fetchCalendarYear('CN', 2026, fake);
  assert.deepEqual(observed, [
    'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json',
    'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2027.json',
  ]);
  assert.equal(result.holidays['2026-01-01'], '元旦');
});
test('fetch supplements December from the following year and newer date classifications win', async () => {
  const primary = { ...cnData, days: [...cnData.days, { date: '2026-12-31', name: '旧安排', isOffDay: false }] };
  const following = { year: 2027, days: [
    { date: '2026-12-30', name: '元旦', isOffDay: false },
    { date: '2026-12-31', name: '元旦', isOffDay: true },
    { date: '2027-01-01', name: '元旦', isOffDay: true },
  ] };
  const fake = (async (url: string | URL | Request) => new Response(JSON.stringify(
    String(url).endsWith('/2026.json') ? primary : following,
  ))) as typeof fetch;
  const result = await fetchCalendarYear('CN', 2026, fake);
  assert.deepEqual(result.holidays, { '2026-01-01': '元旦', '2026-12-31': '元旦' });
  assert.deepEqual(result.makeupWorkdays, { '2026-01-04': '元旦', '2026-12-30': '元旦' });
  assert.equal(result.year, 2026);
  assert.equal(result.nextYearChecked, true);
  assert.ok(isValidCalendarYear(result));
  assert.deepEqual(primary.days.at(-1), { date: '2026-12-31', name: '旧安排', isOffDay: false });
});
test('unpublished, mismatched, malformed or invalid supplemental calendars preserve a valid primary year', async () => {
  const invalidSupplements = [
    () => new Response('', { status: 404 }),
    () => new Response('{'),
    () => new Response(JSON.stringify(cnData)),
    () => new Response(JSON.stringify({ year: 2027, days: [
      { date: '2027-01-01', name: '元旦', isOffDay: true },
      { date: '2026-02-30', name: '无效日期', isOffDay: true },
    ] })),
    () => new Response(JSON.stringify({ year: 2027, days: [
      { date: '2027-01-01', name: '元旦', isOffDay: true },
      { date: '2027-01-01', name: '元旦', isOffDay: false },
    ] })),
    () => { throw new Error('offline'); },
  ];
  for (const supplementalResponse of invalidSupplements) {
    const fake = (async (url: string | URL | Request) => String(url).endsWith('/2026.json')
      ? new Response(JSON.stringify(cnData)) : supplementalResponse()) as typeof fetch;
    const result = await fetchCalendarYear('CN', 2026, fake);
    assert.deepEqual(result.holidays, { '2026-01-01': '元旦' });
    assert.deepEqual(result.makeupWorkdays, { '2026-01-04': '元旦' });
    assert.equal(result.nextYearChecked, false);
  }
});
test('a failed supplemental refresh preserves an already checked cache and its original timestamp', async () => {
  const previous = { ...parseCalendarYear('CN', 2026, cnData, stamp), nextYearChecked: true,
    holidays: { '2026-01-01': '元旦', '2026-12-31': '元旦' } };
  const before = JSON.stringify(previous);
  const fake = (async (url: string | URL | Request) => String(url).endsWith('/2026.json')
    ? new Response(JSON.stringify(cnData)) : new Response('', { status: 404 })) as typeof fetch;
  await assert.rejects(fetchCalendarYear('CN', 2026, fake, previous), /次年补充日历更新失败/);
  assert.equal(JSON.stringify(previous), before);
  assert.equal(previous.fetchedAt, stamp);
  assert.equal(previous.holidays['2026-12-31'], '元旦');
  const legacy = await fetchCalendarYear('CN', 2026, fake, parseCalendarYear('CN', 2026, cnData, stamp));
  assert.equal(legacy.nextYearChecked, false);
  const differentRegion = { ...previous, region: 'HK' as const };
  assert.equal((await fetchCalendarYear('CN', 2026, fake, differentRegion)).nextYearChecked, false);
  assert.equal(isValidCalendarYear({ ...previous, nextYearChecked: 'true' }), false);
});
test('a partial following-year arrangement cannot replace a missing target-year calendar', async () => {
  const following = { year: 2027, days: [
    { date: '2026-12-31', name: '元旦', isOffDay: true },
    { date: '2027-01-01', name: '元旦', isOffDay: true },
  ] };
  const fake = (async (url: string | URL | Request) => String(url).endsWith('/2026.json')
    ? new Response('', { status: 404 }) : new Response(JSON.stringify(following))) as typeof fetch;
  await assert.rejects(fetchCalendarYear('CN', 2026, fake), /2026 年假日日历尚未提供/);
});
test('Hong Kong fetch uses its single official feed and still filters to the target year', async () => {
  const urls: string[] = [];
  const fake = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(hkData));
  }) as typeof fetch;
  const result = await fetchCalendarYear('HK', 2026, fake);
  assert.deepEqual(urls, ['https://www.1823.gov.hk/common/ical/sc.json']);
  assert.deepEqual(result.holidays, { '2026-01-01': '一月一日', '2026-12-25': '圣诞节' });
});
test('fetch failures leave an existing cache intact', async () => {
  const cache = { 'CN-2026': parseCalendarYear('CN', 2026, cnData, stamp) };
  const before = JSON.stringify(cache);
  const failed = (async () => new Response('', { status: 404 })) as typeof fetch;
  await assert.rejects(fetchCalendarYear('CN', 2027, failed), /尚未提供/);
  assert.equal(JSON.stringify(cache), before);
});
