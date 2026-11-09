import { isValidDateKey } from './calendar.mjs';

/** Only changed dates are sent when editing a month; null restores the calendar. */
export function dayOverridePatch(previous, next) {
  const patch = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] !== next[key]) patch[key] = next[key] ?? null;
  }
  return patch;
}

/** Run against the latest profile inside its persistence transaction. */
export function applyDayOverridePatch(current, patch, expected) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.entries(patch).some(([key, value]) => !isValidDateKey(key) || !['work', 'rest', null].includes(value))) {
    throw new Error('排班修改包含无效的日期或安排。');
  }
  if (expected !== undefined && (!expected || typeof expected !== 'object' || Array.isArray(expected)
    || Object.entries(expected).some(([key, value]) => !isValidDateKey(key) || !['work', 'rest', null].includes(value)))) {
    throw new Error('排班修改包含无效的原安排。');
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (expected !== undefined && (!Object.hasOwn(expected, key) || (current[key] ?? null) !== expected[key])) {
      throw new Error('所选日期的排班已在其他窗口更新。请取消修改，重新打开月历后核对。');
    }
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
