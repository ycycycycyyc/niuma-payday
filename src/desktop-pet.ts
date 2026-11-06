import actions from './assets/widget-dog-actions.webp';
import walk from './assets/widget-dog-walk.webp';
import type { PetPose } from './lib/pet-motion';
import './desktop-pet.css';

type Point = { x: number; y: number };
type Dog = Point & { size: number; facing: -1 | 1; frame: number; pose: PetPose; vx: number; vy: number };
type Frame = { dog: Dog | null; bone: Point | null; sampleTime: number; handoff?: boolean };
type Sample = { dog: Dog; time: number };

declare global {
  interface Window {
    petOverlay?: {
      onFrame(listener: (frame: Frame) => void): () => void;
      firstFramePainted(): void;
    };
  }
}

const sprite = document.getElementById('desktop-dog')!;
const cursorBone = document.getElementById('desktop-bone')!;
const artworkReady = Promise.all([walk, actions].map(src => {
  const image = new Image();
  image.src = src;
  return image.decode();
})).then(() => true, () => false);

// Keep most of one mouse sample in reserve. The sprite can then follow each
// display refresh even when the native cursor timer fires between refreshes.
const BUFFER_MS = 20;
const MAX_PREDICTION_MS = 28;
let samples: Sample[] = [];
let clockOffset = 0;
let raf = 0;
let handoffSerial = 0;

function paint(dog: Dog, x: number, y: number) {
  if (sprite.dataset.pose !== dog.pose || sprite.dataset.frame !== String(dog.frame)) {
    sprite.dataset.pose = dog.pose;
    sprite.dataset.frame = String(dog.frame);
    sprite.style.backgroundPositionX = `${100 * dog.frame / (dog.pose === 'walk' ? 3 : 6)}%`;
  }
  const size = `${dog.size}px`;
  if (sprite.style.width !== size) sprite.style.width = sprite.style.height = size;
  sprite.dataset.facing = String(dog.facing);
  sprite.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${dog.facing})`;
  sprite.hidden = false;
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

window.petOverlay?.onFrame(({ dog, bone, sampleTime, handoff }) => {
  cursorBone.hidden = bone === null;
  if (bone) cursorBone.style.transform = `translate3d(${bone.x}px, ${bone.y}px, 0)`;
  if (!dog) {
    handoffSerial++;
    clearPath();
    sprite.hidden = true;
    return;
  }
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
  if (dog.pose !== 'walk') {
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
