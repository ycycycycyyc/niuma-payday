export const DEFAULT_WIDGET_APPEARANCE = Object.freeze({ scale: 1, tint: '#f9dfeb', opacity: .36 });
export const MIN_WIDGET_SCALE = .85;
export const MAX_WIDGET_SCALE = 1.5;
export const MIN_WIDGET_OPACITY = .15;
export const MAX_WIDGET_OPACITY = 1;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTint = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const clampOrDefault = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

// Persisted preferences are untrusted: recover each field without discarding the others.
export function normalizeWidgetAppearance(value) {
  const source = isRecord(value) ? value : {};
  return {
    scale: clampOrDefault(source.scale, MIN_WIDGET_SCALE, MAX_WIDGET_SCALE, DEFAULT_WIDGET_APPEARANCE.scale),
    tint: isTint(source.tint) ? source.tint.toLowerCase() : DEFAULT_WIDGET_APPEARANCE.tint,
    opacity: clampOrDefault(source.opacity, MIN_WIDGET_OPACITY, MAX_WIDGET_OPACITY, DEFAULT_WIDGET_APPEARANCE.opacity),
  };
}

// IPC writes must contain the complete, bounded appearance contract.
export function validateWidgetAppearance(value) {
  return isRecord(value) && Object.keys(value).length === 3
    && Object.keys(value).every(key => ['scale', 'tint', 'opacity'].includes(key))
    && inRange(value.scale, MIN_WIDGET_SCALE, MAX_WIDGET_SCALE)
    && isTint(value.tint) && inRange(value.opacity, MIN_WIDGET_OPACITY, MAX_WIDGET_OPACITY);
}
