import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createCompanionMotion, stepCompanionMotion, type CompanionMotionState } from '../../shared/desktop-pet-companion.mjs';
import actions from '../assets/widget-dog-actions.webp';
import walk from '../assets/widget-dog-walk.webp';
import companion from '../assets/widget-dog-companion.png';
import sleeping from '../assets/widget-dog-sleep.png';
import playing from '../assets/widget-dog-play.png';
import './companion-pet.css';

export type CompanionOrigin = {
  x: number; y: number; size?: number; facing?: 1 | -1; pose?: string; frame?: number; stepPhase?: number;
};

const sleepRows: Partial<Record<CompanionMotionState['pose'], number>> = { sleep: 0, 'sleep-side': 1, 'sleep-belly': 2 };
const sheets = {
  walk: { image: walk, columns: 4, rows: 1 }, actions: { image: actions, columns: 7, rows: 1 },
  companion: { image: companion, columns: 4, rows: 4 }, sleep: { image: sleeping, columns: 6, rows: 3 },
  play: { image: playing, columns: 4, rows: 3 },
};

export default function CompanionPet({ origin, onRestore }: { origin: CompanionOrigin; onRestore: () => void }) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const dogRef = useRef<HTMLButtonElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const field = fieldRef.current!;
    const dog = dogRef.current!;
    const sprite = spriteRef.current!;
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    const size = Number.isFinite(origin.size) ? Math.max(24, origin.size!) : 76;
    let bounds = { x: 0, y: 0, width: field.clientWidth, height: field.clientHeight };
    let pet = createCompanionMotion(origin, bounds, size);
    let raf = 0;
    let lastTime: number | null = null;
    let hovered = false;
    let heldUntil = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let decoded = false;
    let disposed = false;

    void Promise.all([walk, actions, companion, sleeping, playing].map(source => {
      const image = new Image();
      image.src = source;
      return image.decode();
    })).then(() => {
      if (disposed) return;
      decoded = true;
      measure();
    }).catch(() => {
      // The live app ships these local images together. A partial web export
      // must not start an invisible animation or leave a floating hit area.
      if (!disposed) dog.hidden = true;
    });

    function paint() {
      const sleepRow = sleepRows[pet.pose];
      const sheet = sleepRow !== undefined ? 'sleep' : pet.pose === 'play' ? 'play'
        : pet.pose === 'lick' || pet.pose === 'roll' ? 'companion' : pet.pose === 'walk' ? 'walk' : 'actions';
      const { image, columns, rows } = sheets[sheet];
      const column = sheet === 'play' ? pet.frame % 4 : pet.frame;
      const row = sheet === 'play' ? Math.floor(pet.frame / 4) : sleepRow ?? (pet.pose === 'roll' ? 3 : 0);
      if (sprite.dataset.sheet !== sheet) {
        sprite.dataset.sheet = sheet;
        sprite.style.backgroundImage = `url("${image}")`;
        sprite.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
      }
      sprite.style.backgroundPosition = `${100 * column / (columns - 1)}% ${rows === 1 ? 50 : 100 * row / (rows - 1)}%`;
      sprite.style.transform = `scaleX(${pet.facing})`;
      dog.style.width = dog.style.height = `${size}px`;
      dog.style.transform = `translate3d(${pet.x - size / 2}px, ${pet.y - size / 2}px, 0)`;
      dog.dataset.pose = pet.pose;
      dog.dataset.frame = String(pet.frame);
      dog.dataset.facing = String(pet.facing);
      dog.dataset.reducedMotion = String(quiet.matches);
      dog.hidden = !decoded;
    }

    function wake() {
      if (!raf && !document.hidden && decoded) raf = requestAnimationFrame(draw);
    }

    function draw(time: number) {
      raf = 0;
      if (document.hidden) return;
      const paused = hovered || time < heldUntil;
      pet = stepCompanionMotion(pet, lastTime === null ? 0 : time - lastTime, { bounds, size, paused, reducedMotion: quiet.matches });
      paint();
      if (!paused && !quiet.matches) {
        lastTime = time;
        wake();
      } else lastTime = null;
    }

    function measure() {
      bounds = { x: 0, y: 0, width: field.clientWidth, height: field.clientHeight };
      pet = stepCompanionMotion(pet, 0, { bounds, size, paused: hovered || performance.now() < heldUntil, reducedMotion: quiet.matches });
      lastTime = null;
      paint();
      wake();
    }

    function enter() { hovered = true; wake(); }
    function leave() { hovered = false; lastTime = null; wake(); }
    function hold(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0) return;
      heldUntil = performance.now() + 850;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { lastTime = null; wake(); }, 860);
      wake();
    }
    function visibility() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = null;
      if (document.hidden) pet = stepCompanionMotion(pet, 0, { bounds, size, paused: true });
      else {
        // The pointer may have left while this tab was in the background.
        hovered = dog.matches(':hover');
        measure();
      }
    }
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    dog.addEventListener('pointerenter', enter);
    dog.addEventListener('pointerleave', leave);
    dog.addEventListener('pointerdown', hold);
    document.addEventListener('visibilitychange', visibility);
    quiet.addEventListener('change', measure);
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(holdTimer);
      observer.disconnect();
      dog.removeEventListener('pointerenter', enter);
      dog.removeEventListener('pointerleave', leave);
      dog.removeEventListener('pointerdown', hold);
      document.removeEventListener('visibilitychange', visibility);
      quiet.removeEventListener('change', measure);
    };
  }, [origin.x, origin.y, origin.size, origin.facing, origin.pose, origin.frame, origin.stepPhase]);

  function keyRestore(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onRestore();
    }
  }

  return <div className="companion-pet-field" ref={fieldRef}>
    <button type="button" className="companion-pet-dog" ref={dogRef}
      aria-label="双击狗狗恢复浮窗" title="双击狗狗恢复浮窗"
      onDoubleClick={onRestore} onKeyDown={keyRestore} hidden>
      <span className="companion-pet-sprite" ref={spriteRef} aria-hidden="true" />
    </button>
  </div>;
}
