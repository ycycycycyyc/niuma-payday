import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Resolve a packaged app's entry as a filesystem path, not an encoded URL string.
 * The ASAR container is a real file; its internal path is virtual and cannot be
 * resolved by the OS. Resolve the container independently so short/long Windows
 * TEMP paths and filesystem aliases still identify the same archive. */
export function createEntryPolicy(entryFile, { developmentURL, platform = process.platform, realpath = fs.realpathSync.native } = {}) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const normalized = value => {
    let name = paths.normalize(value);
    if (windows) name = name.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').toLowerCase();
    return name;
  };
  const archiveParts = filename => {
    const match = /^(.*?[\\/][^\\/]+\.asar)([\\/].*)?$/i.exec(filename);
    return match ? [match[1], match[2] ?? ''] : [filename, ''];
  };
  const canonical = filename => {
    const [container, inside] = archiveParts(filename);
    try { return normalized(realpath(container) + inside); } catch { return null; }
  };
  const expectedFile = normalized(entryFile);
  const expectedReal = canonical(entryFile);
  const expectedHost = pathToFileURL(entryFile, { windows }).hostname;
  const dev = developmentURL ? new URL(developmentURL) : null;
  return (value, role) => {
    try {
      const candidate = new URL(value);
      if (candidate.username || candidate.password || candidate.search) return false;
      const hash = candidate.hash;
      if (hash !== '' && hash !== '#/widget') return false;
      if (role === 'main' && hash !== '' || role === 'widget' && hash !== '#/widget') return false;
      if (dev) return candidate.origin === dev.origin && (candidate.pathname === '/' || candidate.pathname === '/index.html');
      if (candidate.protocol !== 'file:' || candidate.hostname !== expectedHost) return false;
      const actualFile = fileURLToPath(candidate, { windows });
      if (normalized(actualFile) === expectedFile) return true;
      // Never resolve arbitrary sibling files or a different path inside the archive.
      const [expectedContainer, expectedInside] = archiveParts(entryFile);
      const [actualContainer, actualInside] = archiveParts(actualFile);
      if (normalized(expectedInside) !== normalized(actualInside)
        || normalized(paths.basename(expectedContainer)) !== normalized(paths.basename(actualContainer))) return false;
      return expectedReal !== null && canonical(actualFile) === expectedReal;
    } catch { return false; }
  };
}

/** Electron's native routing IDs prove a frame is the current top-level document.
 * JS object identity is not part of the WebFrameMain contract. */
export function isTrustedIpc(event, owned, allowsURL) {
  try {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed() || !Number.isInteger(sender.id) || sender.id <= 0) return false;
    const role = owned.get(sender.id);
    if (role !== 'main' && role !== 'widget') return false;
    const frame = event.senderFrame;
    const current = sender.mainFrame;
    if (!frame || !current || frame.detached || current.detached || frame.parent !== null) return false;
    // Process + routing ID pin a live RenderFrameHost. The tree node adds a second
    // guard against stale/replaced frames. Do not trust renderer-supplied arguments.
    for (const field of ['processId', 'routingId', 'frameTreeNodeId']) {
      if (!Number.isInteger(frame[field]) || frame[field] < 0 || frame[field] !== current[field]) return false;
    }
    return allowsURL(frame.url, role) && allowsURL(current.url, role);
  } catch { return false; } // A frame may detach between lookup and property access.
}
