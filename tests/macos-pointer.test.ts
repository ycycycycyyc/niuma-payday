import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual JXA fixture's event sequence without moving this host's
// cursor. Native ownership is verified separately on macOS WindowServer.
const source = fs.readFileSync(new URL('./macos/quartz-pointer.js', import.meta.url), 'utf8');

function fixture(access = true) {
  let elapsed = 0;
  const events: { type: number; x: number; y: number; clicks: number; at: number }[] = [];
  const target = { x: 400, y: 500, capturedAt: Date.now(), destination: { x: 510, y: 425 } };
  const context = vm.createContext({
    Date, JSON, Number, Error,
    ObjC: { import() {}, unwrap: (value: string) => value },
    $: {
      CGPreflightPostEventAccess: () => access,
      CGEventSourceCreate: () => ({}),
      CGEventCreateMouseEvent: (_source: unknown, type: number, point: { x: number; y: number }) => ({ type, ...point, clicks: 0 }),
      CGEventSetIntegerValueField: (event: { clicks: number }, _field: number, clicks: number) => { event.clicks = clicks; },
      CGEventPost: (_tap: number, event: Omit<typeof events[number], 'at'>) => events.push({ ...event, at: elapsed }),
      NSThread: { sleepForTimeInterval: (seconds: number) => { elapsed += seconds * 1000; } },
      NSString: { stringWithContentsOfFileEncodingError: () => JSON.stringify(target) },
    },
  });
  vm.runInContext(source, context);
  return { run: (args: string[]) => vm.runInContext(`run(${JSON.stringify(args)})`, context), events, target };
}

test('Mac regression click posts move and first down with zero intentional wait', () => {
  const fixtureNow = fixture();
  const result = JSON.parse(fixtureNow.run(['click-target-now', 'target.json']));
  assert.equal(result.moveToDownWaitMs, 0);
  assert.deepEqual(fixtureNow.events.map(event => event.type), [5, 1, 2]);
  assert.equal(fixtureNow.events[0].at, fixtureNow.events[1].at);
  assert.deepEqual(fixtureNow.events[1], { type: 1, x: 400, y: 500, clicks: 1, at: 0 });

  const legacy = fixture();
  legacy.run(['click', '400', '500']);
  assert.equal(legacy.events[1].at - legacy.events[0].at, 80, 'Existing slower widget checks keep their old behavior');
});

test('Mac drag posts actual dragged events and double-click uses native click-state counts', () => {
  const drag = fixture();
  drag.run(['drag-target-now', 'target.json']);
  assert.equal(drag.events.filter(event => event.type === 6).length, 8);
  assert.deepEqual(drag.events.at(-1), { type: 2, x: 510, y: 425, clicks: 1, at: 190 });
  assert.equal(drag.events[1].at, 0);

  const double = fixture();
  double.run(['double-click-target-now', 'target.json']);
  assert.deepEqual(double.events.map(event => [event.type, event.clicks]), [[5, 0], [1, 1], [2, 1], [1, 2], [2, 2]]);
});

test('Mac native input fixture refuses missing PostEvent access and stale observed targets', () => {
  assert.throws(() => fixture(false).run(['click-now', '400', '500']), /PostEvent access/);
  const stale = fixture();
  stale.target.capturedAt -= 2000;
  assert.throws(() => stale.run(['click-target-now', 'target.json']), /target is stale/);
  assert.equal(stale.events.length, 0);
});
