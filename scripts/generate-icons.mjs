import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Next.js already installs sharp; use its existing rasterizer, no new dependency.
const sharp = require('sharp');
const mark = await fs.readFile(new URL('../public/brand-mark.svg', import.meta.url));
for (const size of [32, 180, 192, 512]) {
  await sharp(mark).resize(size, size).png().toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname);
}
