/** Shared by Electron and the renderer. All dates are the computer's local dates. */
export const CALENDAR_SOURCES = Object.freeze({
  CN: 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/',
  HK: 'https://www.1823.gov.hk/common/ical/sc.json',
});

export function dateKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('日期无效');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2199 && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validRegionYear = (region, year) => ['CN', 'HK'].includes(region) && Number.isInteger(year) && year >= 2000 && year <= 2199;
const names = (value, year) => record(value) && Object.entries(value).every(([date, name]) =>
  isValidDateKey(date) && Number(date.slice(0, 4)) === year && typeof name === 'string' && name.trim().length > 0 && name.length <= 200);

export function isValidCalendarYear(value) {
  return record(value) && validRegionYear(value.region, value.year)
    && names(value.holidays, value.year) && Object.keys(value.holidays).length > 0
    && names(value.makeupWorkdays, value.year)
    && Object.keys(value.makeupWorkdays).every(date => !Object.hasOwn(value.holidays, date))
    && typeof value.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt))
    && typeof value.source === 'string' && value.source.startsWith('https://') && value.source.length < 2048;
}

/** Discard damaged entries individually. A failed refresh must never replace this cache. */
export function normalizeCalendarCache(value) {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    isValidCalendarYear(entry) && key === `${entry.region}-${entry.year}`));
}

export function classifyDay(date, settings, cache = {}) {
  const key = dateKey(date);
  const override = settings.dayOverrides?.[key];
  if (override === 'work') return { working: true, reason: '今天上班 · 手动开启', known: true };
  if (override === 'rest') return { working: false, reason: '今天休息 · 手动设置', known: true };
  const year = date.getFullYear();
  const entry = cache?.[`${settings.region}-${year}`];
  const known = isValidCalendarYear(entry) && entry.region === settings.region && entry.year === year;
  const holiday = known ? entry.holidays[key] : undefined;
  if (holiday) return { working: false, reason: `${holiday} · 假日休息`, known: true, holiday };
  const weekday = date.getDay() > 0 && date.getDay() < 6;
  if (!weekday) {
    const makeup = known ? entry.makeupWorkdays[key] : undefined;
    return { working: false, reason: makeup ? `${makeup}调休 · 可点“今天上班”` : '周末休息', known };
  }
  return { working: true, reason: known ? '工作日' : `${year} 年假日日历未确认 · 暂按周一至周五`, known };
}

/** Parse the upstream's own formats; absent years are errors, never empty holiday lists. */
export function parseCalendarYear(region, year, data, fetchedAt = new Date().toISOString()) {
  if (!validRegionYear(region, year)) throw new RangeError('不支持的地区或年份');
  const holidays = {};
  const makeupWorkdays = {};
  const source = region === 'CN' ? `${CALENDAR_SOURCES.CN}${year}.json` : CALENDAR_SOURCES.HK;
  if (region === 'CN') {
    if (!record(data) || data.year !== year || !Array.isArray(data.days) || data.days.length === 0) {
      throw new Error(`${year} 年中国大陆假日日历尚未提供`);
    }
    for (const item of data.days) {
      if (!record(item) || !isValidDateKey(item.date) || Number(item.date.slice(0, 4)) !== year
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || typeof item.isOffDay !== 'boolean') {
        throw new Error('中国大陆日历数据格式不完整');
      }
      if (Object.hasOwn(holidays, item.date) || Object.hasOwn(makeupWorkdays, item.date)) throw new Error('日历包含重复日期');
      (item.isOffDay ? holidays : makeupWorkdays)[item.date] = item.name.trim();
    }
  } else {
    if (!record(data) || !Array.isArray(data.vcalendar) || data.vcalendar.length === 0) throw new Error('香港日历数据格式不完整');
    for (const calendar of data.vcalendar) {
      if (!Array.isArray(calendar?.vevent)) throw new Error('香港日历缺少假日记录');
      for (const item of calendar.vevent) {
        const compact = item?.dtstart?.[0];
        if (typeof compact !== 'string' || !/^\d{8}$/.test(compact)) throw new Error('香港日历日期格式无效');
        const key = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
        if (!isValidDateKey(key) || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 200) {
          throw new Error('香港日历假日记录无效');
        }
        if (Number(compact.slice(0, 4)) === year) holidays[key] = item.summary.trim();
      }
    }
    if (Object.keys(holidays).length === 0) throw new Error(`${year} 年香港假日日历尚未提供`);
  }
  const result = { region, year, holidays, makeupWorkdays, fetchedAt, source };
  if (!isValidCalendarYear(result)) throw new Error('假日日历数据校验失败');
  return result;
}

/** Fetches public calendar data only. No salary or user setting is sent to the service. */
export async function fetchCalendarYear(region, year, fetcher = globalThis.fetch) {
  if (!validRegionYear(region, year)) throw new RangeError('不支持的地区或年份');
  const url = region === 'CN' ? `${CALENDAR_SOURCES.CN}${year}.json` : CALENDAR_SOURCES.HK;
  const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? `${year} 年假日日历尚未提供` : `假日日历更新失败 (${response.status})`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('假日日历数据过大');
  return parseCalendarYear(region, year, JSON.parse(text.replace(/^\uFEFF/, '')));
}
