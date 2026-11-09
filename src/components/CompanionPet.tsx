import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { createCompanionMotion, placeCompanionMotion, stepCompanionMotion } from '../../shared/desktop-pet-companion.mjs';
import { applyPetSprite, loadPetSpriteArtwork } from '../lib/pet-sprite';
import { createPetRestoreTarget } from '../lib/pet-restore-target';
import './companion-pet.css';

export type CompanionOrigin = {
  x: number; y: number; size?: number; facing?: 1 | -1; pose?: string; frame?: number; stepPhase?: number;
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
    let decoded = false;
    let disposed = false;
    const restoreTarget = createPetRestoreTarget(dog, {
      onDrag(center) {
        const fieldRect = field.getBoundingClientRect();
        pet = placeCompanionMotion(pet, { x: center.x - fieldRect.x, y: center.y - fieldRect.y }, bounds);
        paint();
      },
      onRelease() { lastTime = null; wake(); },
    });

    void loadPetSpriteArtwork().then(ready => {
      if (disposed) return;
      decoded = ready;
      measure();
    }).catch(() => {
      // The live app ships these local images together. A partial web export
      // must not start an invisible animation or leave a floating hit area.
      if (!disposed) dog.hidden = true;
    });

    function paint() {
      const description = applyPetSprite(sprite, { ...pet, size, grounded: true });
      dog.style.width = dog.style.height = `${size}px`;
      dog.style.transform = `translate3d(${pet.x - size / 2}px, ${pet.y - size / 2}px, 0)`;
      dog.dataset.pose = pet.pose;
      dog.dataset.frame = String(pet.frame);
      dog.dataset.facing = String(pet.facing);
      dog.dataset.sheet = description.sheet;
      dog.dataset.reducedMotion = String(quiet.matches);
      dog.hidden = !decoded;
      restoreTarget.sync();
    }

    function wake() {
      if (!raf && !disposed && !document.hidden && decoded) raf = requestAnimationFrame(draw);
    }

    function draw(time: number) {
      raf = 0;
      if (document.hidden || restoreTarget.dragging) return;
      pet = stepCompanionMotion(pet, lastTime === null ? 0 : time - lastTime, { bounds, size, reducedMotion: quiet.matches });
      paint();
      if (!quiet.matches) {
        lastTime = time;
        wake();
      } else lastTime = null;
    }

    function measure() {
      bounds = { x: 0, y: 0, width: field.clientWidth, height: field.clientHeight };
      pet = stepCompanionMotion(pet, 0, { bounds, size, reducedMotion: quiet.matches });
      lastTime = null;
      paint();
      wake();
    }

    function visibility() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = null;
      restoreTarget.release();
      restoreTarget.clear();
      if (document.hidden) pet = stepCompanionMotion(pet, 0, { bounds, size, paused: true });
      else measure();
    }
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    document.addEventListener('visibilitychange', visibility);
    quiet.addEventListener('change', measure);
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      restoreTarget.destroy();
      observer.disconnect();
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
      aria-label="双击狗狗恢复浮窗" title="拖动狗狗，双击恢复浮窗"
      onDoubleClick={onRestore} onKeyDown={keyRestore} hidden>
      <span className="companion-pet-sprite" ref={spriteRef} aria-hidden="true" />
    </button>
  </div>;
}
