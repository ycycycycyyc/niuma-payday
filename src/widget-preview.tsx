import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor, Moon, Sun } from 'lucide-react';
import './styles.css';
import Widget, { widgetLayoutStyle } from './components/Widget';
import { DEFAULT_STATE } from './lib/store';
import { currencySymbol } from './lib/clock';
import './widget-preview.css';

// The widget's own demo clock starts on a weekday at 14:36. Nothing reads or writes a profile.
const demo = DEFAULT_STATE;
type Position = { x: number; y: number };
type Surface = 'widget' | 'summary' | 'hidden';

function Wallpaper() {
  // A few still ribbons give the translucent widget details to pass over when dragged.
  return <svg className="preview-wallpaper" viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="dune" x1="0" y1="0" x2=".65" y2="1" gradientUnits="objectBoundingBox">
        <stop className="dune-edge" /><stop offset=".28" className="dune-mid" /><stop offset="1" className="dune-base" />
      </linearGradient>
      <linearGradient id="near" x1="0" y1="0" x2="1" y2=".75" gradientUnits="objectBoundingBox">
        <stop className="near-edge" /><stop offset=".52" className="near-mid" /><stop offset="1" className="near-base" />
      </linearGradient>
    </defs>
    <path d="M-100 980 C310 950 430 675 722 616 C1100 538 1180 214 1700 183 L1700 1120 H-100Z" fill="url(#dune)" />
    <path d="M-100 980 C310 950 430 675 722 616 C1100 538 1180 214 1700 183" className="dune-line" />
    <path d="M-140 1080 C255 664 505 825 865 760 C1202 698 1298 398 1660 395 L1690 1100Z" fill="url(#near)" />
  </svg>;
}

function Preview() {
  const [theme, setTheme] = useState<'day' | 'night'>('day');
  const [surface, setSurface] = useState<Surface>('widget');
  const [position, setPosition] = useState<Position | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
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
  const show = () => { setSurface('widget'); setPosition(null); };

  return <div className="preview-scene" data-theme={theme}>
    <Wallpaper />
    <header className="preview-top">
      <h1><span>牛马鼓励器</span><i aria-hidden="true" />浮窗预览</h1>
      <div className="preview-themes" role="group" aria-label="选择桌布">
        <button type="button" onClick={() => setTheme('day')} aria-pressed={theme === 'day'}><Sun size={15} aria-hidden="true" />日光</button>
        <button type="button" onClick={() => setTheme('night')} aria-pressed={theme === 'night'}><Moon size={15} aria-hidden="true" />夜色</button>
      </div>
    </header>
    <div className="preview-field" ref={field}>
      {surface === 'widget' && <div className="preview-frame" ref={frame} style={{ ...widgetLayoutStyle, ...(position && { left: position.x, top: position.y, transform: 'none' }) }}
        onPointerDown={startDrag} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <Widget state={demo} preview onRestore={() => setSurface('summary')} onHide={() => setSurface('hidden')} />
      </div>}
      {surface === 'summary' && <section className="preview-summary" aria-label="演示班次">
        <h2>演示班次</h2>
        <dl><div><dt>日薪</dt><dd>{currencySymbol(demo.settings.currency)}{demo.settings.dailySalary}</dd></div>
          <div><dt>工作时间</dt><dd>{demo.settings.startTime} – {demo.settings.endTime}</dd></div></dl>
        <button type="button" className="preview-reopen" onClick={show}><Monitor size={16} />开启浮窗</button>
      </section>}
      {surface === 'hidden' && <button type="button" className="preview-reopen" onClick={show}><Monitor size={16} />开启浮窗</button>}
    </div>
    <footer className="preview-bottom"><span>{surface === 'widget' ? '拖动浮窗，看看不同位置的光影。' : '浏览器演示'}</span>
      {position && surface === 'widget' && <button onClick={() => setPosition(null)}>回到中央</button>}
    </footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
