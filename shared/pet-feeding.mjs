export const FEED_DURATION_MS = 4200;

const OFFER_END_MS = 360;
const CHEW_END_MS = 3300;
const HAPPY_START_MS = FEED_DURATION_MS - 600;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function createPetFeeding(food) {
  return food === 'kibble' || food === 'stick' ? { food, elapsedMs: 0 } : null;
}

export function stepPetFeeding(state, deltaMs) {
  if (!state || (state.food !== 'kibble' && state.food !== 'stick')) return null;
  const elapsedMs = Math.max(0, finite(state.elapsedMs)) + Math.max(0, finite(deltaMs));
  return elapsedMs >= FEED_DURATION_MS ? null : { food: state.food, elapsedMs };
}

export function petFeedingFrame(state, reducedMotion = false) {
  const time = clamp(finite(state.elapsedMs), 0, FEED_DURATION_MS);
  const stage = time < OFFER_END_MS ? 'offer' : time < HAPPY_START_MS ? 'eat' : 'happy';
  let frame;
  if (reducedMotion) frame = stage === 'offer' ? 1 : stage === 'eat' ? 3 : 7;
  else if (time < 140) frame = 0;
  else if (time < OFFER_END_MS) frame = 1;
  else if (time < CHEW_END_MS) frame = 2 + Math.floor((time - OFFER_END_MS) / 140) % 3;
  else if (time < 3500) frame = 5;
  else if (time < HAPPY_START_MS) frame = 6;
  else frame = 7;
  return {
    frame: frame + (state.food === 'stick' ? 8 : 0), stage,
    portion: clamp((CHEW_END_MS - time) / (CHEW_END_MS - OFFER_END_MS), 0, 1),
  };
}

// All coordinates use the same local CSS-pixel space. Prefer the free side of
// the dog, keeping the entire menu inside a normal widget or display surface.
export function petFeedingMenuRect(anchor, bounds) {
  const width = 104, height = 52, gap = 4;
  const left = finite(bounds.x), top = finite(bounds.y);
  const right = left + Math.max(0, finite(bounds.width));
  const bottom = top + Math.max(0, finite(bounds.height));
  const dogLeft = finite(anchor.x), dogTop = finite(anchor.y);
  const dogWidth = Math.max(0, finite(anchor.width));
  const dogHeight = Math.max(0, finite(anchor.height));
  const proposedX = dogLeft + dogWidth + gap;
  const x = proposedX + width <= right ? proposedX : dogLeft - width - gap;
  return {
    x: clamp(x, left, Math.max(left, right - width)),
    y: clamp(dogTop + (dogHeight - height) / 2, top, Math.max(top, bottom - height)),
    width, height,
  };
}
