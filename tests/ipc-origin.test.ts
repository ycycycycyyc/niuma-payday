import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createEntryPolicy, isTrustedIpc } from '../shared/ipc-origin.mjs';

const entry = String.raw`C:\Users\ADMINI~1\AppData\Local\Temp\工资 #100%\resources\app.asar\dist\index.html`;
const longEntry = entry.replace('ADMINI~1', 'Administrator');
const entryURL = pathToFileURL(entry, { windows: true }).href;
const longURL = pathToFileURL(longEntry, { windows: true }).href;
const policy = createEntryPolicy(entry, {
  platform: 'win32',
  realpath: (container: string) => {
    if (!container.toLowerCase().endsWith('\\app.asar')) throw new Error('not a real file');
    return container.replace(/ADMINI~1/i, 'Administrator');
  },
});
const owned = new Map([[11, 'main'], [12, 'widget']]);
const current = { processId: 7, routingId: 123, frameTreeNodeId: 44, parent: null, detached: false, url: entryURL };
const sender = { id: 11, mainFrame: current, isDestroyed: () => false };

test('same current Electron frame with distinct JS wrappers is accepted; strict object identity rejected it', () => {
  const event = { sender, senderFrame: { ...current } };
  assert.notStrictEqual(event.senderFrame, sender.mainFrame);
  assert.equal(isTrustedIpc(event, owned, policy), true);
});

test('portable archive permits short/long TEMP names, percent-encoded Chinese, spaces, %, # and disk-letter case', () => {
  const candidate = longURL.replace('/C:/', '/c:/').replace(/%[0-9A-F]{2}/g, match => match.toLowerCase());
  assert.notEqual(new URL(candidate).pathname, new URL(entryURL).pathname);
  assert.equal(policy(candidate, 'main'), true);
  assert.equal(policy(candidate + '#/widget', 'widget'), true);
});

test('other files, sibling archives, network paths, injected routes and encoded separators are rejected', () => {
  for (const url of [entryURL.replace('index.html', 'other.html'), entryURL.replace('/resources/', '/other/'),
    entryURL.replace('app.asar', 'evil.asar'), entryURL.replace('file:///', 'file://elsewhere/'),
    entryURL + '?debug=1', entryURL + '#/unknown', entryURL.replace('/dist/', '/dist%2f'),
    'data:text/html,hello', 'https://example.com/', 'about:blank']) assert.equal(policy(url, 'main'), false, url);
  assert.equal(policy(entryURL + '#/widget', 'main'), false);
  assert.equal(policy(entryURL, 'widget'), false);
});

test('destroyed, detached, rogue, child and stale-document IPC remain denied', () => {
  for (const event of [
    { sender: { ...sender, id: 45 }, senderFrame: current },
    { sender: { ...sender, isDestroyed: () => true }, senderFrame: current },
    { sender, senderFrame: null }, { sender, senderFrame: { ...current, detached: true } },
    { sender, senderFrame: { ...current, parent: current } },
    { sender, senderFrame: { ...current, processId: 8 } }, { sender, senderFrame: { ...current, routingId: 124 } },
    { sender, senderFrame: { ...current, frameTreeNodeId: 45 } },
    { sender, senderFrame: { ...current, url: 'about:blank' } },
    { sender: { ...sender, mainFrame: { ...current, url: 'about:blank' } }, senderFrame: current },
  ]) assert.equal(isTrustedIpc(event, owned, policy), false);
});

test('macOS preserves case; development permits only the exact document on its loopback origin', () => {
  const mac = createEntryPolicy('/Applications/牛马.app/Contents/Resources/app.asar/dist/index.html', { platform: 'darwin', realpath: (value: string) => value });
  const url = 'file:///Applications/牛马.app/Contents/Resources/app.asar/dist/index.html';
  assert.equal(mac(url, 'main'), true);
  assert.equal(mac(url.replace('/dist/', '/DIST/'), 'main'), false);
  const dev = createEntryPolicy(entry, { platform: 'win32', developmentURL: 'http://127.0.0.1:5173' });
  assert.equal(dev('http://127.0.0.1:5173/#/widget', 'widget'), true);
  assert.equal(dev('http://127.0.0.1:5174/', 'main'), false);
  assert.equal(dev('http://127.0.0.1:5173/other', 'main'), false);
  assert.equal(dev('http://user@127.0.0.1:5173/', 'main'), false);
});
