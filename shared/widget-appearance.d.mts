export type WidgetAppearance = { scale: number; tint: string; opacity: number };
export const DEFAULT_WIDGET_APPEARANCE: Readonly<WidgetAppearance>;
export const MIN_WIDGET_SCALE: number;
export const MAX_WIDGET_SCALE: number;
export const MIN_WIDGET_OPACITY: number;
export const MAX_WIDGET_OPACITY: number;
export function normalizeWidgetAppearance(value: unknown): WidgetAppearance;
export function validateWidgetAppearance(value: unknown): value is WidgetAppearance;
