export type DayOverrides = Record<string, 'work' | 'rest'>;
export type DayOverridePatch = Record<string, 'work' | 'rest' | null>;
export function dayOverridePatch(previous: DayOverrides, next: DayOverrides): DayOverridePatch;
export function applyDayOverridePatch(current: DayOverrides, patch: DayOverridePatch, expected?: DayOverridePatch): DayOverrides;
