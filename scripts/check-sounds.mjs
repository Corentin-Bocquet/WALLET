/**
 * Compare les sons optimisés à leur version d'origine (dans git).
 *
 * Vérifie ce qui compte réellement à l'oreille : la sonie (RMS) et la durée.
 * La crête, elle, baisse mécaniquement quand on filtre des transitoires — ce
 * n'est pas un défaut tant que le niveau perçu est préservé.
 *
 *   usage : node scripts/check-sounds.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Lit un WAV PCM en parcourant ses blocs, sans supposer un en-tête de 44 octets. */
function decode(buffer) {
  let offset = 12;
  let format = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new Error('WAV illisible');

  const bytes = format.bits / 8;
  const frames = Math.floor(data.length / bytes / format.channels);
  const read = {
    16: (o) => data.readInt16LE(o) / 32768,
    24: (o) => {
      const raw = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
      return ((raw & 0x800000) ? raw - 0x1000000 : raw) / 8388608;
    },
    32: (o) => data.readInt32LE(o) / 2147483648,
  }[format.bits];

  // On mesure DEUX références : le mélange des canaux et le premier canal seul.
  // Sur un fichier dont les canaux sont en opposition de phase, le mélange est
  // quasi silencieux alors que le fichier, lui, s'entend très bien — comparer
  // à ce mélange donnerait un verdict absurde.
  let mixSum = 0;
  let firstSum = 0;
  let peak = 0;

  for (let i = 0; i < frames; i += 1) {
    let mix = 0;
    let first = 0;
    for (let c = 0; c < format.channels; c += 1) {
      const value = read((i * format.channels + c) * bytes);
      if (c === 0) first = value;
      mix += value;
    }
    mix /= format.channels;
    mixSum += mix * mix;
    firstSum += first * first;
    peak = Math.max(peak, Math.abs(mix));
  }

  const mixRms = Math.sqrt(mixSum / Math.max(frames, 1));
  const firstRms = Math.sqrt(firstSum / Math.max(frames, 1));

  // Même règle que scripts/optimize-sounds.mjs.
  const cancelled = format.channels > 1 && firstRms > 1e-4 && mixRms < firstRms * 0.6;
  const rms = cancelled ? firstRms : mixRms;

  return {
    rms,
    cancelled,
    peak,
    seconds: frames / format.sampleRate,
    format,
  };
}

let failures = 0;

for (const name of readdirSync('app/sounds').filter((f) => f.endsWith('.wav')).sort()) {
  const current = decode(readFileSync(`app/sounds/${name}`));
  const original = decode(execFileSync('git', ['show', `HEAD:app/sounds/${name}`],
    { maxBuffer: 1e8, encoding: 'buffer' }));

  const loudness = original.rms > 1e-6 ? current.rms / original.rms : 1;
  const duration = current.seconds / Math.max(original.seconds, 0.001);

  // La sonie doit rester dans ±25 %, et la durée ne pas être tronquée.
  const ok = loudness > 0.75 && loudness < 1.3 && duration > 0.85;
  if (!ok) failures += 1;

  console.log(
    `${name.padEnd(18)} sonie ×${loudness.toFixed(2)}  durée ×${duration.toFixed(2)}`
    + `  crête ${current.peak.toFixed(2)}`
    + `${original.cancelled ? '  (canaux en opposition de phase)' : ''}`
    + `  ${ok ? '✓' : '⚠'}`);
}

console.log(failures
  ? `\n⚠ ${failures} son(s) hors tolérance`
  : '\n✅ sonie et durée préservées sur tous les sons');
process.exit(failures ? 1 : 0);
