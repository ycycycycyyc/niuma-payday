import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bone } from 'lucide-react';
import { createPetMotion, requestPetHandshake, stepPetMotion } from '../lib/pet-motion';
import { createPetFeeding, stepPetFeeding, type PetFeeding, type PetFood } from '../../shared/pet-feeding.mjs';
import { createPetFeedingView } from '../lib/pet-feeding-view';
import type { DesktopPetState } from '../lib/store';
import actions from '../assets/widget-dog-actions.webp';
import walk from '../assets/widget-dog-walk.webp';
import './widget-pet.css';

const actionFrames = { stand: 0, turn: 1, crouch: 2, sit: 3, lift: 4, paw: 5, wag: 6 };
type Point = { x: number; y: number };
type Props = {
  chasing: boolean;
  feedingEnabled: boolean;
  setChasing: (active: boolean) => void;
  boneButton: RefObject<HTMLButtonElement | null>;
  desktopState: DesktopPetState;
  preview: boolean;
};

export default function WidgetPet({ chasing, feedingEnabled, setChasing, boneButton, desktopState, preview }: Props) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dogRef = useRef<HTMLButtonElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const boneRef = useRef<HTMLSpanElement>(null);
  const motion = useRef(createPetMotion());
  const handshake = useRef<() => void>(() => {});
  const { phase, dockX, facing } = desktopState;

  useEffect(() => {
    for (const src of [walk, actions]) { const image = new Image(); image.src = src; }
  }, []);

  useLayoutEffect(() => {
    // The desktop layer owns the sprite and mouse hit area until landing.
    if (phase !== 'docked') return;
    const lane = laneRef.current!;
    const dog = dogRef.current!;
    const sprite = spriteRef.current!;
    const bone = boneRef.current;
    const api = preview ? undefined : window.niuma;
    const bridge = api?.setWidgetPet && api.onWidgetPointer
      ? { setWidgetPet: api.setWidgetPet, onWidgetPointer: api.onWidgetPointer } : undefined;
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    let pointer: Point | null = null;
    let trackLength = 0;
    let halfDog = 0;
    let inset = 0;
    let raf = 0;
    let lastTime: number | null = null;
    let lastReport = -Infinity;
    let reportedX = NaN;
    let reportedFacing = 0;
    let reportedPose = '';
    let reportedFrame = -1;
    let reportedMenu = '';
    let menuOpen = false;
    let feeding: PetFeeding | null = null;
    let suppressMenu = false;
    const foodView = createPetFeedingView(lane, {
      onFeed: feed,
      onMenuEnter: () => {},
      onMenuLeave: leaveMenu,
    });

    function closeMenu() {
      menuOpen = false;
      dog.setAttribute('aria-expanded', 'false');
      renderFood();
      const pet = motion.current;
      syncHitArea(performance.now(), true, pet.pose === 'walk' ? pet.frame : actionFrames[pet.pose]);
      wake();
    }
    function openMenu() {
      if (!feedingEnabled || feeding || suppressMenu || motion.current.handshakeMs !== null) return;
      menuOpen = true;
      // Stop at the current footprint instead of advancing while a click is aimed.
      motion.current = { ...motion.current, speed: 0, turn: null, pose: 'stand', frame: 0 };
      dog.setAttribute('aria-expanded', 'true');
      wake();
    }
    function overFoodControls(point: Point) {
      const bounds = dog.getBoundingClientRect();
      const menu = foodView.menu.getBoundingClientRect();
      if ([bounds, menu].some(rect => point.x >= rect.left && point.x < rect.right &&
          point.y >= rect.top && point.y < rect.bottom)) return true;
      // Keep only the short corridor between the dog and the menu interactive,
      // so moving toward food never requires a delayed close everywhere else.
      const left = Math.min(bounds.right, menu.right), right = Math.max(bounds.left, menu.left);
      return left <= right && point.x >= left && point.x <= right &&
        point.y >= Math.max(bounds.top, menu.top) && point.y < Math.min(bounds.bottom, menu.bottom);
    }
    function leaveMenu(event?: PointerEvent | FocusEvent) {
      if (!menuOpen) return;
      const next = event?.relatedTarget;
      if (next instanceof Node && (dog.contains(next) || foodView.menu.contains(next))) return;
      if (event instanceof PointerEvent && menuOpen && overFoodControls({ x: event.clientX, y: event.clientY })) return;
      if (!lane.querySelector(':focus-visible')) closeMenu();
    }
    function enterDog() {
      if (!feeding) suppressMenu = false;
      openMenu();
    }
    function leaveDog(event: PointerEvent) { suppressMenu = false; leaveMenu(event); }
    function feed(food: PetFood) {
      if (!feedingEnabled || feeding) return;
      feeding = createPetFeeding(food);
      if (!feeding) return;
      suppressMenu = true;
      closeMenu();
      motion.current = { ...motion.current, speed: 0, turn: null, handshakeMs: null };
      if (foodView.menu.contains(document.activeElement)) dog.focus({ preventScroll: true });
      lastTime = null;
      wake();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && menuOpen) {
        event.preventDefault();
        event.stopPropagation();
        suppressMenu = true;
        closeMenu();
        dog.focus({ preventScroll: true });
      } else if (event.key === 'ArrowDown' && event.target === dog && feedingEnabled && !feeding) {
        event.preventDefault();
        suppressMenu = false;
        openMenu();
        // Paint immediately so the previously hidden button can receive focus.
        renderFood();
        foodView.menu.querySelector('button')?.focus();
      }
    }
    function renderFood() {
      const pet = motion.current;
      foodView.render({
        anchor: { x: inset + pet.x, y: dog.offsetTop, width: dog.offsetWidth, height: dog.offsetHeight },
        bounds: { x: 0, y: 0, width: lane.clientWidth, height: lane.clientHeight },
        facing: pet.facing, feeding, open: menuOpen, reducedMotion: quiet.matches,
      });
      dog.dataset.feeding = String(Boolean(feeding));
      dog.setAttribute('aria-busy', String(Boolean(feeding)));
    }

    function wake() {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
    }
    function syncHitArea(time: number, settling: boolean, frame: number) {
      if (!bridge) return;
      const pet = motion.current;
      const x = Math.round(pet.x);
      const samePose = pet.facing === reportedFacing && pet.pose === reportedPose && frame === reportedFrame;
      const menu = menuOpen && !feeding ? foodView.menu.getBoundingClientRect() : null;
      const menuKey = menu ? `${menu.x},${menu.y},${menu.width},${menu.height}` : '';
      if (samePose && menuKey === reportedMenu && (x === reportedX || (!settling && time - lastReport < 32))) return;
      const rect = dog.getBoundingClientRect();
      bridge.setWidgetPet({
        left: rect.left, top: rect.top, width: rect.width, height: rect.height, chasing, facing: pet.facing,
        launchPose: { pose: pet.pose, frame, stepPhase: pet.stepPhase, speed: pet.speed },
        menu: menu && { left: menu.left, top: menu.top, width: menu.width, height: menu.height },
      });
      reportedX = x;
      reportedFacing = pet.facing;
      reportedPose = pet.pose;
      reportedFrame = frame;
      reportedMenu = menuKey;
      lastReport = time;
    }
    function draw(time: number) {
      raf = 0;
      if (document.hidden) return;
      const targetX = pointer && chasing ? pointer.x - lane.getBoundingClientRect().left - inset - halfDog : null;
      const delta = lastTime === null ? 0 : time - lastTime;
      const wasFeeding = Boolean(feeding);
      if (feeding) feeding = stepPetFeeding(feeding, delta);
      const pet = wasFeeding || menuOpen ? motion.current : stepPetMotion(motion.current, delta, {
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
      dog.dataset.stepPhase = String(pet.stepPhase);
      dog.dataset.speed = String(pet.speed);
      renderFood();
      const moving = !menuOpen && !quiet.matches && trackLength >= 4 && !(chasing && pet.pose === 'wag');
      syncHitArea(time, !moving, frame);
      if (feeding || pet.handshakeMs !== null || moving) {
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
      if (menuOpen && !overFoodControls(point)) leaveMenu();
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
    const onPointer = (event: PointerEvent) => {
      if (chasing || menuOpen) movePointer({ x: event.clientX, y: event.clientY });
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) {
        if (bone) bone.hidden = true;
        leaveMenu();
      }
    };
    function visibility() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = null;
      if (document.hidden) {
        feeding = null;
        closeMenu();
        if (chasing) setChasing(false);
        motion.current = createPetMotion(motion.current.x);
      } else measure();
    }
    handshake.current = () => {
      if (feeding) return;
      suppressMenu = true;
      closeMenu();
      motion.current = requestPetHandshake(motion.current);
      wake();
    };
    dog.addEventListener('pointerenter', enterDog);
    dog.addEventListener('pointerleave', leaveDog);
    dog.addEventListener('focus', openMenu);
    dog.addEventListener('blur', leaveMenu);
    lane.addEventListener('keydown', keydown);
    const resize = new ResizeObserver(measure);
    resize.observe(lane);
    document.addEventListener('visibilitychange', visibility);
    quiet.addEventListener('change', measure);
    let unsubscribe: (() => void) | undefined;
    // Native drag regions swallow DOM pointer moves; the widget supplies its local coordinates.
    if (bridge) unsubscribe = bridge.onWidgetPointer(movePointer);
    if (!bridge) {
      window.addEventListener('pointermove', onPointer, true);
      window.addEventListener('pointerout', onPointerOut, true);
    }
    if (chasing) {
      const button = boneButton.current?.getBoundingClientRect();
      if (button) movePointer({ x: button.left + button.width / 2, y: button.top + button.height / 2 });
    }
    measure();
    if (dockX !== undefined) {
      const bounds = lane.getBoundingClientRect();
      const zoom = bounds.width / lane.clientWidth || 1;
      const x = Math.min(trackLength, Math.max(0, (dockX - bounds.left) / zoom - inset - halfDog));
      motion.current = createPetMotion(x);
      if (facing) motion.current.facing = facing;
    }
    // Publish the starting footprint before the first possible toolbar click.
    cancelAnimationFrame(raf);
    draw(performance.now());
    return () => {
      foodView.destroy();
      dog.dataset.feeding = 'false';
      dog.setAttribute('aria-expanded', 'false');
      dog.removeEventListener('pointerenter', enterDog);
      dog.removeEventListener('pointerleave', leaveDog);
      dog.removeEventListener('focus', openMenu);
      dog.removeEventListener('blur', leaveMenu);
      lane.removeEventListener('keydown', keydown);
      cancelAnimationFrame(raf);
      resize.disconnect();
      quiet.removeEventListener('change', measure);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      unsubscribe?.();
      handshake.current = () => {};
    };
  }, [chasing, feedingEnabled, setChasing, boneButton, preview, phase, dockX, facing]);

  return <>
    <div className="widget-pet-lane" ref={laneRef} data-pet-phase={phase}>
      <button type="button" className="widget-dog" ref={dogRef} hidden={phase !== 'docked'} aria-label="和狗狗握手" aria-expanded="false"
        onPointerDown={e => {
          if (!e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onClick={() => handshake.current()}>
        <span className="pet-sprite" ref={spriteRef} aria-hidden="true" />
      </button>
    </div>
    {chasing && createPortal(<span ref={boneRef} className="pet-held-bone" hidden aria-hidden="true">
      <Bone size={25} strokeWidth={1.8} />
    </span>, document.body)}
  </>;
}
