import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
// @ts-expect-error A native-only helper is executed directly by tsx.
import { monitorRendererRecovery } from '../electron/renderer-recovery.mjs';

test('a renderer gets one automatic reload, then retains a native recovery state without looping', () => {
  let reloads = 0, pauses = 0, failures = 0;
  const contents = Object.assign(new EventEmitter(), { reload() { reloads++; } });
  const window = { webContents: contents, isDestroyed: () => false };
  const state = monitorRendererRecovery(window, { isQuitting: () => false, beforeRetry() { pauses++; }, failed() { failures++; } });
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(reloads, 1);
  assert.equal(state.failed, false);
  contents.emit('render-process-gone', {}, { reason: 'oom' });
  assert.equal(reloads, 1);
  assert.equal(state.failed, true);
  assert.equal(failures, 1);
  assert.equal(pauses, 2);
});

test('normal teardown never reloads; a failed reload offers recovery immediately', () => {
  const contents = Object.assign(new EventEmitter(), { reload() { throw new Error('renderer unavailable'); } });
  let destroyed = false, quitting = false, failures = 0;
  const state = monitorRendererRecovery({ webContents: contents, isDestroyed: () => destroyed }, {
    isQuitting: () => quitting, beforeRetry() {}, failed() { failures++; },
  });
  contents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  quitting = true;
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  quitting = false; destroyed = true;
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(state.attempted, false);
  destroyed = false;
  contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(state.failed, true);
  assert.equal(failures, 1);
});
