export type CalendarRegion = 'CN' | 'HK';
export interface CalendarYear {
  region: CalendarRegion;
  year: number;
  holidays: Record<string, string>;
  makeupWorkdays: Record<string, string>;
  fetchedAt: string;
  source: string;
}
export type CalendarCache = Record<string, CalendarYear>;
export interface DaySettings { region: CalendarRegion; dayOverrides: Record<string, 'work' | 'rest'> }
export interface DayClassification { working: boolean; reason: string; known: boolean; holiday?: string }
export const CALENDAR_SOURCES: Readonly<Record<CalendarRegion, string>>;
export function dateKey(date: Date): string;
export function isValidDateKey(value: unknown): value is string;
export function isValidCalendarYear(value: unknown): value is CalendarYear;
export function normalizeCalendarCache(value: unknown): CalendarCache;
export function classifyDay(date: Date, settings: DaySettings, cache?: CalendarCache): DayClassification;
export function parseCalendarYear(region: CalendarRegion, year: number, data: unknown, fetchedAt?: string): CalendarYear;
export function fetchCalendarYear(region: CalendarRegion, year: number, fetcher?: typeof fetch): Promise<CalendarYear>;
