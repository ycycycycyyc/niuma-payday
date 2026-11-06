import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bone } from 'lucide-react';
import { createPetMotion, requestPetHandshake, stepPetMotion } from '../lib/pet-motion';
import actions from '../assets/widget-dog-actions.webp';
import walk from '../assets/widget-dog-walk.webp';
import './widget-pet.css';

const actionFrames = { stand: 0, turn: 1, crouch: 2, sit: 3, lift: 4, paw: 5, wag: 6 };
type Point = { x: number; y: number };
type Props = {
  chasing: boolean;
  setChasing: (active: boolean) => void;
  boneButton: RefObject<HTMLButtonElement | null>;
  preview: boolean;
};

export default function WidgetPet({ chasing, setChasing, boneButton, preview }: Props) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dogRef = useRef<HTMLButtonElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const boneRef = useRef<HTMLSpanElement>(null);
  const motion = useRef(createPetMotion());
  const handshake = useRef<() => void>(() => {});

  useEffect(() => {
    for (const src of [walk, actions]) { const image = new Image(); image.src = src; }
  }, []);

  useEffect(() => {
    const lane = laneRef.current!;
    const dog = dogRef.current!;
    const sprite = spriteRef.current!;
    const bone = boneRef.current;
    const bridge = !preview && window.niuma?.setWidgetPet ? window.niuma : undefined;
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    let pointer: Point | null = null;
    let trackLength = 0;
    let halfDog = 0;
    let inset = 0;
    let raf = 0;
    let lastTime: number | null = null;
    let lastReport = -Infinity;
    let reportedX = NaN;

    function wake() {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
    }
    function syncHitArea(time: number, settling: boolean) {
      if (!bridge || (!settling && time - lastReport < 32)) return;
      const x = Math.round(motion.current.x);
      if (x === reportedX) return;
      const rect = dog.getBoundingClientRect();
      bridge.setWidgetPet({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, chasing });
      reportedX = x;
      lastReport = time;
    }
    function draw(time: number) {
      raf = 0;
      if (document.hidden) return;
      const targetX = pointer && chasing ? pointer.x - lane.getBoundingClientRect().left - inset - halfDog : null;
      const pet = stepPetMotion(motion.current, lastTime === null ? 0 : time - lastTime, {
        trackLength, chasing, targetX, reducedMotion: quiet.matches,
      });
      motion.current = pet;
      const { pose } = pet;
      const walking = pose === 'walk';
      const frame = walking ? pet.frame : actionFrames[pose];
      dog.style.transform = `translate3d(${pet.x}px, 0, 0)`;
      const sheet = walking ? 'walk' : 'actions';
      if (sprite.dataset.sheet !== sheet) {
        sprite.dataset.sheet = sheet;
        sprite.style.backgroundImage = `url("${walking ? walk : actions}")`;
        sprite.style.backgroundSize = walking ? '400% 100%' : '700% 100%';
      }
      if (dog.dataset.pose !== pet.pose || dog.dataset.frame !== String(frame)) {
        dog.dataset.pose = pet.pose;
        dog.dataset.frame = String(frame);
        sprite.style.backgroundPositionX = `${frame * 100 / (walking ? 3 : 6)}%`;
      }
      if (dog.dataset.facing !== String(pet.facing)) {
        dog.dataset.facing = String(pet.facing);
        sprite.style.transform = `scaleX(${pet.facing})`;
      }
      const moving = !quiet.matches && trackLength >= 4 && !(chasing && pet.pose === 'wag');
      syncHitArea(time, !moving);
      if (pet.handshakeMs !== null || moving) {
        lastTime = time;
        wake();
      } else {
        lastTime = null;
      }
    }
    function measure() {
      inset = dog.offsetLeft;
      halfDog = dog.offsetWidth / 2;
      trackLength = Math.max(0, lane.clientWidth - 2 * (inset + halfDog));
      reportedX = NaN;
      lastReport = -Infinity;
      wake();
    }
    function movePointer(point: Point) {
      pointer = point;
      if (bone) {
        const visible = point.x >= 0 && point.y >= 0 && point.x < innerWidth && point.y < innerHeight;
        bone.hidden = !visible;
        if (visible) {
          const x = point.x + (point.x + 39 > innerWidth ? -32 : 10);
          const y = point.y + (point.y + 37 > innerHeight ? -30 : 9);
          bone.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
      }
      wake();
    }
    const onPointer = (e: PointerEvent) => movePointer({ x: e.clientX, y: e.clientY });
    const onPointerOut = (e: PointerEvent) => { if (!e.relatedTarget && bone) bone.hidden = true; };
    const onKey = (e: KeyboardEvent) => {
      if (chasing && e.key === 'Escape') { e.preventDefault(); setChasing(false); }
    };
    function visibility() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = null;
      if (document.hidden) {
        if (chasing) setChasing(false);
        motion.current = createPetMotion(motion.current.x);
      } else measure();
    }
    handshake.current = () => { motion.current = requestPetHandshake(motion.current); wake(); };
    const resize = new ResizeObserver(measure);
    resize.observe(lane);
    document.addEventListener('visibilitychange', visibility);
    quiet.addEventListener('change', measure);
    let unsubscribe: (() => void) | undefined;
    if (chasing) {
      document.addEventListener('keydown', onKey);
      // Native drag regions swallow DOM pointer moves; the widget supplies its local coordinates.
      if (bridge) unsubscribe = bridge.onWidgetPointer(movePointer);
      else {
        window.addEventListener('pointermove', onPointer, true);
        window.addEventListener('pointerout', onPointerOut, true);
      }
      const button = boneButton.current?.getBoundingClientRect();
      if (button) movePointer({ x: button.left + button.width / 2, y: button.top + button.height / 2 });
    }
    measure();
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      quiet.removeEventListener('change', measure);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      unsubscribe?.();
      handshake.current = () => {};
    };
  }, [chasing, setChasing, boneButton, preview]);

  return <>
    <div className="widget-pet-lane" ref={laneRef}>
      <button type="button" className="widget-dog" ref={dogRef} aria-label="和狗狗握手" title="和狗狗握手"
        onPointerDown={e => { if (e.isPrimary && e.button === 0) e.currentTarget.setPointerCapture(e.pointerId); }}
        onClick={() => handshake.current()}>
        <span className="pet-sprite" ref={spriteRef} aria-hidden="true" />
      </button>
    </div>
    {chasing && createPortal(<span ref={boneRef} className="pet-held-bone" hidden aria-hidden="true">
      <Bone size={25} strokeWidth={1.8} />
    </span>, document.body)}
  </>;
}
