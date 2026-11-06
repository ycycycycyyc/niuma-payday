import { ArrowUpRight, GripHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, calculateSalary } from '../lib/salary';
import { duration, useClock } from '../lib/clock';
import type { AppState } from '../lib/store';
import LiveAmount from './LiveAmount';

function WalkingDog() {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const syncVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);
  return <div className="widget-pet-lane" aria-hidden="true" data-paused={hidden || undefined}>
    <div className="pet-traveller">
      <div className="pet-facing"><div className="pet-sprite" /></div>
    </div>
  </div>;
}

export default function Widget({ state, onRestore, onHide, preview = false }: { state: AppState; onRestore: () => void; onHide: () => void; preview?: boolean }) {
  const demo = !state.configured;
  const settings = demo ? DEFAULT_SETTINGS : state.settings;
  const now = useClock(demo);
  const result = calculateSalary(settings, now, demo ? {} : state.calendar);
  return <div className="widget-stack">
    <WalkingDog />
    <section className={`widget ${preview ? 'widget-preview' : ''}`} aria-label="工资悬浮窗">
      <div className="widget-head">
        <span><i className={`status-dot ${result.status === 'working' ? '' : 'resting'}`} />{demo ? '演示数据' : result.statusLabel}</span>
        <GripHorizontal size={16} className="widget-grip" />
        <div className="widget-actions">
          <button onClick={onRestore} aria-label="返回主窗口" title="返回主窗口"><ArrowUpRight size={17} /></button>
          <button onClick={onHide} aria-label="隐藏浮窗" title="隐藏浮窗"><X size={15} /></button>
        </div>
      </div>
      <LiveAmount settings={settings} demo={demo} privacy={state.privacy} calendar={demo ? {} : state.calendar} compact />
      <div className="widget-foot"><span>{result.status === 'working' || result.status === 'break' ? '距离下班' : '工作时段'}</span><span>{result.status === 'working' || result.status === 'break' ? duration(result.remainingSeconds) : `${settings.startTime} – ${settings.endTime}`}</span></div>
      <div className="widget-progress"><i style={{ width: `${result.progress * 100}%` }} /></div>
    </section>
  </div>;
}
