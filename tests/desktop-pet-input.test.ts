import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createCompanionMotion } from '../shared/desktop-pet-companion.mjs';

// Load the actual native controller with a screen fixture, without opening any
// windows or moving the system cursor. Renderer-only clicks bypass this layer.
const bounds = { x: -2000, y: -1200, width: 4000, height: 2400 };
const hostURL = 'data:text/javascript,' + encodeURIComponent(`
  export class BrowserWindow {}
  export let cursor = { x: -500, y: 200 };
  export const moveCursor = point => { cursor = point; };
  export const screen = { getDisplayNearestPoint: () => ({ workArea: ${JSON.stringify(bounds)} }),
    getCursorScreenPoint: () => cursor };
`);
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'electron' ? { url: hostURL, shortCircuit: true } : next(specifier, context);
  },
});
const { DesktopPet } = await import('../electron/desktop-pet.mjs');
const { moveCursor, screen } = await import(hostURL);
hook.deregister();

function companion(size = 76) {
  const pet = new DesktopPet({ getWidget: () => null });
  pet.state = { phase: 'companion' };
  pet.trip = { size, pet: { x: -500, y: 200 }, ready: true };
  const input: boolean[] = [];
  const surface = {
    shown: true, acceptsMouse: false,
    win: {
      isDestroyed: () => false,
      getBounds: () => bounds,
      getContentBounds: () => bounds,
      webContents: { mainFrame: { processId: 7, routingId: 8 } },
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
      assert.equal(pet.hitsCompanion(cursor), true, `${label} at size ${size} must accept clicks`);
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

test('hovering or starting a double-click at the feet does not interrupt a walking dog', () => {
  const { pet, surface } = companion();
  pet.trip.pet = createCompanionMotion({ x: -500, y: 200, facing: 1, pose: 'walk', frame: 2 }, bounds, 76);
  const start = { x: pet.trip.pet.x, y: pet.trip.pet.y };
  pet.trip.lastTime = performance.now() - 100;
  pet.paint = () => {};
  pet.setRestoreTarget({ processId: 7, frameId: 8 }, surface, { x: 1462, y: 1362, width: 76, height: 76 });
  pet.tickCompanion({ x: start.x, y: start.y + .48 * 76 });
  assert.ok(pet.trip.pet.x > start.x, 'walking continues while the pointer is over the feet');
  assert.equal(pet.trip.pet.y, start.y);
  assert.ok(pet.trip.pet.vx > 0, 'the next painted frame keeps its walking velocity');
});

test('the first click target keeps accepting a second click as the dog moves, then expires', () => {
  const { pet, surface } = companion();
  pet.setRestoreTarget({ processId: 7, frameId: 8 }, surface, { x: 1462, y: 1362, width: 76, height: 76 });
  const firstClick = { x: -536, y: 200 };
  pet.trip.pet.x += 30;
  assert.equal(pet.hitsCompanion(firstClick), false, 'the walking dog has left the first click');
  pet.syncPetMouseRegion(firstClick);
  assert.equal(surface.acceptsMouse, true, 'the stationary input target receives the second click');
  pet.trip.restoreTarget.until = performance.now() - 1;
  pet.syncPetMouseRegion(firstClick);
  assert.equal(surface.acceptsMouse, false, 'expired input targets release the surrounding desktop');
  assert.equal(pet.trip.restoreTarget, null);
});

test('only an owned companion surface can retain its current dog-sized input target', () => {
  const { pet, surface } = companion();
  const event = { processId: 7, frameId: 8 };
  const rect = { x: 1462, y: 1362, width: 76, height: 76 };
  for (const [sender, target] of [
    [{ ...event, frameId: 9 }, rect],
    [event, { ...rect, width: 2000 }],
    [event, { ...rect, x: 0 }],
    [event, { ...rect, y: NaN }],
  ]) {
    pet.setRestoreTarget(sender, surface, target);
    assert.equal(pet.trip.restoreTarget, undefined);
  }
  pet.setRestoreTarget(event, surface, rect);
  assert.ok(pet.trip.restoreTarget);
  pet.setRestoreTarget(event, surface, null);
  assert.equal(pet.trip.restoreTarget, null);
});

test('a captured companion follows the grab point, releases the desktop and resumes walking at the drop', () => {
  const { pet, surface } = companion();
  pet.trip.pet = createCompanionMotion({ x: -500, y: 200, facing: 1 }, bounds, 76);
  pet.trip.lastTime = performance.now();
  pet.paint = () => {};
  const event = { processId: 7, frameId: 8 };
  const grip = { x: -12, y: -35 };
  moveCursor({ x: -488, y: 235 });
  pet.companionGesture({ ...event, frameId: 99 }, surface, 'press', grip);
  pet.companionGesture(event, surface, 'press', { x: 42, y: 0 });
  assert.equal(pet.trip.press, undefined);

  pet.companionGesture(event, surface, 'press', grip);
  const cursor = { x: 310, y: 510 };
  moveCursor(cursor);
  pet.syncPetMouseRegion(cursor);
  assert.equal(surface.acceptsMouse, true, 'a quick move cannot lose the pointerup');
  pet.companionGesture(event, surface, 'drag');
  const drop = { x: 298, y: 475 };
  const position = () => ({ x: pet.trip.pet.x, y: pet.trip.pet.y });
  assert.deepEqual(position(), drop);
  pet.trip.lastTime = performance.now() - 500;
  pet.tick(cursor);
  assert.deepEqual(position(), drop, 'autonomy is suspended during drag');

  moveCursor({ x: -2000, y: -1200 });
  pet.tick({ x: -2000, y: -1200 });
  assert.deepEqual(position(), { x: -1962, y: -1162 }, 'the full dog remains inside the display work area');
  moveCursor({ x: -500, y: 200 });
  pet.companionGesture(event, surface, 'release', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
  assert.deepEqual(position(), drop);
  assert.equal(pet.trip.press, null);
  pet.syncPetMouseRegion({ x: -500, y: 200 });
  assert.equal(surface.acceptsMouse, false, 'the vacated desktop is click-through');
  for (let frame = 0; frame < 90; frame++) {
    pet.trip.lastTime = performance.now() - 24;
    pet.tick({ x: -500, y: 200 });
  }
  assert.ok(Math.hypot(pet.trip.pet.x - drop.x, pet.trip.pet.y - drop.y) > 5);
  assert.equal(pet.state.phase, 'companion');
});

test('dragging across displays keeps the source capture alive and drops in the destination display DIPs', (t) => {
  const { pet } = companion();
  const displays = [
    { id: 1, workArea: { x: -1000, y: 0, width: 1000, height: 800 } },
    { id: 2, workArea: { x: 0, y: 0, width: 1600, height: 1000 } },
  ];
  pet.displays = displays;
  const surfaces = displays.map(display => {
    const surface = { ready: true, shown: true, acceptsMouse: false,
      win: { isDestroyed: () => false, getBounds: () => display.workArea, getContentBounds: () => display.workArea,
        webContents: { send() {}, mainFrame: { processId: 7, routingId: 8 } }, hide() {}, setIgnoreMouseEvents() {} } };
    pet.surfaces.set(display.id, surface);
    return surface;
  });
  const [source, destination] = surfaces;
  const cursor = { x: 300, y: 400 };
  pet.trip.pet = createCompanionMotion(cursor, displays[1].workArea, 76);
  pet.trip.press = { surface: source, offset: { x: 0, y: 0 }, dragging: true };
  pet.paint(pet.trip.pet, 76, null);
  pet.syncPetMouseRegion(cursor);
  assert.ok(source.shown && source.acceptsMouse, 'source keeps capture until pointerup');
  assert.ok(destination.shown && !destination.acceptsMouse, 'new surface does not steal the press');
  assert.ok(JSON.parse(pet.surfaces.get(1).lastFrame).dog.x > displays[0].workArea.width, 'source sprite is outside the viewport');
  assert.equal(JSON.parse(pet.surfaces.get(2).lastFrame).dog.x, cursor.x - 38);

  // Left monitor at 150%, right monitor at 200%, with their physical edges
  // meeting at x=0. The cursor moves away before the pointerup IPC arrives.
  const drop = { x: 360, y: 450 };
  let local = { x: drop.x + 1000, y: drop.y };
  if (process.platform === 'win32') {
    local = { x: 1000 + drop.x * 2 / 1.5, y: drop.y * 2 / 1.5 };
    screen.dipToScreenRect = (win: unknown, rect: { x: number; y: number }) => {
      assert.equal(win, source.win);
      return { x: rect.x * 1.5, y: rect.y * 1.5 };
    };
    screen.screenToDipPoint = (point: { x: number; y: number }) => ({ x: point.x / 2, y: point.y / 2 });
    t.after(() => { delete screen.dipToScreenRect; delete screen.screenToDipPoint; });
  }
  moveCursor({ x: -500, y: 200 });
  pet.trip.lastTime = performance.now();
  pet.companionGesture({ processId: 7, frameId: 8 }, source, 'release', local);
  assert.deepEqual({ x: pet.trip.pet.x, y: pet.trip.pet.y }, drop);
  assert.equal(source.shown, false);
  assert.equal(source.acceptsMouse, false);
  assert.ok(destination.shown && !destination.acceptsMouse, 'the pointer has already moved away from the drop');
});
