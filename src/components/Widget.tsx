import { ArrowUpRight, Bone, Clock3, GripHorizontal, X } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import layout from '../../shared/widget-layout.json';
import { DEFAULT_SETTINGS, calculateSalary } from '../lib/salary';
import { duration, useClock } from '../lib/clock';
import type { AppState } from '../lib/store';
import LiveAmount from './LiveAmount';
import Mascot from './Mascot';
import WidgetPet from './WidgetPet';
import './widget.css';

// The transparent pet lane is part of the same frameless native window.
export const widgetLayoutStyle = {
  '--widget-width': `${layout.width}px`,
  '--card-height': `${layout.cardHeight}px`,
  '--lane-height': `${layout.laneHeight}px`,
} as CSSProperties;

export default function Widget({ state, onRestore, onHide, preview = false }: { state: AppState; onRestore: () => void; onHide: () => void; preview?: boolean }) {
  const [chasing, setChasing] = useState(false);
  const boneButton = useRef<HTMLButtonElement>(null);
  const demo = !state.configured;
  const settings = demo ? DEFAULT_SETTINGS : state.settings;
  const now = useClock(demo);
  const calendar = demo ? {} : state.calendar;
  const result = calculateSalary(settings, now, calendar);
  const onShift = result.status === 'working' || result.status === 'break';
  const timeLabel = onShift ? '距离下班' : '工作时段';
  const timeValue = onShift ? duration(result.remainingSeconds) : `${settings.startTime}–${settings.endTime}`;

  return <div className="widget-stack" style={widgetLayoutStyle}>
    <WidgetPet chasing={chasing} setChasing={setChasing} boneButton={boneButton} preview={preview} />
    <section className={`widget ${preview ? 'widget-preview' : ''}`} aria-label="工资悬浮窗">
      <div className="widget-head">
        <span className="widget-status"><i className={result.status === 'working' ? 'active' : ''} />{demo ? '演示数据' : result.statusLabel}</span>
        <GripHorizontal size={18} className="widget-grip" aria-hidden="true" />
        <div className="widget-actions">
          <button ref={boneButton} type="button" className="widget-bone-toggle" aria-pressed={chasing}
            aria-label={chasing ? '收起骨头' : '拿起骨头'} title={chasing ? '收起骨头（Esc）' : '拿起骨头，让她追着玩'}
            onClick={() => setChasing(held => !held)}><Bone size={17} aria-hidden="true" /></button>
          <button onClick={onRestore} aria-label="返回主窗口" title="返回主窗口"><ArrowUpRight size={18} /></button>
          <button onClick={onHide} aria-label="隐藏浮窗" title="隐藏浮窗"><X size={17} /></button>
        </div>
      </div>
      <div className="widget-middle">
        <div className="widget-earnings"><span className="widget-earnings-label">今日已赚</span><LiveAmount settings={settings} demo={demo} privacy={state.privacy} calendar={calendar} compact /></div>
        <div className="widget-mascot" aria-hidden="true"><Mascot /></div>
      </div>
      <div className="widget-foot"><span className="widget-time-label"><Clock3 size={19} aria-hidden="true" />{timeLabel}</span><span className={`widget-time-value ${onShift ? '' : 'schedule'}`}>{timeValue}</span></div>
      <div className="widget-progress"><i style={{ width: `${result.progress * 100}%` }} /></div>
    </section>
  </div>;
}
