export type CalendarRegion = 'CN' | 'HK';
export interface CalendarYear {
  region: CalendarRegion;
  year: number;
  holidays: Record<string, string>;
  makeupWorkdays: Record<string, string>;
  fetchedAt: string;
  source: string;
  /** Mainland source and the following year's cross-year arrangements were both validated. */
  nextYearChecked?: boolean;
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
/** Validates all source records, while retaining only dates in the requested year. */
export function parseCalendarYear(region: CalendarRegion, year: number, data: unknown, fetchedAt?: string): CalendarYear;
/** Includes next-year amendments; rejects an incomplete refresh when previous contains confirmed amendments. */
export function fetchCalendarYear(region: CalendarRegion, year: number, fetcher?: typeof fetch, previous?: CalendarYear): Promise<CalendarYear>;
