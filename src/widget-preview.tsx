import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor, Moon, Sun } from 'lucide-react';
import './styles.css';
import Widget, { widgetLayoutStyle } from './components/Widget';
import { DEFAULT_STATE, normalizeState } from './lib/store';
import { renderPreviewDashboard } from './preview-dashboard';
import lensMap from './assets/widget-lens-displacement.png?inline';
import './widget-preview.css';

type Position = { x: number; y: number };
type Surface = 'widget' | 'dashboard' | 'hidden';

// Reuse the export's inline bundle in an opaque frame, without a second network request.
function dashboardDocument() {
  const script = document.querySelector<HTMLScriptElement>('#preview-bundle');
  const css = document.querySelector<HTMLStyleElement>('#preview-styles');
  if (!script || !css) return undefined;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>主界面演示</title>${css.outerHTML}</head><body data-preview-dashboard><div id="root"></div>${script.outerHTML}</body></html>`;
}

const crest = 'M-100 747 C125 741 307 670 490 613 C623 571 713 559 813 519 C1006 444 1093 347 1252 289 C1414 228 1541 225 1700 201';
const foreground = 'M-100 808 C144 732 312 740 485 785 C688 838 799 844 966 817 C1208 779 1359 632 1700 612';
const ground = ' V1080 H-100 Z';

const Wallpaper = memo(function Wallpaper() {
  // The dune crest and its wind-carved grooves cross the default widget position.
  // Keep the same composition in both light conditions so the glass can be compared.
  return <svg className="preview-wallpaper" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x2="0" y2="1">
        <stop stopColor="var(--sky-high)" /><stop offset=".68" stopColor="var(--sky-low)" /><stop offset="1" stopColor="var(--sky-glow)" />
      </linearGradient>
      <radialGradient id="sun-halo">
        <stop stopColor="var(--solar)" stopOpacity=".86" /><stop offset=".18" stopColor="var(--solar)" stopOpacity=".55" />
        <stop offset=".58" stopColor="var(--solar)" stopOpacity=".17" /><stop offset="1" stopColor="var(--solar)" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="valley" x1=".05" y1="0" x2=".83" y2="1">
        <stop stopColor="var(--sand-light)" /><stop offset=".48" stopColor="var(--sand-mid)" /><stop offset="1" stopColor="var(--sand-dark)" />
      </linearGradient>
      <linearGradient id="slipface" x1="0" y1=".27" x2=".83" y2=".94">
        <stop stopColor="var(--shade-far)" /><stop offset=".36" stopColor="var(--shade-core)" />
        <stop offset=".72" stopColor="var(--shade-bounce)" /><stop offset="1" stopColor="var(--shade-deep)" />
      </linearGradient>
      <linearGradient id="drift" x1=".12" y1="0" x2=".82" y2="1">
        <stop stopColor="var(--drift-light)" /><stop offset=".46" stopColor="var(--drift-mid)" /><stop offset="1" stopColor="var(--drift-deep)" />
      </linearGradient>
      <linearGradient id="rim" x1="0" y1=".8" x2="1" y2="0">
        <stop stopColor="var(--rim)" stopOpacity=".2" /><stop offset=".35" stopColor="var(--rim)" stopOpacity=".94" />
        <stop offset=".72" stopColor="var(--rim)" /><stop offset="1" stopColor="var(--rim)" stopOpacity=".35" />
      </linearGradient>
      <clipPath id="shadow-slope"><path d={crest + ground} /></clipPath>
      <clipPath id="foreground-slope"><path d={foreground + ground} /></clipPath>
      <filter id="sand-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".83" numOctaves="3" seed="23" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <pattern id="grain-tile" width="192" height="192" patternUnits="userSpaceOnUse">
        <rect width="192" height="192" filter="url(#sand-grain)" />
      </pattern>
    </defs>
    <g id="preview-landscape">
    <rect width="1600" height="1000" fill="url(#sky)" />
    <ellipse cx="1192" cy="179" rx="453" ry="275" fill="url(#sun-halo)" />
    <circle cx="1192" cy="179" r="23" fill="var(--solar)" opacity=".88" />
    <path d="M-50 372 C63 343 89 355 162 333 S265 311 315 323 C394 342 435 289 493 297 S561 307 611 297 C683 283 729 316 801 307 C885 297 918 269 980 277 S1078 287 1145 271 C1226 250 1280 269 1335 259 S1481 240 1655 245 V1000 H-50Z" fill="var(--distance)" />
    <path d="M-50 460 C102 439 191 372 307 371 C423 368 488 399 577 386 C691 370 768 342 845 344 C963 350 1007 303 1128 309 S1394 286 1650 251 V1000 H-50Z" fill="var(--foothill)" />
    <path d="M-50 520 C120 460 223 433 389 442 C579 453 710 398 874 372 C1033 348 1188 346 1347 298 C1463 263 1533 257 1650 255 V1040 H-50Z" fill="url(#valley)" />
    <g className="sunlit-ripples" fill="none" stroke="var(--ripple-light)">
      {Array.from({ length: 16 }, (_, i) => {
        const y = 407 + i * 9 + i * i * .38;
        return <path key={i} d={`M-40 ${y+132} C220 ${y+35} 440 ${y+89} 670 ${y+23} S1000 ${y-67} 1268 ${y-115} S1530 ${y-192} 1660 ${y-179}`} opacity={.1 + (i % 3) * .065} strokeWidth={1 + i * .085} />;
      })}
    </g>
    <path d={crest + ground} fill="url(#slipface)" />
    <g clipPath="url(#shadow-slope)" fill="none" strokeLinecap="round">
      {Array.from({ length: 20 }, (_, i) => {
        const x = 170 + i * 72;
        return <path key={i} d={`M${x} 236 C${x-145} 438 ${x+22} 556 ${x-70} 710 S${x-164} 904 ${x-97} 1050`}
          stroke="var(--avalanche)" strokeWidth={6 + (i % 5) * 3} opacity={.017 + (i % 4) * .008} />;
      })}
      {[9, 20, 39, 65].map((offset, i) => <path key={offset} d={crest} transform={`translate(0 ${offset})`}
        stroke={i < 2 ? 'var(--crease)' : 'var(--avalanche)'} strokeWidth={i === 1 ? 2.4 : 1.65} opacity={[.49, .31, .31, .22][i]} />)}
    </g>
    <path d={crest} fill="none" stroke="url(#rim)" strokeWidth="4.2" />
    <path d={foreground + ground} fill="url(#drift)" />
    <g clipPath="url(#foreground-slope)" fill="none" stroke="var(--ripple-light)">
      {Array.from({ length: 23 }, (_, i) => {
        const y = 586 + 11 * i + .52 * i * i;
        return <path key={i} d={`M-60 ${y+184} C98 ${y+96} 227 ${y+103} 372 ${y+135} S665 ${y+223} 873 ${y+208} C1121 ${y+187} 1311 ${y+68} 1660 ${y-6}`}
          strokeWidth={1.2 + (i % 4) * .45} opacity={.08 + (i % 3) * .065} />;
      })}
    </g>
    <path d={foreground} fill="none" stroke="var(--rim)" strokeWidth="2" opacity=".53" />
    <rect className="preview-paper-grain" width="1600" height="1000" fill="url(#grain-tile)" />
    </g>
  </svg>;
});

// WebKit and Firefox support ordinary SVG filters on artwork. Reuse the actual
// wallpaper behind this card with the same bevel map as the Chromium widget.
function WallpaperLens({ position }: { position: Position | null }) {
  const lens = useRef<SVGSVGElement>(null);
  const sample = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const aperture = lens.current;
    const texture = sample.current;
    const scene = aperture?.closest('.preview-scene');
    const wall = scene?.querySelector('.preview-wallpaper');
    if (!aperture || !texture || !wall || !scene?.querySelector('.widget[data-refraction="fallback"]')) return;
    const align = () => {
      const bounds = wall.getBoundingClientRect();
      const card = aperture.getBoundingClientRect();
      texture.setAttribute('x', String(bounds.left - card.left));
      texture.setAttribute('y', String(bounds.top - card.top));
      texture.setAttribute('width', String(bounds.width));
      texture.setAttribute('height', String(bounds.height));
    };
    align();
    window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, [position]);
  return <svg ref={lens} className="preview-wallpaper-lens" aria-hidden="true" focusable="false">
    <defs><filter id="preview-wallpaper-bevel" filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage href={lensMap} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="bevel" />
      <feDisplacementMap in="SourceGraphic" in2="bevel" scale="44" xChannelSelector="R" yChannelSelector="G" />
    </filter></defs>
    <g filter="url(#preview-wallpaper-bevel)"><svg ref={sample} width="0" height="0" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <use href="#preview-landscape" />
    </svg></g>
  </svg>;
}

function Preview() {
  const [theme, setTheme] = useState<'day' | 'night'>('day');
  const [surface, setSurface] = useState<Surface>('widget');
  const [profile, setProfile] = useState(DEFAULT_STATE);
  const [dashboard, setDashboard] = useState<{ html?: string } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dashboardFrame = useRef<HTMLIFrameElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const clamp = useCallback((point: Position) => {
    const area = field.current;
    const box = frame.current;
    if (!area || !box) return point;
    return {
      x: Math.min(Math.max(0, point.x), Math.max(0, area.clientWidth - box.offsetWidth)),
      y: Math.min(Math.max(0, point.y), Math.max(0, area.clientHeight - box.offsetHeight)),
    };
  }, []);
  useEffect(() => {
    const resize = () => setPosition(previous => previous && clamp(previous));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [clamp]);
  useLayoutEffect(() => {
    if (surface === 'widget') setPosition(previous => previous && clamp(previous));
  }, [clamp, surface]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!dashboardFrame.current || event.source !== dashboardFrame.current.contentWindow || event.data?.channel !== 'niuma-preview') return;
      if (event.data.action === 'widget') setSurface('widget');
      if (event.data.action === 'state') setProfile(normalizeState(event.data.state));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element) || event.target.closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId || !field.current) return;
    const rect = field.current.getBoundingClientRect();
    setPosition(clamp({ x: event.clientX - rect.left - active.dx, y: event.clientY - rect.top - active.dy }));
  };
  const show = () => setSurface('widget');
  const openDashboard = () => {
    if (!dashboard) setDashboard({ html: dashboardDocument() });
    setSurface('dashboard');
  };

  return <div className="preview-scene" data-view={surface} data-theme={theme} data-glass-scene={theme === 'night' ? 'dark' : 'light'}>
    <Wallpaper />
    <header className="preview-top">
      <h1>牛马鼓励器</h1>
      <div className="preview-themes preview-views" role="group" aria-label="预览视图">
        <button type="button" onClick={show} aria-pressed={surface !== 'dashboard'}>浮窗</button>
        <button type="button" onClick={openDashboard} aria-pressed={surface === 'dashboard'}>主界面</button>
      </div>
      <div className="preview-themes" role="group" aria-label="选择桌布">
        <button type="button" onClick={() => setTheme('day')} aria-label="日光" aria-pressed={theme === 'day'}><Sun size={15} aria-hidden="true" /><span>日光</span></button>
        <button type="button" onClick={() => setTheme('night')} aria-label="夜色" aria-pressed={theme === 'night'}><Moon size={15} aria-hidden="true" /><span>夜色</span></button>
      </div>
    </header>
    <div className="preview-field" ref={field}>
      {surface === 'widget' && <div className="preview-frame" ref={frame} style={{ ...widgetLayoutStyle, ...(position && { left: position.x, top: position.y, transform: 'none' }) }}
        onPointerDown={startDrag} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <WallpaperLens position={position} />
        <Widget state={profile} preview onRestore={openDashboard} onHide={() => setSurface('hidden')} />
      </div>}
      {dashboard && <iframe ref={dashboardFrame} title="主界面演示" className="preview-dashboard"
        hidden={surface !== 'dashboard'} srcDoc={dashboard.html}
        src={dashboard.html ? undefined : '#preview-dashboard'} sandbox={dashboard.html ? 'allow-scripts allow-forms' : undefined} />}
      {surface === 'hidden' && <button type="button" className="preview-reopen" onClick={show}><Monitor size={16} />开启浮窗</button>}
    </div>
    <footer className="preview-bottom"><span>{surface === 'dashboard' ? '设置仅在本次预览中生效。' : surface === 'widget' ? '拖动浮窗，看看不同位置的光影。' : '浮窗已隐藏'}</span>
      {position && surface === 'widget' && <button onClick={() => setPosition(null)}>回到中央</button>}
    </footer>
  </div>;
}

const root = document.getElementById('root')!;
if (document.body.hasAttribute('data-preview-dashboard') ||
    (import.meta.env.DEV && window.parent !== window && location.hash === '#preview-dashboard')) {
  renderPreviewDashboard(root);
} else {
  createRoot(root).render(<Preview />);
}
