import { DEFAULT_SETTINGS, validateSettings, type SalarySettings } from './salary';
import { normalizeCalendarCache, type CalendarCache } from '../../shared/calendar.mjs';
import { isDesktopHost } from './desktop-error';
import type { PetLaunchPose } from './pet-motion';
import { migrateLegacyProfile } from '../../shared/profile-migration.mjs';
import { normalizeSavingsLedger, recordSavingsEntry, sameSavingsEntry, type SavingsEntry, type SavingsLedger } from '../../shared/savings.mjs';

export type AppState = { version: 3; configured: boolean; settings: SalarySettings; goal: { name: string; amount: number }; privacy: boolean; calendar: CalendarCache; savings: SavingsLedger };
export type WidgetLayer = 'top' | 'bottom';
export type DesktopPetState = { phase: 'docked' | 'chasing' | 'returning' | 'companion'; dockX?: number; facing?: 1 | -1 };
export const DEFAULT_STATE: AppState = { version: 3, configured: false, settings: DEFAULT_SETTINGS, goal: { name: '今天的咖啡自由', amount: 25 }, privacy: false, calendar: {}, savings: {} };
const KEY = 'niuma.payday.v3';

declare global {
  interface Window {
    niuma?: {
      platform: string;
      getState(): Promise<unknown>;
      setState(state: unknown): Promise<unknown>;
      writeSavingsEntry?(entry: SavingsEntry, previous: SavingsEntry | null): Promise<unknown>;
      setPrivacy?(hidden: boolean): Promise<boolean>;
      onStateChanged(callback: (state: unknown) => void): () => void;
      refreshCalendar(): Promise<{ status: string; message: string; calendar: CalendarCache }>;
      showWidget(): Promise<void>; hideWidget(): Promise<void>; restoreMain(): Promise<void>;
      minimizeWidget?(options: { reducedMotion: boolean }): Promise<void>;
      getWidgetLayer?(): Promise<WidgetLayer>;
      setWidgetLayer?(layer: WidgetLayer): Promise<WidgetLayer>;
      onWidgetLayerChanged?(callback: (layer: WidgetLayer) => void): () => void;
      getDesktopPetState?(): Promise<DesktopPetState>;
      setDesktopPetMode?(mode: { active: boolean; reducedMotion: boolean }): Promise<DesktopPetState>;
      onDesktopPetState?(callback: (state: DesktopPetState) => void): () => void;
      setWidgetPet?(state: {
        left: number; top: number; width: number; height: number;
        chasing: boolean; facing?: 1 | -1; launchPose?: PetLaunchPose;
        menu?: { left: number; top: number; width: number; height: number } | null;
      }): void;
      onWidgetPointer?(callback: (point: { x: number; y: number }) => void): () => void;
      minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void>;
      onWindowState(callback: (state: { maximized: boolean }) => void): () => void;
    };
  }
}

export function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(DEFAULT_STATE);
  const input = migrateLegacyProfile(value) as Partial<AppState>;
  // A missing monthly rate must not silently activate the demo's default salary.
  const isMonthly = input.version === 3 && input.settings && Number.isFinite(input.settings.monthlySalary);
  const settings = isMonthly ? { ...structuredClone(DEFAULT_SETTINGS), ...input.settings } : structuredClone(DEFAULT_SETTINGS);
  let valid = false;
  try { valid = validStoredSettings(settings, input.configured === true); } catch { /* Restore damaged state safely. */ }
  return {
    version: 3, configured: Boolean(isMonthly && input.configured === true && valid),
    settings: valid ? settings : structuredClone(DEFAULT_SETTINGS),
    goal: input.goal && typeof input.goal.name === 'string' && input.goal.name.trim() && Number.isFinite(input.goal.amount) && input.goal.amount > 0 && input.goal.amount <= 100_000_000
      ? { name: input.goal.name.trim().slice(0, 32), amount: input.goal.amount } : { ...DEFAULT_STATE.goal },
    privacy: input.privacy === true,
    calendar: normalizeCalendarCache(input.calendar),
    savings: normalizeSavingsLedger(input.savings),
  };
}

function validStoredSettings(settings: SalarySettings, configured: boolean): boolean {
  // Zero denotes a migrated daily profile awaiting a monthly salary, never an active rate.
  const checked = !configured && settings.monthlySalary === 0
    ? { ...settings, monthlySalary: DEFAULT_SETTINGS.monthlySalary } : settings;
  return Object.keys(validateSettings(checked)).length === 0;
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
  if (actual.version !== 3 || actual.configured !== expected.configured || actual.privacy !== expected.privacy
    || !actual.goal || actual.goal.name !== expected.goal.name || actual.goal.amount !== expected.goal.amount
    || !settings || !validStoredSettings(settings, actual.configured === true)) throw new Error('NIUMA_WRITE_UNCONFIRMED');
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
  return readBrowserState();
}

function readBrowserState(): AppState {
  const text = localStorage.getItem(KEY) ?? localStorage.getItem('niuma.payday.v2') ?? localStorage.getItem('niuma.payday.v1');
  if (!text) return structuredClone(DEFAULT_STATE);
  try { return normalizeState(JSON.parse(text)); } catch { return structuredClone(DEFAULT_STATE); }
}

// Read and write under one origin-wide lock so a second tab cannot erase an entry.
function updateBrowserState(update: (latest: AppState) => AppState): Promise<AppState> {
  const store = () => {
    const latest = readBrowserState();
    const next = update(latest);
    if (next !== latest) localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  };
  const locks = window.navigator?.locks;
  return locks ? locks.request(KEY, store) : Promise.resolve(store());
}

export async function writeState(state: AppState): Promise<AppState> {
  if (isDesktopHost()) return confirmSave(await desktopStore().setState(state), state);
  return updateBrowserState(latest => ({ ...state, savings: latest.savings }));
}

export async function writeSavingsEntry(entry: SavingsEntry, previous: SavingsEntry | null): Promise<AppState> {
  if (isDesktopHost()) {
    const bridge = desktopStore();
    if (!bridge.writeSavingsEntry) throw new Error('NIUMA_BRIDGE_MISSING');
    const saved = normalizeState(await bridge.writeSavingsEntry(entry, previous));
    if (!saved.configured || !sameSavingsEntry(saved.savings[entry.month] ?? null, entry)) {
      throw new Error('NIUMA_WRITE_UNCONFIRMED');
    }
    return saved;
  }
  return updateBrowserState(latest => {
    const savings = recordSavingsEntry(latest, entry, previous);
    return savings === latest.savings ? latest : { ...latest, savings };
  });
}

export async function writePrivacy(hidden: boolean) {
  if (window.niuma?.setPrivacy) {
    const saved = await window.niuma.setPrivacy(hidden);
    if (saved !== hidden) throw new Error('NIUMA_WRITE_UNCONFIRMED');
    return;
  }
  if (!isDesktopHost()) {
    await updateBrowserState(latest => ({ ...latest, privacy: hidden }));
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
