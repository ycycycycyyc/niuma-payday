import { ArrowDownToLine, ArrowUpToLine, ArrowUpRight, Bone, Clock3, GripHorizontal, Minus, Settings } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import layout from '../../shared/widget-layout.json';
import lensMap from '../assets/widget-lens-displacement.png?inline';
import { DEFAULT_SETTINGS, calculateSalary } from '../lib/salary';
import { duration, useClock } from '../lib/clock';
import type { AppState, DesktopPetState, WidgetLayer } from '../lib/store';
import LiveAmount from './LiveAmount';
import WidgetPet from './WidgetPet';
import WidgetSettings from './WidgetSettings';
import { useWidgetAppearance } from '../lib/widget-appearance';
import './widget.css';

// The transparent pet lane is part of the same frameless native window.
export const widgetLayoutStyle = {
  '--widget-width': `${layout.width}px`,
  '--card-height': `${layout.cardHeight}px`,
  '--lane-height': `${layout.laneHeight}px`,
} as CSSProperties;

// SVG URL backdrop filters are reliable in Chromium, including Electron on both OSes.
// Other engines use the same clear surface with a light, conventional backdrop filter.
const hasLensFilter = typeof window !== 'undefined' && (Boolean(window.niuma) || 'chrome' in window || /\bElectron\//.test(navigator.userAgent)) &&
  CSS.supports('backdrop-filter', 'url("#glass")');

function useBoneMode(api: Window['niuma']) {
  const native = Boolean(api?.setDesktopPetMode && (api.platform === 'darwin' || api.platform === 'win32'));
  const [chasing, setChasing] = useState(false);
  const [state, setState] = useState<DesktopPetState>({ phase: 'docked' });
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const lastPhase = useRef<DesktopPetState['phase']>('docked');
  const apply = useCallback((value: DesktopPetState) => {
    lastPhase.current = value.phase;
    setState(value);
    setChasing(value.phase === 'chasing');
    setError(false);
  }, []);

  useEffect(() => {
    if (!native || !api) return;
    const current = revision.current;
    const off = api.onDesktopPetState?.(value => {
      revision.current++;
      apply(value);
    });
    void api.getDesktopPetState?.().then(value => {
      if (current === revision.current) apply(value);
    }).catch(() => {
      if (current === revision.current) setError(true);
    });
    return () => { revision.current++; off?.(); };
  }, [native, api, apply]);

  const change = useCallback((active: boolean) => {
    setChasing(active);
    if (!native || !api?.setDesktopPetMode) return;
    const current = ++revision.current;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    void api.setDesktopPetMode({ active, reducedMotion }).then(value => {
      if (current === revision.current) apply(value);
    }).catch(() => {
      if (current === revision.current) {
        setChasing(lastPhase.current === 'chasing');
        setError(true);
      }
    });
  }, [native, api, apply]);

  useEffect(() => {
    if (!native || state.phase === 'docked') return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => change(state.phase === 'chasing');
    preference.addEventListener('change', updateMotion);
    return () => preference.removeEventListener('change', updateMotion);
  }, [native, state.phase, change]);

  useEffect(() => {
    if (!chasing) return;
    const putAway = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); change(false); }
    };
    document.addEventListener('keydown', putAway);
    return () => document.removeEventListener('keydown', putAway);
  }, [chasing, change]);
  return { native, chasing, state, change, error };
}

function LensFilter({ id }: { id: string }) {
  return <svg className="widget-lens-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs><filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      {/* Red/green encode the inward normal of an 18px rounded bevel. The center is neutral. */}
      <feImage href={lensMap} preserveAspectRatio="none" result="bevel" />
      <feDisplacementMap in="SourceGraphic" in2="bevel" scale="44" xChannelSelector="R" yChannelSelector="G" />
    </filter></defs>
  </svg>;
}

export default function Widget({ state, onRestore, onHide, preview = false, backdrop }: { state: AppState; onRestore: () => void; onHide: () => void | Promise<void>; preview?: boolean; backdrop?: ReactNode }) {
  const boneButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const desktop = preview ? undefined : window.niuma;
  const bone = useBoneMode(desktop);
  const { appearance, update, status: appearanceStatus, retry } = useWidgetAppearance(preview);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [space, setSpace] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [layer, setLayer] = useState<WidgetLayer | null>(null);
  const [changingLayer, setChangingLayer] = useState(false);
  const [layerError, setLayerError] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  const [minimizeError, setMinimizeError] = useState(false);
  const layerRevision = useRef(0);

  useLayoutEffect(() => {
    if (desktop) return;
    const area = shell.current?.closest('.preview-field');
    const fit = () => setSpace({ width: area?.clientWidth ?? window.innerWidth, height: area?.clientHeight ?? window.innerHeight });
    fit();
    const observer = new ResizeObserver(fit);
    if (area) observer.observe(area);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [desktop]);

  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  };

  useEffect(() => {
    if (!desktop?.getWidgetLayer) return;
    const revision = layerRevision.current;
    const unsubscribe = desktop.onWidgetLayerChanged?.(value => {
      layerRevision.current++;
      setLayer(value);
      setLayerError(false);
    });
    void desktop.getWidgetLayer().then(value => {
      if (revision === layerRevision.current) setLayer(value);
    }).catch(() => {
      if (revision === layerRevision.current) setLayerError(true);
    });
    return () => { layerRevision.current++; unsubscribe?.(); };
  }, [desktop]);

  async function minimize() {
    if (minimizing) return;
    setMinimizing(true);
    setMinimizeError(false);
    try { await onHide(); } catch { setMinimizeError(true); }
    finally { setMinimizing(false); }
  }

  async function changeLayer() {
    if (!desktop?.setWidgetLayer || !desktop.getWidgetLayer || changingLayer) return;
    const revision = layerRevision.current;
    setChangingLayer(true);
    setLayerError(false);
    try {
      const value = layer === null
        ? await desktop.getWidgetLayer()
        : await desktop.setWidgetLayer(layer === 'top' ? 'bottom' : 'top');
      // A later menu choice takes precedence over the reply to an earlier click.
      if (revision === layerRevision.current) setLayer(value);
    } catch {
      if (revision === layerRevision.current) setLayerError(true);
    } finally {
      setChangingLayer(false);
    }
  }
  const lowerLabel = desktop?.platform === 'darwin' || desktop?.platform === 'win32' ? '将浮窗置底' : '取消置顶';
  const layerLabel = layer === null ? '读取浮窗层级' : layer === 'top' ? lowerLabel : '将浮窗置顶';
  const demo = !state.configured;
  const settings = demo ? DEFAULT_SETTINGS : state.settings;
  const now = useClock(demo);
  const calendar = demo ? {} : state.calendar;
  const result = calculateSalary(settings, now, calendar);
  const onShift = result.status === 'working' || result.status === 'break';
  const timeLabel = onShift ? '距离下班' : '工作时段';
  const timeValue = onShift ? duration(result.remainingSeconds) : `${settings.startTime}–${settings.endTime}`;
  const lensId = `widget-lens-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const lensStyle = {
    '--widget-lens-filter': `url("#${lensId}") saturate(1.06)`,
    '--glass-pink': appearance.tint,
    '--glass-opacity': `${appearance.opacity * 100}%`,
  } as CSSProperties;
  const scale = desktop ? 1 : Math.min(appearance.scale, space.width / layout.width, space.height / (layout.cardHeight + layout.laneHeight));
  const channels = [1, 3, 5].map(start => parseInt(appearance.tint.slice(start, start + 2), 16) / 255);
  const lightness = channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const ink = appearance.opacity >= .55 ? (lightness < .55 ? 'light' : 'dark') : undefined;

  return <div className="widget-shell" ref={shell} style={{ width: desktop ? `min(${layout.width}px, 100vw)` : layout.width * scale, height: desktop ? `min(${layout.cardHeight + layout.laneHeight}px, 100dvh)` : (layout.cardHeight + layout.laneHeight) * scale }}>
    <div className="widget-stack" style={{ ...widgetLayoutStyle, zoom: scale }}>
    <WidgetPet chasing={!bone.native && bone.chasing} setChasing={bone.change}
      desktopState={bone.state} boneButton={boneButton} preview={preview} />
    {backdrop}
    {hasLensFilter && <LensFilter id={lensId} />}
    <section className={`widget ${preview ? 'widget-preview' : ''} ${settingsOpen ? 'widget-editing' : ''}`} data-refraction={hasLensFilter ? 'svg' : 'fallback'} data-glass-ink={ink} style={lensStyle} aria-label="工资悬浮窗">
      {settingsOpen ? <WidgetSettings value={appearance} onChange={update} onClose={closeSettings} status={appearanceStatus} onRetry={retry} /> : <>
      <div className="widget-head">
        <div className="widget-head-move">
          {bone.error || layerError || minimizeError ? <span className="widget-status" role="status">{minimizeError ? '最小化失败，请重试' : bone.error ? '骨头操作失败，可重试' : '层级操作失败，可重试'}</span> :
            <span className="widget-status"><i className={result.status === 'working' ? 'active' : ''} />{demo ? '演示数据' : result.statusLabel}</span>}
          <GripHorizontal size={18} className="widget-grip" aria-hidden="true" />
        </div>
        <div className="widget-actions">
          <button ref={settingsButton} type="button" aria-label="浮窗设置" title="浮窗设置" onClick={() => setSettingsOpen(true)}><Settings size={17} aria-hidden="true" /></button>
          <button ref={boneButton} type="button" className="widget-bone-toggle" aria-pressed={bone.chasing}
            aria-label={bone.chasing ? '收起骨头' : '拿起骨头'} title={bone.chasing ? '收起骨头（Esc）' : '拿起骨头，让她追着玩'}
            onClick={() => bone.change(!bone.chasing)}><Bone size={17} aria-hidden="true" /></button>
          {desktop?.setWidgetLayer && desktop.getWidgetLayer && <button type="button"
            disabled={changingLayer || (layer === null && !layerError)} aria-label={layerLabel} title={layerLabel}
            onClick={() => void changeLayer()}>
            {layer === 'bottom' ? <ArrowUpToLine size={17} aria-hidden="true" /> : <ArrowDownToLine size={17} aria-hidden="true" />}
          </button>}
          <button onClick={onRestore} aria-label="返回主窗口" title="返回主窗口"><ArrowUpRight size={18} /></button>
          <button onClick={() => void minimize()} disabled={minimizing} aria-label="最小化浮窗" title="最小化浮窗，双击狗狗恢复"><Minus size={17} /></button>
        </div>
      </div>
      <div className="widget-middle">
        <div className="widget-earnings"><span className="widget-earnings-label">今日已赚</span><LiveAmount settings={settings} demo={demo} privacy={state.privacy} calendar={calendar} compact /></div>
      </div>
      <div className="widget-foot"><span className="widget-time-label"><Clock3 size={19} aria-hidden="true" />{timeLabel}</span><span className={`widget-time-value ${onShift ? '' : 'schedule'}`}>{timeValue}</span></div>
      <div className="widget-progress"><i style={{ width: `${result.progress * 100}%` }} /></div>
      </>}
    </section>
    </div>
  </div>;
}
