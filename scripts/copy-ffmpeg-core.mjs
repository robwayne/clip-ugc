// Copies the single-threaded ffmpeg.wasm core into /public/ffmpeg so the app
// can load it from its own origin. Serving the core same-origin avoids CORS /
// CORP problems and lets the app work without a CDN at runtime.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const destDir = join(root, 'public', 'ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(srcDir)) {
  console.warn(
    '[copy-ffmpeg-core] @ffmpeg/core not installed yet; skipping copy. ' +
      'Run `npm install` then rebuild.'
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const from = join(srcDir, file);
  const to = join(destDir, file);
  if (!existsSync(from)) {
    console.warn(`[copy-ffmpeg-core] missing ${from}; skipping.`);
    continue;
  }
  copyFileSync(from, to);
  console.log(`[copy-ffmpeg-core] copied ${file}`);
}
