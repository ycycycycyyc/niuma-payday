import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = spawn(process.execPath, [path.join(root, 'node_modules/electron/install.js')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, electron_config_cache: path.join(root, '.electron-cache') },
});
installer.on('error', error => { console.error(error.message); process.exitCode = 1; });
installer.on('exit', code => { process.exitCode = code ?? 1; });
