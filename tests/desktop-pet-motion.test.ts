import assert from 'node:assert/strict';
import test from 'node:test';
import { acrossDesktopGap, BONE_SIZE, clampPetCenter, createDesktopPetMotion, normalizePetLaunchPose, placeChaseBone, stepDesktopPetMotion } from '../shared/desktop-pet-motion.mjs';

test('takeoff starts on the exact ledge sprite frame and retains the fractional step and sideways velocity', () => {
  const origin = { x: 110, y: 40, facing: -1 };
  const launchPose = { pose: 'walk', frame: 2, stepPhase: 2.65, speed: 48 };
  const pet = createDesktopPetMotion({ ...origin, launchPose });
  assert.deepEqual([pet.x, pet.y, pet.pose, pet.frame, pet.stepPhase, pet.vx], [110, 40, 'walk', 2, 2.65, -48]);
  const next = stepDesktopPetMotion(pet, { x: -300, y: 40 }, 8);
  assert.equal(next.frame, 2);
  assert.ok(next.stepPhase > 2.65 && next.x < 110);

  for (const [frame, pose] of ['stand', 'turn', 'crouch', 'sit', 'lift', 'paw', 'wag'].entries()) {
    const action = createDesktopPetMotion({ ...origin, launchPose: { ...launchPose, frame, pose, speed: 0 } });
    assert.deepEqual([action.pose, action.frame, action.stepPhase], [pose, frame, 2.65]);
  }
  for (const invalid of [undefined, { ...launchPose, frame: 3 }, { ...launchPose, stepPhase: NaN },
    { ...launchPose, pose: 'paw' }, { ...launchPose, speed: Infinity }]) {
    assert.equal(normalizePetLaunchPose(invalid), undefined);
  }
});

test('a short chase shows steps near takeoff and a long chase limits the paw cadence', () => {
  let pet = createDesktopPetMotion({ x: 0, y: 0 });
  const frames = new Set<number>();
  for (let t = 0; t < 600; t += 8) {
    pet = stepDesktopPetMotion(pet, { x: 35, y: 0 }, 8);
    if (pet.pose === 'walk') frames.add(pet.frame);
    if (t === 128) assert.ok(frames.size >= 2, 'the paws already changed near the card');
  }
  assert.deepEqual(frames, new Set([0, 1, 2, 3]));
  assert.equal(pet.pose, 'wag');

  pet = createDesktopPetMotion({ x: 0, y: 0 });
  let steps = 0;
  for (let i = 0; i < 125; i++) {
    const next = stepDesktopPetMotion(pet, { x: 5000, y: 0 }, 8);
    steps += (next.stepPhase - pet.stepPhase + 4) % 4;
    pet = next;
  }
  assert.ok(steps > 12 && steps <= 16, 'the running cycle stays legible for a full second');
});

test('the pet accelerates into a diagonal desktop chase, reaches the bone and settles without overshooting', () => {
  const origin = { x: -880, y: -210 };
  const target = { x: 720, y: 990 };
  const frames = new Set<number>();
  let pet = createDesktopPetMotion(origin);
  const first = stepDesktopPetMotion(pet, target, 16);
  assert.ok(first.x > origin.x && first.x < origin.x + 1);
  for (let i = 0; i < 320; i++) {
    const next = stepDesktopPetMotion(pet, target, 16);
    assert.ok(next.x >= pet.x && next.x <= target.x);
    assert.ok(next.y >= pet.y && next.y <= target.y);
    if (next.pose === 'walk') frames.add(next.frame);
    pet = next;
  }
  assert.deepEqual([pet.x, pet.y, pet.pose, pet.arrived], [target.x, target.y, 'wag', true]);
  assert.deepEqual(frames, new Set([0, 1, 2, 3]));
  const jitter = stepDesktopPetMotion(pet, { x: target.x - 3, y: target.y + 2 }, 33);
  assert.deepEqual([jitter.x, jitter.y, jitter.facing], [pet.x, pet.y, pet.facing]);
});

test('putting the bone away runs from the current position and a moving widget changes the landing spot', () => {
  let pet = createDesktopPetMotion({ x: 300, y: 400 });
  for (let i = 0; i < 45; i++) pet = stepDesktopPetMotion(pet, { x: 1050, y: 930 }, 16);
  const firstHome = { x: 300, y: 400 };
  const previous = pet;
  pet = stepDesktopPetMotion(pet, firstHome, 16, { returning: true });
  assert.ok(Math.hypot(pet.x - previous.x, pet.y - previous.y) < 11);
  for (let i = 0; i < 25; i++) pet = stepDesktopPetMotion(pet, firstHome, 16, { returning: true });
  assert.equal(pet.facing, -1);
  const newHome = { x: -100, y: 500 };
  for (let i = 0; i < 180; i++) pet = stepDesktopPetMotion(pet, newHome, 16, { returning: true });
  assert.deepEqual([pet.x, pet.y, pet.pose, pet.arrived], [newHome.x, newHome.y, 'stand', true]);
});

test('clock gaps are bounded, and reduced motion uses a stationary pose at the requested destination', () => {
  const start = createDesktopPetMotion({ x: 40, y: -500, facing: -1 });
  const target = { x: 40, y: 1100 };
  const wake = stepDesktopPetMotion(start, target, 10_000);
  assert.ok(wake.y < start.y + 40);
  assert.equal(wake.facing, -1, 'vertical movement preserves the facing direction');
  const quiet = stepDesktopPetMotion(wake, target, 16, { reducedMotion: true });
  assert.deepEqual([quiet.x, quiet.y, quiet.frame, quiet.pose], [target.x, target.y, 0, 'stand']);
});

test('display corners respect sprite size, negative origins, and screens smaller than the sprite', () => {
  const left = { x: -1280, y: -60, width: 1280, height: 720 };
  assert.deepEqual(clampPetCenter({ x: -1300, y: 660 }, left, 68), { x: -1246, y: 626 });
  assert.deepEqual(clampPetCenter({ x: 10, y: 20 }, { x: 0, y: 0, width: 30, height: 40 }, 68), { x: 15, y: 20 });
});

test('the sitting paws reach the drawn bone across edge flips and sprite scales', () => {
  const area = { x: -1000, y: -500, width: 800, height: 600 };
  for (const size of [54, 76, 114]) {
    for (const pointer of [{ x: -500, y: -250 }, { x: -238, y: 63 }, { x: -237, y: 64 },
      { x: -1000, y: -500 }, { x: -201, y: 99 }]) {
      const { position, target } = placeChaseBone(pointer, area, size);
      const center = { x: position.x + BONE_SIZE / 2, y: position.y + BONE_SIZE / 2 };
      assert.equal(center.x, target.x);
      assert.ok(Math.abs(center.y - (target.y + size * 0.34)) < 0.001);
      assert.deepEqual(clampPetCenter(target, area, size), target);
      assert.deepEqual(clampPetCenter(center, area, BONE_SIZE), center);
    }
  }
  const before = placeChaseBone({ x: -238, y: 63 }, area, 76);
  const after = placeChaseBone({ x: -237, y: 64 }, area, 76);
  assert.ok(before.target.x - after.target.x > 5 && before.target.y - after.target.y > 5,
    'a one-pixel mouse move can put the bone on the other side');
  const sitting = stepDesktopPetMotion(createDesktopPetMotion(before.target), before.target, 16);
  assert.equal(sitting.pose, 'wag');
  assert.equal(stepDesktopPetMotion(sitting, after.target, 16).pose, 'walk');
});

test('a dog crossing an offset desktop skips only the gap and reappears on the first screen in her path', () => {
  const screens = [
    { x: -800, y: -400, width: 800, height: 400 },
    { x: 0, y: 0, width: 600, height: 400 },
    { x: 600, y: 0, width: 400, height: 600 },
  ];
  const onScreen = { x: -100, y: -60 };
  const far = { x: 800, y: 100 };
  assert.deepEqual(acrossDesktopGap(onScreen, far, screens), onScreen);
  assert.deepEqual(acrossDesktopGap({ x: 200, y: -100 }, far, screens), { x: 500, y: 0 });
  assert.deepEqual(acrossDesktopGap({ x: 250, y: -50 }, { x: 500, y: -50 }, screens), { x: 250, y: 0 });
  assert.deepEqual(acrossDesktopGap(far, onScreen, []), far);
});
