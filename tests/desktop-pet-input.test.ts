import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createCompanionMotion } from '../shared/desktop-pet-companion.mjs';

// Load the actual native controller with a screen fixture, without opening any
// windows or moving the system cursor. Renderer-only clicks bypass this layer.
const bounds = { x: -2000, y: -1200, width: 4000, height: 2400 };
const hostURL = 'data:text/javascript,' + encodeURIComponent(`
  export class BrowserWindow {}
  export const screen = { getDisplayNearestPoint: () => ({ workArea: ${JSON.stringify(bounds)} }) };
`);
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'electron' ? { url: hostURL, shortCircuit: true } : next(specifier, context);
  },
});
const { DesktopPet } = await import('../electron/desktop-pet.mjs');
hook.deregister();

function companion(size = 76) {
  const pet = new DesktopPet({ getWidget: () => null });
  pet.state = { phase: 'companion' };
  pet.trip = { size, pet: { x: -500, y: 200 }, holdUntil: 0 };
  const input: boolean[] = [];
  const surface = {
    shown: true, acceptsMouse: false,
    win: {
      isDestroyed: () => false,
      getBounds: () => bounds,
      setIgnoreMouseEvents: (value: boolean) => { input.push(value); },
    },
  };
  pet.surfaces.set(1, surface);
  return { pet, surface, input };
}

test('native input accepts feet and the whole painted button at different scales and negative screen coordinates', () => {
  for (const size of [48, 76, 114]) {
    const { pet, surface } = companion(size);
    for (const [label, dx, dy] of [
      ['center', 0, 0], ['feet', 0, .48],
      ['left toes', -.3, .46], ['right toes', .3, .46],
      ['left edge', -.48, 0], ['right edge', .48, 0],
      ['upper corner', -.48, -.48],
    ] as const) {
      const cursor = { x: -500 + dx * size, y: 200 + dy * size };
      assert.equal(pet.hitsCompanion(cursor), true, `${label} at size ${size} must pause movement`);
      pet.syncPetMouseRegion(cursor);
      assert.equal(surface.acceptsMouse, true, `${label} at size ${size} must receive both clicks`);
    }
    for (const cursor of [{ x: -500 - .51 * size, y: 200 }, { x: -500, y: 200 + .51 * size }]) {
      assert.equal(pet.hitsCompanion(cursor), false);
      pet.syncPetMouseRegion(cursor);
      assert.equal(surface.acceptsMouse, false, 'the surrounding desktop stays click-through');
    }
  }
});

test('click-through is restored when the dog stops owning input or its surface is hidden', () => {
  const { pet, surface, input } = companion();
  const cursor = { x: -500, y: 200 };
  for (const phase of ['chasing', 'returning', 'docked']) {
    pet.state = { phase: 'companion' };
    pet.syncPetMouseRegion(cursor);
    pet.state = { phase };
    pet.syncPetMouseRegion(cursor);
    assert.equal(surface.acceptsMouse, false, `${phase} must release mouse input`);
  }
  pet.state = { phase: 'companion' };
  pet.syncPetMouseRegion(cursor);
  surface.shown = false;
  pet.syncPetMouseRegion(cursor);
  assert.equal(surface.acceptsMouse, false);
  assert.equal(input.at(-1), true);
});

test('hovering the grounded feet holds a walking dog still for a double-click', () => {
  const { pet } = companion();
  pet.trip.pet = createCompanionMotion({ x: -500, y: 200, facing: 1, pose: 'walk', frame: 2 }, bounds, 76);
  const start = { x: pet.trip.pet.x, y: pet.trip.pet.y };
  pet.trip.lastTime = performance.now() - 100;
  pet.paint = () => {};
  pet.tickCompanion({ x: start.x, y: start.y + .48 * 76 });
  assert.deepEqual({ x: pet.trip.pet.x, y: pet.trip.pet.y }, start);
});
