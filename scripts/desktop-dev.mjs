import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverURL = 'http://127.0.0.1:5173';
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
let desktop;
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  desktop?.kill();
  vite.kill();
  process.exitCode = code;
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('error', (error) => { console.error(error.message); stop(1); });
vite.on('exit', (code) => { if (!stopping) stop(code || 1); });

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(serverURL, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Vite is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready || stopping) throw new Error('The development server did not start on port 5173.');
  const desktopEnvironment = { ...process.env, VITE_DEV_SERVER_URL: serverURL };
  delete desktopEnvironment.ELECTRON_RUN_AS_NODE;
  desktop = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', windowsHide: true, env: desktopEnvironment });
  desktop.on('error', (error) => { console.error(error.message); stop(1); });
  desktop.on('exit', (code) => stop(code || 0));
} catch (error) {
  console.error(error.message);
  stop(1);
}
