import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { colorAtPoint, hexToHsv, hsvToHex, type HsvColor } from '../lib/color-wheel';

export default function ColorWheelPicker({ value, onChange, disabled }: {
  value: string;
  onChange: (color: string) => void;
  disabled: boolean;
}) {
  const [color, setColor] = useState(() => hexToHsv(value));
  const current = useRef(color);
  const emitted = useRef(value);
  const wheel = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { wheel.current?.focus(); }, []);
  useEffect(() => {
    if (value === emitted.current) return;
    const next = hexToHsv(value);
    // White and black have no defined hue; keep the last useful direction.
    if (next.s === 0) next.h = current.current.h;
    if (next.v === 0) next.s = current.current.s;
    current.current = next;
    setColor(next);
    setHex(value);
    setInvalid(false);
  }, [value]);

  const change = (next: HsvColor) => {
    current.current = next;
    const color = hsvToHex(next);
    emitted.current = color;
    setColor(next);
    setHex(color);
    setInvalid(false);
    onChange(color);
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = colorAtPoint(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, rect.width / 2, current.current.h);
    change({ ...current.current, ...point, v: current.current.v || 1 });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = { ...current.current };
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowRight') next.h = (next.h + step) % 360;
    else if (event.key === 'ArrowLeft') next.h = (next.h - step + 360) % 360;
    else if (event.key === 'ArrowUp') next.s = Math.min(1, next.s + step / 100);
    else if (event.key === 'ArrowDown') next.s = Math.max(0, next.s - step / 100);
    else if (event.key === 'Home') next.s = 0;
    else if (event.key === 'End') next.s = 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    next.v ||= 1;
    change(next);
  };
  const commitHex = () => {
    const clean = hex.trim().replace(/^#?/, '#');
    if (!/^#[\da-f]{6}$/i.test(clean)) { setInvalid(true); return; }
    const next = hexToHsv(clean);
    if (next.s === 0) next.h = current.current.h;
    if (next.v === 0) next.s = current.current.s;
    change(next);
  };
  const angle = (color.h - 90) * Math.PI / 180;
  const marker = {
    left: `${50 + Math.cos(angle) * color.s * 50}%`,
    top: `${50 + Math.sin(angle) * color.s * 50}%`,
    background: value,
  } as CSSProperties;
  return <div className="widget-color-picker">
    <div ref={wheel} className="widget-color-wheel" role="slider" aria-label="全色色轮" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(color.h)}
      aria-valuetext={`色相 ${Math.round(color.h)} 度，饱和度 ${Math.round(color.s * 100)}%`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onKeyDown={keyboard} onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event);
      }} onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
      <span className="widget-color-marker" style={marker} />
    </div>
    <div className="widget-color-details">
      <label className="widget-hex-field"><span className="widget-color-sample" style={{ background: value }} aria-hidden="true" />
        <input type="text" aria-label="浮窗底色" aria-invalid={invalid || undefined} value={hex} spellCheck={false} autoComplete="off" maxLength={7} disabled={disabled}
          onChange={event => { setHex(event.target.value); setInvalid(false); }} onBlur={commitHex}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }} />
      </label>
      {invalid ? <span className="widget-hex-error" role="alert">请输入 6 位颜色值</span> : <span className="widget-color-hint">圆心柔和 · 外圈鲜明</span>}
      <label className="widget-color-brightness"><span>明暗<output>{Math.round(color.v * 100)}%</output></span>
        <input type="range" aria-label="颜色明暗" min="0" max="100" step="1" value={Math.round(color.v * 100)} disabled={disabled}
          style={{ '--wheel-bright': hsvToHex({ ...color, v: 1 }) } as CSSProperties}
          onChange={event => change({ ...current.current, v: Number(event.target.value) / 100 })} />
      </label>
    </div>
  </div>;
}
