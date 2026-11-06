import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DEFAULT_WIDGET_APPEARANCE } from '../../shared/widget-appearance.mjs';
import type { WidgetAppearance } from '../lib/widget-appearance';
import ColorWheelPicker from './ColorWheelPicker';

const swatches = [
  { tint: '#f9dfeb', name: '樱花粉' },
  { tint: '#e1d9f3', name: '浅薰衣草' },
  { tint: '#d7e8de', name: '鼠尾草绿' },
  { tint: '#ebdfcf', name: '奶油米' },
];

export default function WidgetSettings({ value, onChange, onClose, status, onRetry }: {
  value: WidgetAppearance;
  onChange: (value: Partial<WidgetAppearance>) => void;
  onClose: () => void;
  status: 'loading' | 'saved' | 'saving' | 'failed' | 'unavailable';
  onRetry: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const colorButton = useRef<HTMLButtonElement>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const closeColor = () => {
    setColorOpen(false);
    requestAnimationFrame(() => colorButton.current?.focus());
  };
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (colorOpen) closeColor(); else onClose(); }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [role="slider"][tabindex="0"]')];
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const disabled = status === 'loading' || status === 'unavailable';
  return <div className={`widget-settings ${colorOpen ? 'widget-settings-palette' : ''}`} ref={panel} role="dialog" aria-modal="true" aria-label="浮窗设置" onKeyDown={keyboard}>
    <div className="widget-settings-head"><strong>{colorOpen ? '选择底色' : '浮窗设置'}</strong><button type="button" onClick={colorOpen ? closeColor : onClose} aria-label={colorOpen ? '返回设置' : '返回浮窗'} title={colorOpen ? '返回设置' : '返回浮窗'}><ArrowLeft size={15} /><span>返回</span></button></div>
    {colorOpen ? <ColorWheelPicker value={value.tint} disabled={disabled} onChange={tint => onChange({ tint })} /> : <div className="widget-settings-fields">
      <label className="widget-setting-row"><span>大小</span><input type="range" aria-label="浮窗大小" min="85" max="150" step="5" value={Math.round(value.scale * 100)} disabled={disabled} onChange={event => onChange({ scale: Number(event.target.value) / 100 })} /><output>{Math.round(value.scale * 100)}%</output></label>
      <div className="widget-setting-row"><span>底色</span><div className="widget-swatches" role="group" aria-label="浮窗底色预设">{swatches.map(swatch => <button type="button" key={swatch.tint} aria-label={swatch.name} title={swatch.name} aria-pressed={value.tint === swatch.tint} style={{ background: swatch.tint }} disabled={disabled} onClick={() => onChange({ tint: swatch.tint })} />)}</div><button type="button" ref={colorButton} className="widget-color-trigger" aria-label="自定义底色" title="打开全色色轮" disabled={disabled} onClick={() => setColorOpen(true)}><span style={{ background: value.tint }} /></button></div>
      <label className="widget-setting-row"><span>不透明度</span><input type="range" aria-label="底色不透明度" min="15" max="100" step="1" value={Math.round(value.opacity * 100)} disabled={disabled} onChange={event => onChange({ opacity: Number(event.target.value) / 100 })} /><output>{Math.round(value.opacity * 100)}%</output></label>
    </div>}
    <div className="widget-settings-foot">{colorOpen ? <button type="button" onClick={closeColor} aria-label="完成选色">完成选色</button> : <button type="button" onClick={() => onChange({ ...DEFAULT_WIDGET_APPEARANCE })} disabled={disabled}><RotateCcw size={12} />恢复默认</button>}
      {status === 'failed' ? <span className="widget-save-error" role="alert">未保存<button type="button" onClick={onRetry}>重试</button></span> : <span role="status">{status === 'unavailable' ? '请重新打开应用' : status === 'loading' ? '正在读取…' : status === 'saving' ? '正在保存…' : '已自动保存'}</span>}
    </div>
  </div>;
}
