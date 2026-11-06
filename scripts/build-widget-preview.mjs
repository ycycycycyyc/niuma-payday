import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'artifacts', 'preview');

// A separate, in-memory build keeps dist/ intact. Library mode embeds images (including
// the companion's sprite sheet) in CSS, and a classic script works directly from file://.
const result = await build({
  configFile: false,
  root,
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    outDir: directory,
    emptyOutDir: false,
    lib: { entry: path.join(root, 'src/widget-preview.tsx'), formats: ['iife'], name: 'NiumaWidgetPreview' },
    minify: true,
    cssCodeSplit: false,
    reportCompressedSize: false,
    sourcemap: false,
  },
});

const output = (Array.isArray(result) ? result.flatMap(item => item.output) : result.output);
const chunks = output.filter(item => item.type === 'chunk');
const styles = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
if (chunks.length !== 1 || styles.length !== 1 || output.length !== 2) {
  throw new Error('The widget preview must contain one script and one stylesheet with all images embedded.');
}
const template = await readFile(path.join(root, 'preview.html'), 'utf8');
const css = String(styles[0].source).replace(/<\/style/gi, '<\\/style');
const js = chunks[0].code.replace(/<\/script/gi, '<\\/script');
const html = template.replace('</head>', () => `<style id="preview-styles">${css}</style>\n</head>`)
  .replace('<script type="module" src="/src/widget-preview.tsx"></script>', () => `<script id="preview-bundle">${js}</script>`);
const destination = path.join(directory, 'Niuma-Glass-Preview.html');
await mkdir(directory, { recursive: true });
await writeFile(destination, html);
console.log(`Offline preview: ${destination} (${Math.ceil(Buffer.byteLength(html) / 1024)} KiB)`);
