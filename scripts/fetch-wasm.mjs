import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(root, 'public/wasm/fx-term.wasm');
const vendor = resolve(root, 'node_modules/libfx/fx-term.wasm');
const source =
  process.env.FX_TERM_WASM_URL ??
  'https://fx.sh/_next/static/immutable/media/fx-term.0siu-9_d5bzt9.wasm';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(dirname(dest), { recursive: true });

if (!(await exists(dest))) {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`failed to download fx-term.wasm: ${response.status} ${response.statusText}`);
  }
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

if (await exists(resolve(root, 'node_modules/libfx'))) {
  await copyFile(dest, vendor);
}

const info = await stat(dest);
console.log(`fx-term.wasm ready (${Math.round(info.size / 1024)} KiB)`);
