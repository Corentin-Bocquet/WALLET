/**
 * Génère les icônes PNG et les écrans de lancement iOS depuis une seule source
 * SVG. Aucun outil externe : le PNG est encodé à la main (les icônes sont de
 * l'aplat et quelques formes, la compression zlib de Node suffit largement).
 *
 *   usage : node scripts/build-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'app', 'icons');
mkdirSync(ICONS, { recursive: true });

/* — Palette, alignée sur css/tokens.css ————————————— */
const BG = [0x00, 0x00, 0x00];
const ACCENT = [0xBF, 0xF2, 0x3A];
const ACCENT_SOFT = [0x7C, 0x4D, 0xFF];

/* — Encodeur PNG minimal (RGBA, sans entrelacement) ——— */

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;                       // filtre "None"
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // profondeur
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* — Dessin de l'icône ————————————————————————————————
   Un losange plein (le ◈ de l'application) sur fond noir, avec un liseré
   violet. Rendu par échantillonnage 3×3 pour lisser les diagonales.        */

function drawIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  // Une icône "maskable" doit tenir dans le cercle de sécurité (80 % du côté).
  const scale = maskable ? 0.30 : 0.38;
  const outer = size * scale;
  const inner = outer * 0.62;
  const SS = 3;   // échantillons par axe

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let rAcc = 0, gAcc = 0, bAcc = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const distance = Math.abs(px - center) + Math.abs(py - center);  // losange

          let color = BG;
          if (distance <= inner) color = ACCENT;
          else if (distance <= outer) color = ACCENT_SOFT;

          rAcc += color[0]; gAcc += color[1]; bAcc += color[2];
        }
      }

      const samples = SS * SS;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(rAcc / samples);
      pixels[offset + 1] = Math.round(gAcc / samples);
      pixels[offset + 2] = Math.round(bAcc / samples);
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, size, pixels);
}

/** Écran de lancement iOS : fond noir, losange centré. */
function drawSplash(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) * 0.11;
  const inner = outer * 0.62;
  const SS = 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rAcc = 0, gAcc = 0, bAcc = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const distance = Math.abs(x + (sx + 0.5) / SS - cx) + Math.abs(y + (sy + 0.5) / SS - cy);
          let color = BG;
          if (distance <= inner) color = ACCENT;
          else if (distance <= outer) color = ACCENT_SOFT;
          rAcc += color[0]; gAcc += color[1]; bAcc += color[2];
        }
      }
      const samples = SS * SS;
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.round(rAcc / samples);
      pixels[offset + 1] = Math.round(gAcc / samples);
      pixels[offset + 2] = Math.round(bAcc / samples);
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(width, height, pixels);
}

/* — Source vectorielle ————————————————————————————— */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="WALLET">
  <rect width="512" height="512" fill="#000000"/>
  <path d="M256 62 450 256 256 450 62 256Z" fill="#7C4DFF"/>
  <path d="M256 134 378 256 256 378 134 256Z" fill="#BFF23A"/>
</svg>
`;

writeFileSync(join(ICONS, 'icon.svg'), SVG);

for (const size of [180, 192, 512]) {
  writeFileSync(join(ICONS, `icon-${size}.png`), drawIcon(size));
}
for (const size of [192, 512]) {
  writeFileSync(join(ICONS, `icon-maskable-${size}.png`), drawIcon(size, { maskable: true }));
}

// Tailles couvrant les iPhone récents (points × densité).
const SPLASHES = [
  [1179, 2556, 'iphone-15'],
  [1290, 2796, 'iphone-15-pro-max'],
  [1170, 2532, 'iphone-13'],
  [1125, 2436, 'iphone-x'],
  [828, 1792, 'iphone-xr'],
];
for (const [width, height, name] of SPLASHES) {
  writeFileSync(join(ICONS, `splash-${name}.png`), drawSplash(width, height));
}

console.log(`icônes générées : ${[180, 192, 512].length + 2} PNG + ${SPLASHES.length} écrans de lancement + 1 SVG`);
