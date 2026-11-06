import { classifyDay, dateKey } from './calendar.mjs';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** Resolve an active shift by its start date, including the preceding overnight shift. */
export function getActiveShift(settings, now, calendar = {}) {
  if (!settings || !Number.isFinite(now?.getTime?.()) || !TIME.test(settings.startTime)
    || !TIME.test(settings.endTime) || settings.startTime === settings.endTime) return null;
  const startMinutes = toMinutes(settings.startTime);
  let endMinutes = toMinutes(settings.endTime);
  if (endMinutes <= startMinutes) endMinutes += 1440;
  for (const offset of [-1, 0]) {
    const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!classifyDay(anchor, settings, calendar).working) continue;
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, startMinutes);
    const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, endMinutes);
    if (now >= start && now < end) return { key: `${settings.region}-${dateKey(anchor)}`, anchor, start, end };
  }
  return null;
}

export const createWidgetSession = () => ({ lastAutoKey: null, dismissedKey: null, visibleMode: null, visibleKey: null });

/** Pure decision logic: manual windows survive off-hours; automatic windows close at shift end. */
export function decideWidget(appState, now, session, mainVisible = false) {
  const active = getActiveShift(appState?.settings, now, appState?.calendar);
  const enabled = appState?.configured === true && appState?.settings?.autoWidget === true;
  if (session.visibleMode === 'auto' && (!enabled || !active || session.visibleKey !== active.key)) {
    return { action: 'hide', session: { ...session, visibleMode: null, visibleKey: null } };
  }
  if (!enabled || !active || mainVisible || session.visibleMode
    || session.lastAutoKey === active.key || session.dismissedKey === active.key) {
    return { action: 'none', session };
  }
  return { action: 'show', session: { ...session, lastAutoKey: active.key, visibleMode: 'auto', visibleKey: active.key } };
}

export function dismissWidget(appState, now, session) {
  const active = getActiveShift(appState?.settings, now, appState?.calendar);
  return { ...session, dismissedKey: active?.key ?? session.dismissedKey, visibleMode: null, visibleKey: null };
}

export function markManualWidget(appState, now, session) {
  const active = getActiveShift(appState?.settings, now, appState?.calendar);
  return { ...session, visibleMode: 'manual', visibleKey: active?.key ?? null };
}
