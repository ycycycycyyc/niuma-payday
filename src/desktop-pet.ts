import type { PetFeeding as PetFeedingState, PetFood } from '../shared/pet-feeding.mjs';
import { createPetFeedingView } from './lib/pet-feeding-view';
import { applyPetSprite, loadPetSpriteArtwork } from './lib/pet-sprite';
import './desktop-pet.css';

type Point = { x: number; y: number };
type Dog = Point & {
  size: number; facing: -1 | 1; frame: number; pose: string; vx: number; vy: number;
  interactive?: boolean; feedable?: boolean; reducedMotion?: boolean;
};
type Frame = {
  dog: Dog | null; bone: Point | null; sampleTime: number; handoff?: boolean;
  feeding?: PetFeedingState | null; menuOpen?: boolean;
};
type Sample = { dog: Dog; time: number };

declare global {
  interface Window {
    petOverlay?: {
      onFrame(listener: (frame: Frame) => void): () => void;
      firstFramePainted(): void;
      onPrepare(listener: () => void): void;
      surfaceReady(): void;
      restoreWidget?(): void;
      hold?(): void;
      feed?(food: PetFood): void;
      setReducedMotion?(reduced: boolean): void;
    };
  }
}

const sprite = document.getElementById('desktop-dog') as HTMLButtonElement;
const artworkSprite = document.getElementById('desktop-dog-sprite')!;
const cursorBone = document.getElementById('desktop-bone')!;
let currentFeeding: PetFeedingState | null = null;
let foodMenuOpen = false;
const foodView = createPetFeedingView(document.body, {
  onFeed(food) {
    if (foodMenuOpen && !currentFeeding && sprite.dataset.feedable === 'true') window.petOverlay?.feed?.(food);
  },
  onMenuEnter() {},
  onMenuLeave() {},
});
window.addEventListener('pagehide', () => foodView.destroy(), { once: true });
const artworkReady = loadPetSpriteArtwork();

const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const reportMotionPreference = () => window.petOverlay?.setReducedMotion?.(motionPreference.matches);
reportMotionPreference();
motionPreference.addEventListener('change', reportMotionPreference);

const isInteractive = () => !sprite.hidden && sprite.dataset.interactive === 'true';
function restoreWidget() {
  if (isInteractive()) window.petOverlay?.restoreWidget?.();
}
sprite.addEventListener('pointerdown', event => {
  if (isInteractive() && event.isPrimary && event.button === 0) window.petOverlay?.hold?.();
});
sprite.addEventListener('dblclick', event => {
  event.preventDefault();
  restoreWidget();
});
sprite.addEventListener('keydown', event => {
  if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    restoreWidget();
  }
});

// Keep most of one mouse sample in reserve. The sprite can then follow each
// display refresh even when the native cursor timer fires between refreshes.
const BUFFER_MS = 20;
const MAX_PREDICTION_MS = 28;
let samples: Sample[] = [];
let clockOffset = 0;
let raf = 0;
let handoffSerial = 0;

window.petOverlay?.onPrepare?.(() => {
  // During the native window opening transition even an idle renderer can miss
  // several consecutive refreshes. Keep the walking dog on the card until the
  // new transparent surface has received a short stretch of regular paints.
  let start: number | undefined;
  let last: number | undefined;
  const requestedAt = performance.now();
  let refreshes = 0;
  function check(time: number) {
    refreshes++;
    if (start === undefined || last === undefined || time - last > 55) start = time;
    last = time;
    if (time - start >= 72 || (refreshes >= 4 && time - requestedAt >= 500)) window.petOverlay?.surfaceReady();
    else requestAnimationFrame(check);
  }
  void artworkReady.then(ready => { if (ready) requestAnimationFrame(check); });
});

function paint(dog: Dog, x: number, y: number) {
  const description = applyPetSprite(artworkSprite, { ...dog, grounded: Boolean(dog.interactive) });
  sprite.dataset.pose = dog.pose;
  sprite.dataset.frame = String(dog.frame);
  sprite.dataset.sheet = description.sheet;
  const size = `${dog.size}px`;
  if (sprite.style.width !== size) sprite.style.width = sprite.style.height = size;
  sprite.dataset.facing = String(dog.facing);
  sprite.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  sprite.dataset.feeding = String(Boolean(currentFeeding));
  sprite.hidden = false;
  foodView.render({
    anchor: { x, y, width: dog.size, height: dog.size },
    bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight },
    facing: dog.facing, feeding: currentFeeding, open: foodMenuOpen,
    reducedMotion: Boolean(dog.reducedMotion) || motionPreference.matches,
  });
}

function draw(time: number) {
  raf = 0;
  const playhead = time - clockOffset - BUFFER_MS;
  while (samples.length > 1 && samples[1].time <= playhead) samples.shift();
  const [current, next] = samples;
  if (!current) return;
  const { dog } = current;
  const elapsed = Math.max(0, playhead - current.time);
  if (next) {
    const fraction = elapsed / (next.time - current.time);
    paint(dog, dog.x + (next.dog.x - dog.x) * fraction, dog.y + (next.dog.y - dog.y) * fraction);
  } else {
    // Cover a late packet without running past the last known path on a stall.
    const seconds = Math.min(elapsed, MAX_PREDICTION_MS) / 1000;
    paint(dog, dog.x + dog.vx * seconds, dog.y + dog.vy * seconds);
  }
  if (next || elapsed < MAX_PREDICTION_MS) raf = requestAnimationFrame(draw);
}

function clearPath() {
  cancelAnimationFrame(raf);
  raf = 0;
  samples = [];
}

window.petOverlay?.onFrame(({ dog, bone, sampleTime, handoff, feeding, menuOpen }) => {
  currentFeeding = dog?.feedable ? feeding ?? null : null;
  foodMenuOpen = Boolean(dog?.feedable && menuOpen && !currentFeeding);
  cursorBone.hidden = bone === null;
  if (bone) cursorBone.style.transform = `translate3d(${bone.x}px, ${bone.y}px, 0)`;
  if (!dog) {
    handoffSerial++;
    clearPath();
    sprite.hidden = true;
    sprite.dataset.interactive = 'false';
    sprite.dataset.feedable = 'false';
    sprite.dataset.feeding = 'false';
    sprite.disabled = true;
    sprite.tabIndex = -1;
    foodView.render({
      anchor: { x: 0, y: 0, width: 0, height: 0 },
      bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight },
      facing: 1, feeding: null, open: false, reducedMotion: motionPreference.matches,
    });
    return;
  }
  // Switch hit and keyboard affordances immediately, even when a walking frame
  // is briefly buffered for smooth movement.
  sprite.dataset.interactive = String(Boolean(dog.interactive));
  sprite.dataset.feedable = String(Boolean(dog.feedable));
  sprite.dataset.reducedMotion = String(Boolean(dog.reducedMotion) || motionPreference.matches);
  const acceptsInput = Boolean(dog.interactive || dog.feedable);
  sprite.disabled = !acceptsInput;
  sprite.tabIndex = acceptsInput ? 0 : -1;
  sprite.setAttribute('aria-hidden', String(!acceptsInput));
  sprite.setAttribute('aria-label', dog.interactive ? '双击狗狗恢复浮窗' : '给狗狗喂食');
  if (dog.interactive) sprite.title = '双击狗狗恢复浮窗';
  else sprite.removeAttribute('title');
  if (handoff) {
    clearPath();
    const serial = ++handoffSerial;
    paint(dog, dog.x, dog.y);
    void artworkReady.then(ready => {
      if (!ready || serial !== handoffSerial) return;
      // rAF runs before paint. The second callback lets Chromium composite the
      // decoded starting pose before the card gives up ownership of the dog.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (serial === handoffSerial) window.petOverlay?.firstFramePainted();
      }));
    });
    return;
  }
  if (dog.pose !== 'walk' || currentFeeding || foodMenuOpen) {
    clearPath();
    paint(dog, dog.x, dog.y);
    return;
  }
  const previous = samples.at(-1);
  if (!previous || sampleTime <= previous.time || sampleTime - previous.time > 100 ||
      Math.hypot(dog.x - previous.dog.x, dog.y - previous.dog.y) > 80) {
    // A new display or a long suspension starts a fresh path. Never interpolate
    // through a missing display or replay motion that happened while asleep.
    clearPath();
    clockOffset = performance.now() - sampleTime;
    paint(dog, dog.x, dog.y);
  }
  samples.push({ dog, time: sampleTime });
  if (!raf) raf = requestAnimationFrame(draw);
});
