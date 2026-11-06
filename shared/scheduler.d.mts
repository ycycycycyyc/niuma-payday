import type { CalendarCache } from './calendar.mjs';
export interface ScheduleSettings {
  startTime: string;
  endTime: string;
  region: 'CN' | 'HK';
  autoWidget?: boolean;
  dayOverrides: Record<string, 'work' | 'rest'>;
}
export interface SchedulerAppState { configured: boolean; settings: ScheduleSettings; calendar?: CalendarCache }
export interface WidgetSession {
  lastAutoKey: string | null;
  dismissedKey: string | null;
  visibleMode: 'auto' | 'manual' | null;
  visibleKey: string | null;
}
export function getActiveShift(settings: ScheduleSettings | undefined, now: Date, calendar?: CalendarCache): { key: string; anchor: Date; start: Date; end: Date } | null;
export function createWidgetSession(): WidgetSession;
export function decideWidget(appState: SchedulerAppState | null, now: Date, session: WidgetSession, mainVisible?: boolean): { action: 'show' | 'hide' | 'none'; session: WidgetSession };
export function dismissWidget(appState: SchedulerAppState | null, now: Date, session: WidgetSession): WidgetSession;
export function markManualWidget(appState: SchedulerAppState | null, now: Date, session: WidgetSession): WidgetSession;
