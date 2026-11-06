import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_WIDGET_APPEARANCE, normalizeWidgetAppearance, type WidgetAppearance } from '../../shared/widget-appearance.mjs';

export type { WidgetAppearance };
type AppearanceBridge = {
  getWidgetAppearance?(): Promise<WidgetAppearance>;
  setWidgetAppearance?(value: WidgetAppearance): Promise<WidgetAppearance>;
  onWidgetAppearanceChanged?(callback: (value: WidgetAppearance) => void): () => void;
};
const KEY = 'niuma.widget-appearance.v1';
const CHANGE = 'niuma-widget-appearance-changed';

export function useWidgetAppearance(preview: boolean) {
  const bridge = (preview ? undefined : window.niuma) as (Window['niuma'] & AppearanceBridge) | undefined;
  const [appearance, setAppearance] = useState<WidgetAppearance>({ ...DEFAULT_WIDGET_APPEARANCE });
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'failed' | 'unavailable'>('loading');
  const saved = useRef(appearance);
  const draft = useRef(appearance);
  const failed = useRef<WidgetAppearance | null>(null);
  const revision = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const apply = (value: unknown) => {
      if (cancelled || pending.current) return;
      saved.current = normalizeWidgetAppearance(value);
      draft.current = saved.current;
      setAppearance(saved.current);
      setStatus('saved');
    };
    const local = (event: Event) => apply((event as CustomEvent).detail);
    const storage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      try { apply(event.newValue ? JSON.parse(event.newValue) : null); } catch { /* Ignore damaged external writes. */ }
    };
    let off: (() => void) | undefined;
    if (bridge) {
      if (!bridge.getWidgetAppearance || !bridge.setWidgetAppearance) setStatus('unavailable');
      else {
        let changed = false;
        off = bridge.onWidgetAppearanceChanged?.(value => { changed = true; apply(value); });
        void bridge.getWidgetAppearance().then(value => { if (!changed) apply(value); }).catch(() => {
          if (!cancelled) setStatus('unavailable');
        });
      }
    } else {
      try { apply(JSON.parse(localStorage.getItem(KEY) ?? 'null')); }
      catch { apply(null); }
      window.addEventListener(CHANGE, local);
      window.addEventListener('storage', storage);
    }
    return () => {
      cancelled = true;
      alive.current = false;
      off?.();
      window.removeEventListener(CHANGE, local);
      window.removeEventListener('storage', storage);
    };
  }, [bridge]);

  const update = useCallback((value: Partial<WidgetAppearance>) => {
    const next = normalizeWidgetAppearance({ ...draft.current, ...value });
    draft.current = next;
    const current = ++revision.current;
    pending.current = true;
    failed.current = null;
    setAppearance(next);
    setStatus('saving');
    // Serialize native writes and skip superseded slider samples before they start.
    queue.current = queue.current.then(async () => {
      if (current !== revision.current) return;
      try {
        let actual: WidgetAppearance;
        if (bridge) {
          if (!bridge.setWidgetAppearance) throw new Error('Appearance bridge unavailable');
          actual = await bridge.setWidgetAppearance(next);
          if (actual?.scale !== next.scale || actual?.tint !== next.tint || actual?.opacity !== next.opacity) {
            throw new Error('Appearance write unconfirmed');
          }
        } else {
          localStorage.setItem(KEY, JSON.stringify(next));
          actual = next;
          window.dispatchEvent(new CustomEvent(CHANGE, { detail: actual }));
        }
        saved.current = actual;
        if (current === revision.current) {
          pending.current = false;
          draft.current = actual;
          if (alive.current) { setAppearance(actual); setStatus('saved'); }
        }
      } catch {
        if (current === revision.current) {
          pending.current = false;
          failed.current = next;
          draft.current = saved.current;
          if (alive.current) { setAppearance(saved.current); setStatus('failed'); }
        }
      }
    });
  }, [bridge]);

  const retry = () => { if (failed.current) update(failed.current); };
  return { appearance, update, status, retry };
}
