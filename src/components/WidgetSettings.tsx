import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { DEFAULT_WIDGET_APPEARANCE } from '../../shared/widget-appearance.mjs';
import type { WidgetAppearance } from '../lib/widget-appearance';

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
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const disabled = status === 'loading' || status === 'unavailable';
  return <div className="widget-settings" ref={panel} role="dialog" aria-modal="true" aria-label="浮窗设置" onKeyDown={keyboard}>
    <div className="widget-settings-head"><strong>浮窗设置</strong><button type="button" onClick={onClose} aria-label="返回浮窗" title="返回浮窗"><ArrowLeft size={15} /><span>返回</span></button></div>
    <div className="widget-settings-fields">
      <label className="widget-setting-row"><span>大小</span><input type="range" aria-label="浮窗大小" min="85" max="150" step="5" value={Math.round(value.scale * 100)} disabled={disabled} onChange={event => onChange({ scale: Number(event.target.value) / 100 })} /><output>{Math.round(value.scale * 100)}%</output></label>
      <div className="widget-setting-row"><span>底色</span><div className="widget-swatches" role="group" aria-label="浮窗底色预设">{swatches.map(swatch => <button type="button" key={swatch.tint} aria-label={swatch.name} title={swatch.name} aria-pressed={value.tint === swatch.tint} style={{ background: swatch.tint }} disabled={disabled} onClick={() => onChange({ tint: swatch.tint })} />)}</div><input type="color" aria-label="浮窗底色" title="自定义底色" value={value.tint} disabled={disabled} onChange={event => onChange({ tint: event.target.value })} /></div>
      <label className="widget-setting-row"><span>不透明度</span><input type="range" aria-label="底色不透明度" min="15" max="100" step="1" value={Math.round(value.opacity * 100)} disabled={disabled} onChange={event => onChange({ opacity: Number(event.target.value) / 100 })} /><output>{Math.round(value.opacity * 100)}%</output></label>
    </div>
    <div className="widget-settings-foot"><button type="button" onClick={() => onChange({ ...DEFAULT_WIDGET_APPEARANCE })} disabled={disabled}><RotateCcw size={12} />恢复默认</button>
      {status === 'failed' ? <span className="widget-save-error" role="alert">未保存<button type="button" onClick={onRetry}>重试</button></span> : <span role="status">{status === 'unavailable' ? '请重新打开应用' : status === 'loading' ? '正在读取…' : status === 'saving' ? '正在保存…' : '已自动保存'}</span>}
    </div>
  </div>;
}
