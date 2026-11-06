import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPetMotion, requestPetHandshake, stepPetMotion,
  type PetMotionInput, type PetMotionState,
} from '../src/lib/pet-motion';

const patrol: PetMotionInput = { trackLength: 276, targetX: null, chasing: false, reducedMotion: false };

function simulate(start: PetMotionState, input: PetMotionInput, ms: number, interval = 10) {
  const samples: PetMotionState[] = [];
  let pet = start;
  for (let elapsed = 0; elapsed < ms; elapsed += interval) {
    pet = stepPetMotion(pet, Math.min(interval, ms - elapsed), input);
    samples.push(pet);
  }
  return samples;
}

test('the four paw frames advance with distance and a continuous turn reverses patrol at each edge', () => {
  const samples = simulate(createPetMotion(), patrol, 15000);
  const walk = samples.filter(pet => pet.pose === 'walk');
  assert.equal(new Set(walk.map(pet => pet.frame)).size, 4);
  assert.ok(samples.every(pet => pet.x >= 0 && pet.x <= patrol.trackLength));

  for (const [edge, direction] of [[patrol.trackLength, -1], [0, 1]] as const) {
    const turnAt = samples.findIndex((pet, i) => i > 0 && pet.facing === direction && samples[i - 1].facing !== direction);
    assert.ok(turnAt > 0);
    assert.equal(samples[turnAt].pose, 'turn');
    assert.ok(Math.abs(samples[turnAt].x - edge) < 0.2);
    assert.ok(Math.abs(samples[turnAt + 30].x - edge) >= 6, 'already walking away after 300 ms');
    const local = samples.slice(turnAt - 20, turnAt + 20);
    let greatestStep = 0;
    let stillTime = 0;
    for (let i = 1; i < local.length; i++) {
      const dx = Math.abs(local[i].x - local[i - 1].x);
      greatestStep = Math.max(greatestStep, dx);
      if (dx < 0.001) stillTime += 10;
    }
    assert.ok(greatestStep < 0.6, 'no positional jump at 100 Hz');
    assert.ok(stillTime <= 30, 'no stationary dwell at the endpoint');
  }
});

test('chase accelerates, turns through a front-facing pose and settles near a clamped target', () => {
  const chase = { ...patrol, chasing: true, targetX: 1200 };
  const outgoing = simulate(createPetMotion(12), chase, 660);
  assert.ok(outgoing[0].speed < outgoing[10].speed);
  const last = outgoing.at(-1)!;
  assert.ok(last.x > 45 && last.x < patrol.trackLength);
  const returning = simulate(last, { ...chase, targetX: -500 }, 2500);
  assert.ok(returning.some(pet => pet.pose === 'turn'));
  assert.ok(returning.some(pet => pet.facing === -1 && pet.x < last.x));
  assert.ok(returning.every(pet => pet.x >= 0 && pet.x <= patrol.trackLength));
  const arrived = returning.at(-1)!;
  assert.equal(arrived.pose, 'wag');
  assert.ok(arrived.x <= 1.5);
  for (const noise of [3, -3, 4, -1]) {
    const resting = stepPetMotion(arrived, 250, { ...chase, targetX: arrived.x + noise });
    assert.equal(resting.x, arrived.x);
    assert.equal(resting.facing, arrived.facing);
    assert.equal(resting.pose, 'wag');
  }
});

test('handshake stays anchored, lifts and offers the paw twice, then obeys the current bone mode', () => {
  const chase = { ...patrol, chasing: true, targetX: 230 };
  const walking = stepPetMotion(createPetMotion(45), 80, patrol);
  const start = requestPetHandshake(walking);
  assert.notEqual(start, walking);
  assert.equal(walking.handshakeMs, null);
  const frames = simulate(start, chase, 2100);
  const poses = frames.map(pet => pet.pose).filter((pose, i, list) => i === 0 || pose !== list[i - 1]);
  assert.deepEqual(poses, ['crouch', 'sit', 'lift', 'paw', 'lift', 'paw', 'lift', 'sit', 'crouch', 'stand']);
  assert.ok(frames.every(pet => pet.x === start.x));
  assert.equal(requestPetHandshake(frames[70]), frames[70], 'a repeated click does not restart the offer');
  const chasing = stepPetMotion(frames.at(-1)!, 350, chase);
  assert.equal(chasing.handshakeMs, null);
  assert.ok(chasing.x > start.x);
  const backOnPatrol = stepPetMotion(frames.at(-1)!, 900, patrol);
  assert.equal(backOnPatrol.speed, 48);
  assert.ok(chasing.speed > backOnPatrol.speed);
});

test('reduced motion has a static patrol, limited paw poses and direct user-controlled bone movement', () => {
  const quiet = { ...patrol, reducedMotion: true };
  let pet = stepPetMotion(createPetMotion(80), 1500, quiet);
  assert.equal(pet.x, 80);
  assert.equal(pet.pose, 'stand');
  const poses = simulate(requestPetHandshake(pet), quiet, 2300).map(pet => pet.pose);
  assert.deepEqual([...new Set(poses)], ['sit', 'paw', 'stand']);
  pet = stepPetMotion(pet, 0, { ...quiet, chasing: true, targetX: -20 });
  assert.equal(pet.x, 0);
  assert.equal(pet.facing, -1);
  assert.equal(pet.pose, 'stand');
});

test('layout changes keep the dog inside the lane even during a turn or handshake', () => {
  const nearEdge = createPetMotion(270);
  const turning = simulate(nearEdge, patrol, 800).find(pet => pet.turn)!;
  assert.ok(turning.turn);
  const narrow = { ...patrol, trackLength: 20 };
  const samples = simulate(turning, narrow, 300);
  assert.ok(samples.every(pet => Number.isFinite(pet.x) && pet.x >= 0 && pet.x <= 20));
  const sitting = stepPetMotion(requestPetHandshake(nearEdge), 100, narrow);
  assert.equal(sitting.x, 20);
  const tiny = stepPetMotion(nearEdge, 1000, { ...patrol, trackLength: -1 });
  assert.equal(tiny.x, 0);
  assert.equal(tiny.pose, 'stand');
});
