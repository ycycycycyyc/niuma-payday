import { classifyDay, dateKey, isValidDateKey, type CalendarCache } from '../../shared/calendar.mjs';
export type { CalendarCache, CalendarYear } from '../../shared/calendar.mjs';
export { dayOverridePatch, applyDayOverridePatch, type DayOverridePatch } from '../../shared/day-overrides.mjs';

/** All schedules use the computer's local time zone. Currency is display-only. */
export interface SalarySettings {
  monthlySalary: number;
  currency: 'CNY' | 'HKD' | 'USD';
  startTime: string;
  endTime: string;
  region: 'CN' | 'HK';
  autoWidget: boolean;
  /** Exceptions apply to the shift's start date, including overnight shifts. */
  dayOverrides: Record<string, 'work' | 'rest'>;
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  paydayMode: 'last-workday' | 'fixed-day';
  payday: number;
}

export const DEFAULT_SETTINGS: SalarySettings = {
  monthlySalary: 10000,
  currency: 'CNY',
  startTime: '09:00',
  endTime: '18:00',
  region: 'CN',
  autoWidget: true,
  dayOverrides: {},
  lunchEnabled: false,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  paydayMode: 'last-workday',
  payday: 1,
};

export type SalaryStatus = 'working' | 'break' | 'before' | 'after' | 'off';

export interface SalarySnapshot {
  todayEarned: number;
  monthEarned: number;
  dailySalary: number;
  hourlyRate: number;
  perSecond: number;
  workingDaysInMonth: number;
  completedWorkdays: number;
  elapsedPaidSeconds: number;
  totalPaidSeconds: number;
  /** Wall-clock time until the selected shift ends, including unpaid lunch. */
  remainingSeconds: number;
  /** Paid-time progress in the range 0–1. */
  progress: number;
  status: SalaryStatus;
  statusLabel: string;
  dayReason: string;
  calendarNotice: string | null;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  nextPayday: Date | null;
  daysToPayday: number | null;
  paydayEstimated: boolean;
  week: Array<{
    date: Date;
    label: string;
    earned: number;
    isToday: boolean;
    isFuture: boolean;
  }>;
}

const DAY_SECONDS = 86_400;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const STATUS_LABELS: Record<SalaryStatus, string> = {
  working: '正在赚钱',
  break: '午休时间',
  before: '还没上班',
  after: '今日已下班',
  off: '今天休息',
};

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function scheduleMinutes(settings: SalarySettings) {
  const start = minutes(settings.startTime);
  let end = minutes(settings.endTime);
  if (end <= start) end += 1440;
  let lunchStart = minutes(settings.lunchStart);
  if (lunchStart < start) lunchStart += 1440;
  let lunchEnd = minutes(settings.lunchEnd);
  while (lunchEnd <= lunchStart) lunchEnd += 1440;
  return { start, end, lunchStart, lunchEnd };
}

export function validateSettings(settings: SalarySettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isFinite(settings.monthlySalary) || settings.monthlySalary <= 0 || settings.monthlySalary > 1_000_000_000) {
    errors.monthlySalary = '请输入大于 0、且不超过 10 亿元的月薪';
  }
  if (!['CNY', 'HKD', 'USD'].includes(settings.currency)) errors.currency = '请选择支持的币种';
  if (!['CN', 'HK'].includes(settings.region)) errors.region = '请选择中国大陆或香港';
  if (typeof settings.autoWidget !== 'boolean') errors.autoWidget = '自动浮窗设置无效';
  if (!settings.dayOverrides || typeof settings.dayOverrides !== 'object' || Array.isArray(settings.dayOverrides)
    || Object.entries(settings.dayOverrides).some(([key, value]) => !isValidDateKey(key) || !['work', 'rest'].includes(value))) {
    errors.dayOverrides = '手动工作日设置无效';
  }
  if (!['last-workday', 'fixed-day'].includes(settings.paydayMode)) errors.paydayMode = '请选择有效的发薪方式';
  if (!Number.isInteger(settings.payday) || settings.payday < 1 || settings.payday > 31) {
    errors.payday = '发薪日应为 1–31 的整数';
  }
  if (typeof settings.lunchEnabled !== 'boolean') errors.lunchEnabled = '午休设置无效';
  for (const key of ['startTime', 'endTime', 'lunchStart', 'lunchEnd'] as const) {
    if (typeof settings[key] !== 'string' || !TIME_PATTERN.test(settings[key])) errors[key] = '请使用有效的时:分格式';
  }
  if (!errors.startTime && !errors.endTime && settings.startTime === settings.endTime) {
    errors.endTime = '上下班时间不能相同';
  }
  if (settings.lunchEnabled && !errors.startTime && !errors.endTime && !errors.lunchStart && !errors.lunchEnd) {
    const { start, end, lunchStart, lunchEnd } = scheduleMinutes(settings);
    if (lunchStart < start || lunchEnd > end || lunchEnd - lunchStart >= end - start) {
      errors.lunchEnd = '午休必须位于班次内，并且短于整个班次';
    }
  }
  return errors;
}

function localDay(date: Date, offset = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function atMinutes(day: Date, value: number): Date {
  // Construct wall-clock dates, rather than adding 24 hours, so DST transitions work.
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, value, 0, 0);
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (DAY_SECONDS * 1000);
}

interface MonthSchedule {
  workingDays: number;
  dailySalary: number;
  known: boolean;
  lastWorkday: Date | null;
}

/** Cache within one calculation only, so calendar/settings edits immediately reprice it. */
function createMonthResolver(settings: SalarySettings, calendar: CalendarCache) {
  const months = new Map<string, MonthSchedule>();
  return (day: Date): MonthSchedule => {
    const year = day.getFullYear();
    const month = day.getMonth();
    const key = `${year}-${month}`;
    const cached = months.get(key);
    if (cached) return cached;
    const end = new Date(year, month + 1, 0).getDate();
    let workingDays = 0;
    let known = true;
    let lastWorkday: Date | null = null;
    for (let date = 1; date <= end; date++) {
      const anchor = new Date(year, month, date);
      const classification = classifyDay(anchor, settings, calendar);
      known &&= classification.known;
      if (classification.working) {
        workingDays++;
        lastWorkday = anchor;
      }
    }
    const result = { workingDays, dailySalary: workingDays ? settings.monthlySalary / workingDays : 0, known, lastWorkday };
    months.set(key, result);
    return result;
  };
}

interface Shift {
  anchor: Date;
  start: Date;
  end: Date;
  lunchStart: Date | null;
  lunchEnd: Date | null;
  totalPaidSeconds: number;
  dailySalary: number;
}

function makeShift(settings: SalarySettings, anchor: Date, dailySalary: number): Shift {
  const values = scheduleMinutes(settings);
  const start = atMinutes(anchor, values.start);
  const end = atMinutes(anchor, values.end);
  const lunchStart = settings.lunchEnabled ? atMinutes(anchor, values.lunchStart) : null;
  const lunchEnd = settings.lunchEnabled ? atMinutes(anchor, values.lunchEnd) : null;
  const breakSeconds = lunchStart && lunchEnd ? overlapSeconds(start, end, lunchStart, lunchEnd) : 0;
  const totalPaidSeconds = Math.max(0, (end.getTime() - start.getTime()) / 1000 - breakSeconds);
  return {
    anchor,
    start,
    end,
    lunchStart,
    lunchEnd,
    totalPaidSeconds,
    dailySalary,
  };
}

/** The date shown by schedule controls must match an active overnight shift. */
export function getScheduleContext(settings: SalarySettings, now: Date, calendar: CalendarCache = {}) {
  const errors = validateSettings(settings);
  if (Object.keys(errors).length) throw new RangeError(Object.values(errors)[0]);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('当前时间无效');
  const today = localDay(now);
  const yesterday = localDay(now, -1);
  const prior = classifyDay(yesterday, settings, calendar).working ? makeShift(settings, yesterday, 0) : null;
  const isPreviousShift = prior !== null && now >= prior.start && now < prior.end;
  const date = isPreviousShift ? yesterday : today;
  const classification = classifyDay(date, settings, calendar);
  return {
    ...classification,
    reason: isPreviousShift ? classification.reason.replace(/^今天上班/, '上班').replace(/^今天休息/, '休息') : classification.reason,
    date,
    dateKey: dateKey(date),
    isPreviousShift,
    label: isPreviousShift ? `${date.getMonth() + 1}月${date.getDate()}日夜班` : '今日班次',
  };
}

function overlapSeconds(start: Date, end: Date, from: Date, to: Date): number {
  return Math.max(0, Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime())) / 1000;
}

function paidSeconds(shift: Shift, now: Date): number {
  const elapsed = overlapSeconds(shift.start, shift.end, shift.start, now);
  const lunch = shift.lunchStart && shift.lunchEnd
    ? overlapSeconds(shift.lunchStart, shift.lunchEnd, shift.start, new Date(Math.min(now.getTime(), shift.end.getTime())))
    : 0;
  return Math.min(shift.totalPaidSeconds, Math.max(0, elapsed - lunch));
}

function earnedAt(shift: Shift, now: Date): number {
  // A zero-duration shift can occur if an entire short shift falls in a DST gap.
  if (shift.totalPaidSeconds === 0) return now >= shift.end ? shift.dailySalary : 0;
  return shift.dailySalary * (paidSeconds(shift, now) / shift.totalPaidSeconds);
}

function nextPayDate(settings: SalarySettings, now: Date, monthFor: ReturnType<typeof createMonthResolver>) {
  const year = now.getFullYear();
  const month = now.getMonth();
  let estimated = false;
  for (let offset = 0; offset < 24; offset++) {
    const firstDay = new Date(year, month + offset, 1);
    let candidate: Date | null;
    if (settings.paydayMode === 'last-workday') {
      const schedule = monthFor(firstDay);
      estimated ||= !schedule.known;
      candidate = schedule.lastWorkday;
    } else {
      const lastDay = new Date(year, month + offset + 1, 0).getDate();
      candidate = new Date(year, month + offset, Math.min(settings.payday, lastDay));
    }
    if (candidate && calendarDayNumber(candidate) >= calendarDayNumber(now)) return { date: candidate, estimated };
  }
  return { date: null, estimated };
}

/** Earnings attributable to an interval, for a paid-break timer; lunch/off-hours add zero. */
export function earningsBetween(settings: SalarySettings, start: Date, end: Date, calendar: CalendarCache = {}): number {
  const errors = validateSettings(settings);
  if (Object.keys(errors).length > 0) throw new RangeError(Object.values(errors)[0]);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new RangeError('计时区间无效');
  if (end <= start) return 0;
  const days = calendarDayNumber(end) - calendarDayNumber(start);
  if (days > 3660) throw new RangeError('单次计时不能超过 10 年');
  const monthFor = createMonthResolver(settings, calendar);
  let total = 0;
  // Include the preceding day's shift because an interval can start after midnight.
  for (let offset = -1; offset <= days; offset++) {
    const anchor = localDay(start, offset);
    if (!classifyDay(anchor, settings, calendar).working) continue;
    const shift = makeShift(settings, anchor, monthFor(anchor).dailySalary);
    total += Math.max(0, earnedAt(shift, end) - earnedAt(shift, start));
  }
  return total;
}

/**
 * Estimate earnings from the schedule, not a timer or attendance log. Monthly salary
 * is shared by that month's scheduled days. Overnight earnings use the shift's start
 * date; monthEarned sums only shifts starting in the current month. Missing calendars
 * use weekdays with a notice. Reopening/sleep never loses accrued scheduled earnings.
 */
export function calculateSalary(settings: SalarySettings, now: Date, calendar: CalendarCache = {}): SalarySnapshot {
  const errors = validateSettings(settings);
  if (Object.keys(errors).length > 0) throw new RangeError(Object.values(errors)[0]);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('当前时间无效');

  const monthFor = createMonthResolver(settings, calendar);
  const shiftFor = (day: Date) => makeShift(settings, day, monthFor(day).dailySalary);
  const today = localDay(now);
  const yesterday = localDay(now, -1);
  const yesterdayShift = classifyDay(yesterday, settings, calendar).working ? shiftFor(yesterday) : null;
  // At an overnight shift's exact end, use today's schedule/status.
  const previousIsActive = yesterdayShift !== null && now >= yesterdayShift.start && now < yesterdayShift.end;
  const anchor = previousIsActive ? yesterday : today;
  const selected = previousIsActive ? yesterdayShift :
    classifyDay(today, settings, calendar).working ? shiftFor(today) : null;
  const selectedDay = classifyDay(anchor, settings, calendar);

  let status: SalaryStatus = 'off';
  if (selected) {
    if (now < selected.start) status = 'before';
    else if (now >= selected.end) status = 'after';
    else if (selected.lunchStart && selected.lunchEnd && now >= selected.lunchStart && now < selected.lunchEnd) status = 'break';
    else status = 'working';
  }

  const currentMonth = monthFor(today);
  const workingDaysInMonth = currentMonth.workingDays;
  let earningsEstimated = !currentMonth.known || !monthFor(anchor).known;
  let monthEarned = 0;
  let completedWorkdays = 0;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let date = 1; date <= daysInMonth; date++) {
    const dateAnchor = new Date(now.getFullYear(), now.getMonth(), date);
    if (!classifyDay(dateAnchor, settings, calendar).working) continue;
    const shift = shiftFor(dateAnchor);
    monthEarned += earnedAt(shift, now);
    if (now >= shift.end) completedWorkdays++;
  }

  // For an overnight Monday shift, the week stays anchored to Monday even after midnight.
  const monday = localDay(anchor, -((anchor.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = localDay(monday, index);
    const shift = classifyDay(date, settings, calendar).working ? shiftFor(date) : null;
    if (shift && now > shift.start) earningsEstimated ||= !monthFor(date).known;
    return {
      date,
      label: WEEKDAY_LABELS[date.getDay()],
      earned: shift ? earnedAt(shift, now) : 0,
      isToday: calendarDayNumber(date) === calendarDayNumber(anchor),
      isFuture: calendarDayNumber(date) > calendarDayNumber(anchor),
    };
  });

  const elapsedPaidSeconds = selected ? paidSeconds(selected, now) : 0;
  const totalPaidSeconds = selected?.totalPaidSeconds ?? 0;
  const dailySalary = selected?.dailySalary ?? currentMonth.dailySalary;
  // Retain an informative nominal rate on a rest day, without accruing any earnings.
  const referenceSeconds = selected?.totalPaidSeconds ?? shiftFor(today).totalPaidSeconds;
  const perSecond = referenceSeconds > 0 ? dailySalary / referenceSeconds : 0;
  const payday = nextPayDate(settings, now, monthFor);
  const notices: string[] = [];
  if (earningsEstimated || payday.estimated) notices.push('部分日期的假日日历尚未确认，收入或发薪日暂按周一至周五估算；可更新日历或手动设置上班、休息。');
  if (!workingDaysInMonth) notices.push('本月无工作日，月薪暂不分摊，增长为 0。');
  if (!payday.date) notices.push('未来 24 个月内无可用工作日，暂无法确定发薪日。');

  return {
    todayEarned: selected ? earnedAt(selected, now) : 0,
    monthEarned: workingDaysInMonth > 0 && completedWorkdays === workingDaysInMonth
      ? settings.monthlySalary : Math.max(0, Math.min(settings.monthlySalary, monthEarned)),
    dailySalary,
    hourlyRate: perSecond * 3600,
    perSecond,
    workingDaysInMonth,
    completedWorkdays,
    elapsedPaidSeconds,
    totalPaidSeconds,
    remainingSeconds: selected ? Math.max(0, (selected.end.getTime() - now.getTime()) / 1000) : 0,
    progress: totalPaidSeconds > 0 ? elapsedPaidSeconds / totalPaidSeconds : 0,
    status,
    statusLabel: STATUS_LABELS[status],
    dayReason: selectedDay.reason,
    calendarNotice: notices.length ? notices.join(' ') : null,
    shiftStart: selected?.start ?? null,
    shiftEnd: selected?.end ?? null,
    nextPayday: payday.date,
    daysToPayday: payday.date ? calendarDayNumber(payday.date) - calendarDayNumber(now) : null,
    paydayEstimated: payday.estimated,
    week,
  };
}
