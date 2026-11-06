import { DEFAULT_SETTINGS, validateSettings, type SalarySettings } from './salary';
import { normalizeCalendarCache, type CalendarCache } from '../../shared/calendar.mjs';
import { isDesktopHost } from './desktop-error';

export type AppState = { version: 2; configured: boolean; settings: SalarySettings; goal: { name: string; amount: number }; privacy: boolean; calendar: CalendarCache };
export type WidgetLayer = 'top' | 'bottom';
export type DesktopPetState = { phase: 'docked' | 'chasing' | 'returning'; dockX?: number; facing?: 1 | -1 };
export const DEFAULT_STATE: AppState = { version: 2, configured: false, settings: DEFAULT_SETTINGS, goal: { name: '今天的咖啡自由', amount: 25 }, privacy: false, calendar: {} };
const KEY = 'niuma.payday.v2';

declare global {
  interface Window {
    niuma?: {
      platform: string;
      getState(): Promise<unknown>;
      setState(state: unknown): Promise<unknown>;
      setPrivacy?(hidden: boolean): Promise<boolean>;
      onStateChanged(callback: (state: unknown) => void): () => void;
      refreshCalendar(): Promise<{ status: string; message: string; calendar: CalendarCache }>;
      showWidget(): Promise<void>; hideWidget(): Promise<void>; restoreMain(): Promise<void>;
      getWidgetLayer?(): Promise<WidgetLayer>;
      setWidgetLayer?(layer: WidgetLayer): Promise<WidgetLayer>;
      onWidgetLayerChanged?(callback: (layer: WidgetLayer) => void): () => void;
      getDesktopPetState?(): Promise<DesktopPetState>;
      setDesktopPetMode?(mode: { active: boolean; reducedMotion: boolean }): Promise<DesktopPetState>;
      onDesktopPetState?(callback: (state: DesktopPetState) => void): () => void;
      setWidgetPet?(state: { left: number; top: number; width: number; height: number; chasing: boolean; facing?: 1 | -1 }): void;
      onWidgetPointer?(callback: (point: { x: number; y: number }) => void): () => void;
      minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void>;
      onWindowState(callback: (state: { maximized: boolean }) => void): () => void;
    };
  }
}

export function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_STATE);
  const input = value as Partial<AppState>;
  // A monthly amount cannot be interpreted as a daily amount. Ask for the new rate once.
  const isDaily = input.version === 2 && input.settings && Number.isFinite(input.settings.dailySalary);
  const settings = isDaily ? { ...DEFAULT_SETTINGS, ...input.settings } : { ...DEFAULT_SETTINGS };
  let valid = false;
  try { valid = Object.keys(validateSettings(settings)).length === 0; } catch { /* Restore damaged state safely. */ }
  return {
    version: 2, configured: Boolean(isDaily && input.configured === true && valid),
    settings: valid ? settings : { ...DEFAULT_SETTINGS },
    goal: input.goal && typeof input.goal.name === 'string' && input.goal.name.trim() && Number.isFinite(input.goal.amount) && input.goal.amount > 0 && input.goal.amount <= 100_000_000
      ? { name: input.goal.name.trim().slice(0, 32), amount: input.goal.amount } : { ...DEFAULT_STATE.goal },
    privacy: input.privacy === true,
    calendar: normalizeCalendarCache(input.calendar),
  };
}

function desktopStore() {
  const bridge = window.niuma;
  if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.setState !== 'function'
    || typeof bridge.onStateChanged !== 'function') throw new Error('NIUMA_BRIDGE_MISSING');
  return bridge;
}

// A missing/legacy IPC reply must never be normalized into "saved" demo data.
// The main process can legitimately refresh the calendar while a write is in flight.
function confirmSave(value: unknown, expected: AppState): AppState {
  if (!value || typeof value !== 'object') throw new Error('NIUMA_WRITE_UNCONFIRMED');
  const actual = value as Partial<AppState>;
  const settings = actual.settings;
  if (actual.version !== 2 || actual.configured !== expected.configured || actual.privacy !== expected.privacy
    || !actual.goal || actual.goal.name !== expected.goal.name || actual.goal.amount !== expected.goal.amount
    || !settings || Object.keys(validateSettings(settings)).length) throw new Error('NIUMA_WRITE_UNCONFIRMED');
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SalarySettings)[]) {
    if (key === 'dayOverrides') {
      const entries = Object.entries(expected.settings.dayOverrides);
      if (Object.keys(settings.dayOverrides).length !== entries.length ||
        entries.some(([date, mode]) => settings.dayOverrides[date] !== mode)) throw new Error('NIUMA_WRITE_UNCONFIRMED');
    } else if (settings[key] !== expected.settings[key]) throw new Error('NIUMA_WRITE_UNCONFIRMED');
  }
  return normalizeState(actual);
}

export async function readState() {
  if (isDesktopHost()) {
    const value = await desktopStore().getState();
    if (value === undefined) throw new Error('NIUMA_READ_UNCONFIRMED');
    return normalizeState(value); // null is a genuine first run with no profile yet.
  }
  const text = localStorage.getItem(KEY) ?? localStorage.getItem('niuma.payday.v1');
  if (!text) return structuredClone(DEFAULT_STATE);
  try { return normalizeState(JSON.parse(text)); } catch { return structuredClone(DEFAULT_STATE); }
}

export async function writeState(state: AppState): Promise<AppState> {
  if (isDesktopHost()) return confirmSave(await desktopStore().setState(state), state);
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export async function writePrivacy(hidden: boolean) {
  if (window.niuma?.setPrivacy) {
    const saved = await window.niuma.setPrivacy(hidden);
    if (saved !== hidden) throw new Error('NIUMA_WRITE_UNCONFIRMED');
    return;
  }
  const latest = await readState();
  await writeState({ ...latest, privacy: hidden });
}

export function subscribeState(callback: (state: AppState) => void) {
  if (isDesktopHost()) {
    // readState surfaces missing bridges. Never install a browser-storage fallback in Electron.
    if (typeof window.niuma?.onStateChanged !== 'function') return () => {};
    return window.niuma.onStateChanged(value => callback(normalizeState(value)));
  }
  const listener = (event: StorageEvent) => {
    if (event.key === KEY) { try { callback(normalizeState(event.newValue ? JSON.parse(event.newValue) : null)); } catch { /* Ignore malformed external writes. */ } }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
