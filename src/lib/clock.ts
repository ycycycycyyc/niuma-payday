import { useEffect, useState } from 'react';

// One explicit preview clock shared by every panel; real mode always uses wall time.
const bootTime = Date.now();
const demoStart = new Date();
while (demoStart.getDay() === 0 || demoStart.getDay() === 6) demoStart.setDate(demoStart.getDate() - 1);
demoStart.setHours(14, 36, 12, 0);
export const clockDate = (demo: boolean) => new Date(demo ? demoStart.getTime() + Date.now() - bootTime : Date.now());
export function useClock(demo = false, interval = 1000) {
  const [now, setNow] = useState(() => clockDate(demo));
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setNow(clockDate(demo));
    const visibility = () => {
      if (timer) clearInterval(timer);
      update();
      if (!document.hidden) timer = setInterval(update, interval);
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [demo, interval]);
  return now;
}
export const currencySymbol = (currency: string) => currency === 'HKD' ? 'HK$' : currency === 'USD' ? '$' : '¥';
export const money = (n: number, digits = 2) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const duration = (seconds: number) => {
  const safe = Math.max(0, Math.ceil(seconds));
  return [Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60].map(v => String(v).padStart(2, '0')).join(':');
};
