import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bone } from 'lucide-react';
import { clampPetCenter, createDesktopPetMotion, normalizePetLaunchPose, stepDesktopPetMotion, type DesktopPetMotion, type DesktopPetPoint } from '../../shared/desktop-pet-motion.mjs';
import { applyPetSprite, loadPetSpriteArtwork } from '../lib/pet-sprite';
import type { DesktopPetState } from '../lib/store';
import './browser-chasing-pet.css';

type Props = {
  active: boolean;
  anchor: RefObject<HTMLDivElement | null>;
  boneButton: RefObject<HTMLButtonElement | null>;
  onStateChange: (state: DesktopPetState) => void;
};
type Trip = {
  pet: DesktopPetMotion;
  cssSize: number;
  horizontalFraction: number;
  verticalOffset: number;
};

export default function BrowserChasingPet({ active, anchor, boneButton, onStateChange }: Props) {
  const dogRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const boneRef = useRef<HTMLSpanElement>(null);
  const control = useRef<((value: boolean) => void) | null>(null);
  const report = useRef(onStateChange);
  report.current = onStateChange;

  useLayoutEffect(() => {
    const dog = dogRef.current!;
    const sprite = spriteRef.current!;
    const bone = boneRef.current!;
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    const artwork = loadPetSpriteArtwork();
    let phase: 'docked' | 'loading' | 'chasing' | 'returning' = 'docked';
    let trip: Trip | null = null;
    let pointer: DesktopPetPoint | null = null;
    let requestedActive = false;
    let disposed = false;
    let generation = 0;
    let raf = 0;
    let lastTime: number | null = null;

    const viewport = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    const inside = (point: DesktopPetPoint) => point.x >= 0 && point.y >= 0 && point.x < innerWidth && point.y < innerHeight;

    function sample(): Trip | null {
      const lane = anchor.current?.querySelector<HTMLElement>('.widget-pet-lane');
      const source = lane?.querySelector<HTMLElement>('.widget-dog:not([hidden])');
      if (!lane || !source) return null;
      const area = lane.getBoundingClientRect();
      const rect = source.getBoundingClientRect();
      if (!rect.width || !rect.height || !area.width || !lane.clientWidth) return null;
      const zoom = area.width / lane.clientWidth;
      const frame = Number(source.dataset.frame) || 0;
      const stepPhase = Number(source.dataset.stepPhase);
      const speed = Number(source.dataset.speed);
      const launchPose = normalizePetLaunchPose({
        pose: source.dataset.pose, frame,
        stepPhase: Number.isFinite(stepPhase) ? stepPhase : frame % 4,
        speed: (Number.isFinite(speed) ? speed : source.dataset.pose === 'walk' ? 48 : 0) * zoom,
      });
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return {
        pet: createDesktopPetMotion({ ...center, facing: source.dataset.facing === '-1' ? -1 : 1, launchPose }),
        cssSize: rect.width / zoom,
        horizontalFraction: (center.x - area.left) / area.width,
        verticalOffset: (center.y - area.top) / zoom,
      };
    }

    function home() {
      const lane = anchor.current?.querySelector<HTMLElement>('.widget-pet-lane');
      if (!trip || !lane || !lane.isConnected || !lane.clientWidth) return null;
      const rect = lane.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const zoom = rect.width / lane.clientWidth;
      return {
        x: rect.left + trip.horizontalFraction * rect.width,
        y: rect.top + trip.verticalOffset * zoom,
        size: trip.cssSize * zoom,
      };
    }

    function hide() { dog.hidden = true; bone.hidden = true; }
    function stop() { cancelAnimationFrame(raf); raf = 0; lastTime = null; }
    function dock(point?: DesktopPetPoint) {
      const facing = trip?.pet.facing;
      trip = null;
      phase = 'docked';
      generation++;
      stop();
      hide();
      report.current({ phase: 'docked', ...(point ? { dockX: point.x, facing } : {}) });
    }

    function paintBone() {
      bone.hidden = document.hidden || phase !== 'chasing' || !requestedActive || !pointer;
      if (bone.hidden || !pointer) return;
      const x = pointer.x + (pointer.x + 39 > innerWidth ? -32 : 10);
      const y = pointer.y + (pointer.y + 37 > innerHeight ? -30 : 9);
      bone.style.transform = `translate3d(${Math.max(0, Math.min(innerWidth - 28, x))}px, ${Math.max(0, Math.min(innerHeight - 28, y))}px, 0)`;
    }

    function paintDog(size: number) {
      if (!trip || document.hidden) { dog.hidden = true; return; }
      const description = applyPetSprite(sprite, { ...trip.pet, size, grounded: false });
      dog.style.width = dog.style.height = `${size}px`;
      dog.style.transform = `translate3d(${trip.pet.x - size / 2}px, ${trip.pet.y - size / 2}px, 0)`;
      dog.dataset.phase = phase;
      dog.dataset.pose = trip.pet.pose;
      dog.dataset.frame = String(trip.pet.frame);
      dog.dataset.facing = String(trip.pet.facing);
      dog.dataset.stepPhase = String(trip.pet.stepPhase);
      dog.dataset.speed = String(Math.hypot(trip.pet.vx, trip.pet.vy));
      dog.dataset.sheet = description.sheet;
      dog.dataset.reducedMotion = String(quiet.matches);
      dog.hidden = false;
    }

    function wake() {
      if (!disposed && !raf && !document.hidden && trip && (phase === 'returning' || phase === 'chasing' && pointer)) {
        raf = requestAnimationFrame(draw);
      }
    }

    function draw(time: number) {
      raf = 0;
      if (disposed || document.hidden || !trip) return;
      const destination = home();
      if (!destination) { dock(); return; }
      const returning = phase === 'returning';
      if (!returning && !pointer) { lastTime = null; paintDog(destination.size); return; }
      if (!returning) {
        trip.pet = { ...trip.pet, ...clampPetCenter(trip.pet, viewport(), destination.size) };
      }
      const target = returning ? destination : clampPetCenter({ x: pointer!.x - 15, y: pointer!.y + 18 }, viewport(), destination.size);
      // An idle wake starts with elapsed=0. Its previous arrival belongs to the
      // old target, so it cannot stop a new chase or complete a new return.
      if (trip.pet.arrived && (returning || Math.hypot(target.x - trip.pet.x, target.y - trip.pet.y) > 5)) {
        trip.pet = { ...trip.pet, arrived: false };
      }
      trip.pet = stepDesktopPetMotion(trip.pet, target, lastTime === null ? 0 : time - lastTime, { returning, reducedMotion: quiet.matches });
      paintDog(destination.size);
      paintBone();
      if (returning && trip.pet.arrived && Math.hypot(destination.x - trip.pet.x, destination.y - trip.pet.y) <= 1.3) {
        dock(destination);
        return;
      }
      // Read the dock every frame during return; dragging or scaling it moves the destination.
      if (returning || !trip.pet.arrived) { lastTime = time; wake(); }
      else lastTime = null;
    }

    function initialPointer() {
      if (pointer && inside(pointer)) return;
      const button = boneButton.current?.getBoundingClientRect();
      const docked = home();
      pointer = button ? { x: button.left + button.width / 2, y: button.top + button.height / 2 }
        : docked ? { x: docked.x, y: docked.y } : null;
    }

    function setActive(value: boolean) {
      requestedActive = value;
      if (!value) {
        generation++;
        if (phase === 'loading') { phase = 'docked'; trip = null; hide(); return; }
        if (!trip || phase === 'docked' || phase === 'returning') return;
        phase = 'returning';
        lastTime = null;
        bone.hidden = true;
        report.current({ phase: 'returning' });
        wake();
        return;
      }
      if (phase === 'chasing' || phase === 'loading') return;
      if (trip && phase === 'returning') {
        phase = 'chasing';
        lastTime = null;
        initialPointer();
        report.current({ phase: 'chasing' });
        paintBone();
        wake();
        return;
      }
      // Keep the docked dog visible while artwork decodes, then take a fresh launch snapshot.
      if (!sample()) { dock(); return; }
      phase = 'loading';
      const current = ++generation;
      void artwork.then(ready => {
        if (disposed || current !== generation || !requestedActive) return;
        trip = ready ? sample() : null;
        if (!trip) { dock(); return; }
        const destination = home();
        if (!destination) { dock(); return; }
        phase = 'chasing';
        lastTime = null;
        initialPointer();
        paintDog(destination.size);
        paintBone();
        report.current({ phase: 'chasing' });
        wake();
      });
    }

    function onPointer(event: PointerEvent) {
      const point = { x: event.clientX, y: event.clientY };
      pointer = inside(point) ? point : null;
      if (phase !== 'chasing') return;
      paintBone();
      wake();
    }
    function leaveViewport() {
      pointer = null;
      bone.hidden = true;
      if (phase !== 'chasing' || !trip) return;
      stop();
      trip.pet = { ...trip.pet, vx: 0, vy: 0, pose: 'stand', frame: 0, arrived: false };
      const destination = home();
      if (destination) paintDog(destination.size);
    }
    function onPointerOut(event: PointerEvent) { if (!event.relatedTarget) leaveViewport(); }
    function measure() {
      lastTime = null;
      if (document.hidden) { hide(); return; }
      if (!trip) return;
      const destination = home();
      if (!destination) { dock(); return; }
      if (phase === 'chasing') trip.pet = { ...trip.pet, ...clampPetCenter(trip.pet, viewport(), destination.size) };
      paintDog(destination.size);
      paintBone();
      wake();
    }
    function visibility() {
      stop();
      if (document.hidden) hide();
      else measure();
    }

    const observer = new ResizeObserver(measure);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('pointerover', onPointer, true);
    window.addEventListener('pointerout', onPointerOut, true);
    window.addEventListener('blur', leaveViewport);
    window.addEventListener('resize', measure);
    document.addEventListener('visibilitychange', visibility);
    quiet.addEventListener('change', measure);
    control.current = setActive;
    return () => {
      disposed = true;
      generation++;
      stop();
      hide();
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerover', onPointer, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      window.removeEventListener('blur', leaveViewport);
      window.removeEventListener('resize', measure);
      document.removeEventListener('visibilitychange', visibility);
      quiet.removeEventListener('change', measure);
      if (control.current === setActive) control.current = null;
    };
  }, [anchor, boneButton]);

  useLayoutEffect(() => { control.current?.(active); }, [active, anchor, boneButton]);

  return createPortal(<div className="browser-chasing-layer">
    <div className="browser-chasing-dog" ref={dogRef} role="img" aria-label="追骨头的狗狗" hidden>
      <span className="browser-chasing-sprite" ref={spriteRef} aria-hidden="true" />
    </div>
    <span className="pet-held-bone browser-chasing-bone" ref={boneRef} hidden aria-hidden="true"><Bone size={25} strokeWidth={1.8} /></span>
  </div>, document.body);
}
