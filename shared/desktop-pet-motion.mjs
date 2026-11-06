// Coordinates are the center of the sprite, in Electron's desktop DIP space.
// Keep subpixel positions here even when the drawing layer rounds a frame.
const CHASE_SPEED = 620;
const RETURN_SPEED = 530;
const PAW_STEP = 38;
const ARRIVAL_RADIUS = 1.3;

export function createDesktopPetMotion({ x, y, facing = 1 }) {
  return { x, y, vx: 0, vy: 0, facing: facing < 0 ? -1 : 1,
    stride: 0, frame: 0, pose: 'stand', arrived: false };
}

export function clampPetCenter(point, bounds, size) {
  function axis(value, start, length) {
    const padding = Math.min(size, length) / 2;
    return Math.max(start + padding, Math.min(start + length - padding, value));
  }
  return { x: axis(point.x, bounds.x, bounds.width), y: axis(point.y, bounds.y, bounds.height) };
}

// Clip the segment to the two occupied axis intervals. The earliest entry
// among all screens is where her center next becomes visible.
function entryFraction(point, target, bounds) {
  let entry = 0;
  let exit = 1;
  for (const [axis, length] of [['x', 'width'], ['y', 'height']]) {
    const delta = target[axis] - point[axis];
    const start = bounds[axis] - point[axis];
    const end = start + bounds[length];
    if (delta === 0) {
      if (start > 0 || end < 0) return Infinity;
      continue;
    }
    const a = start / delta;
    const b = end / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return Infinity;
  }
  return entry;
}

export function acrossDesktopGap(point, target, displayBounds) {
  let earliest = Infinity;
  let nearestBounds;
  let nearestDistance = Infinity;
  for (const bounds of displayBounds) {
    const fraction = entryFraction(point, target, bounds);
    if (fraction === 0) return point;
    earliest = Math.min(earliest, fraction);
    const closest = clampPetCenter(target, bounds, 0);
    const distance = Math.hypot(target.x - closest.x, target.y - closest.y);
    if (distance < nearestDistance) { nearestDistance = distance; nearestBounds = bounds; }
  }
  if (Number.isFinite(earliest)) {
    return { x: point.x + earliest * (target.x - point.x), y: point.y + earliest * (target.y - point.y) };
  }
  // A display may have been removed since the last pointer or dock sample.
  return nearestBounds ? clampPetCenter(point, nearestBounds, 0) : point;
}

function settle(pet, point, pose) {
  return { ...pet, x: point.x, y: point.y, vx: 0, vy: 0, pose, frame: 0, arrived: true };
}

function advance(pet, target, seconds, returning) {
  const dx = target.x - pet.x;
  const dy = target.y - pet.y;
  const distance = Math.hypot(dx, dy);
  const restPose = returning ? 'stand' : 'wag';
  // Give the mouse a little play while she waits. The return destination is
  // always exact, including when it changes because the widget moved.
  if (!returning && pet.arrived && distance < 5) return settle(pet, pet, restPose);
  if (distance <= ARRIVAL_RADIUS) return settle(pet, target, restPose);

  const speed = Math.min(returning ? RETURN_SPEED : CHASE_SPEED, distance * 4.5);
  const response = 1 - Math.exp(-seconds / 0.07);
  const vx = pet.vx + (dx / distance * speed - pet.vx) * response;
  const vy = pet.vy + (dy / distance * speed - pet.vy) * response;
  const stepX = (pet.vx + vx) * 0.5 * seconds;
  const stepY = (pet.vy + vy) * 0.5 * seconds;
  // Passing the plane through the goal would reverse the next step and make
  // the dog flicker under the mouse, particularly on a sudden short return.
  if (stepX * dx + stepY * dy >= distance * distance) return settle(pet, target, restPose);

  const stride = (pet.stride + Math.hypot(stepX, stepY)) % (4 * PAW_STEP);
  return { x: pet.x + stepX, y: pet.y + stepY, vx, vy,
    facing: Math.abs(vx) > 14 ? Math.sign(vx) : pet.facing,
    stride, frame: Math.floor(stride / PAW_STEP), pose: 'walk', arrived: false };
}

export function stepDesktopPetMotion(state, target, elapsedMs, { returning = false, reducedMotion = false } = {}) {
  if (reducedMotion) {
    const facing = Math.abs(target.x - state.x) > 5 ? Math.sign(target.x - state.x) : state.facing;
    return settle({ ...state, facing }, target, 'stand');
  }
  // Resume from the current pose after sleep rather than integrating an entire
  // missing second and jumping across the desktop in a single frame.
  let remaining = Number.isFinite(elapsedMs) ? Math.min(64, elapsedMs) : 0;
  let pet = state;
  while (remaining > 0) {
    const step = Math.min(16, remaining);
    pet = advance(pet, target, step / 1000, returning);
    remaining -= step;
  }
  return pet;
}
