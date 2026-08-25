/**
 * Allège les sons d'interface, sans aucun outil externe.
 *
 * Les sources fournies sont en PCM 16 bits, stéréo, 44,1 kHz. Pour des clics
 * de quelques dizaines de millisecondes joués au haut-parleur d'un téléphone :
 *   · la stéréo n'apporte rien → moyenne des deux canaux ;
 *   · 22,05 kHz couvre tout le spectre utile → décimation 2:1 ;
 *   · le silence de tête retarde le retour au doigt → il est retiré.
 *
 * La décimation 2:1 est précédée d'un filtre passe-bas à moyenne glissante.
 * Sans lui, les fréquences au-dessus de 11 kHz se replieraient dans l'audible
 * et donneraient un son métallique — c'est le repliement de spectre, et il
 * s'entend très bien sur des transitoires courts comme un clic.
 *
 *   usage : node scripts/optimize-sounds.mjs
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'sounds');

/* — Lecture d'un WAV PCM ————————————————————————————— */

function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('ce fichier n’est pas un WAV RIFF');
  }

  let offset = 12;
  let format = null;
  let data = null;

  // On parcourt les blocs plutôt que de supposer un en-tête de 44 octets :
  // beaucoup d'exports insèrent un bloc LIST ou fact avant les données.
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }

    offset = body + size + (size % 2);   // les blocs sont alignés sur 2 octets
  }

  if (!format || !data) throw new Error('blocs fmt ou data introuvables');

  // 0xFFFE = WAVE_FORMAT_EXTENSIBLE : c'est du PCM, simplement décrit avec un
  // en-tête étendu. Certains exports l'utilisent dès qu'on dépasse 16 bits.
  const isPcm = format.audioFormat === 1 || format.audioFormat === 0xFFFE;
  if (!isPcm || ![16, 24, 32].includes(format.bitsPerSample)) {
    throw new Error(`format non géré : ${format.audioFormat}, ${format.bitsPerSample} bits`);
  }
  return { format, data };
}

/* — Traitement ————————————————————————————————————— */

/**
 * Passage en mono.
 *
 * La moyenne des canaux est le choix par défaut, mais elle est piégeuse : si
 * les deux canaux sont en opposition de phase — ce que font certains effets
 * stéréo — la moyenne les annule et le son devient inaudible. C'est arrivé sur
 * l'un des sons fournis, dont la crête est passée de 0,996 à 0,057.
 *
 * On calcule donc les deux versions et on garde la moyenne UNIQUEMENT si elle
 * ne perd pas l'essentiel du niveau.
 */
function toMono(data, channels, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(data.length / bytesPerSample / channels);

  // Lecture normalisée en [-1, 1], quelle que soit la profondeur d'origine.
  const read = {
    16: (o) => data.readInt16LE(o) / 32768,
    24: (o) => {
      const raw = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
      // Extension de signe sur 24 bits.
      return ((raw & 0x800000) ? raw - 0x1000000 : raw) / 8388608;
    },
    32: (o) => data.readInt32LE(o) / 2147483648,
  }[bitsPerSample];

  const mixed = new Float32Array(frames);
  const first = new Float32Array(frames);

  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const value = read((i * channels + c) * bytesPerSample);
      if (c === 0) first[i] = value;
      sum += value;
    }
    mixed[i] = sum / channels;
  }

  if (channels === 1) return { samples: mixed, mode: 'mono' };

  const mixedPeak = peakOf(mixed);
  const firstPeak = peakOf(first);

  // Moins de 60 % du niveau conservé = annulation de phase manifeste.
  if (firstPeak > 0.01 && mixedPeak < firstPeak * 0.6) {
    return { samples: first, mode: 'canal gauche (canaux en opposition de phase)' };
  }
  return { samples: mixed, mode: 'moyenne des canaux' };
}

const peakOf = (samples) => {
  let peak = 0;
  for (const value of samples) {
    const absolute = Math.abs(value);
    if (absolute > peak) peak = absolute;
  }
  return peak;
};

/**
 * Passe-bas à moyenne glissante sur 3 points, puis décimation 2:1.
 * Rudimentaire, mais suffisant pour ce qu'on traite et sans dépendance.
 */
function halveRate(samples) {
  const filtered = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const previous = samples[i - 1] ?? samples[i];
    const next = samples[i + 1] ?? samples[i];
    filtered[i] = (previous + samples[i] * 2 + next) / 4;
  }

  const out = new Float32Array(Math.floor(filtered.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = filtered[i * 2];
  return out;
}

/** Niveau efficace (RMS) : c'est lui qui traduit la sonie perçue, pas la crête. */
function rmsOf(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length);
}

/**
 * Rétablit la sonie d'origine.
 *
 * Le filtre passe-bas qui précède la décimation arrondit les transitoires :
 * un clic perd mécaniquement de la crête, et donc du niveau perçu. Sans cette
 * correction, les sons ressortent nettement plus faibles qu'à l'origine — un
 * effet qui passe inaperçu au casque en studio et s'entend immédiatement au
 * haut-parleur d'un téléphone.
 *
 * On aligne sur le RMS plutôt que sur la crête, puis on borne le gain pour ne
 * jamais écrêter.
 */
function matchLoudness(samples, targetRms) {
  const current = rmsOf(samples);
  if (current < 1e-6 || targetRms < 1e-6) return samples;

  const peak = peakOf(samples);
  const gain = Math.min(targetRms / current, peak > 0 ? 0.99 / peak : 1);
  if (Math.abs(gain - 1) < 0.01) return samples;

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain;
  return out;
}

/** Retire le silence de tête : un retour au doigt qui arrive en retard se sent. */
function trimLeadingSilence(samples, threshold = 0.003) {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1;
  // On garde 1 ms avant l'attaque, pour ne pas créer de clic de coupure.
  return samples.subarray(Math.max(0, start - 22));
}

function writeWav(samples, sampleRate) {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);        // taille du bloc fmt
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);  // octets par seconde
  header.writeUInt16LE(2, 32);         // alignement de bloc
  header.writeUInt16LE(16, 34);        // bits par échantillon
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(bytes.length, 40);

  return Buffer.concat([header, bytes]);
}

/* — Exécution ————————————————————————————————————— */

const kb = (n) => `${String(Math.round(n / 1024)).padStart(4)} Ko`;

let before = 0;
let after = 0;

for (const name of readdirSync(SOUNDS).filter((f) => f.endsWith('.wav')).sort()) {
  const path = join(SOUNDS, name);
  const original = readFileSync(path);
  before += original.length;

  try {
    const { format, data } = readWav(original);

    const { samples: monoSamples, mode } = toMono(data, format.channels, format.bitsPerSample);
    const targetRms = rmsOf(monoSamples);

    let samples = monoSamples;
    let rate = format.sampleRate;
    while (rate >= 44100) { samples = halveRate(samples); rate = Math.round(rate / 2); }

    samples = matchLoudness(samples, targetRms);
    samples = trimLeadingSilence(samples);

    const optimized = writeWav(samples, rate);
    writeFileSync(path, optimized);
    after += optimized.length;

    console.log(`${name.padEnd(18)} ${kb(original.length)} → ${kb(optimized.length)}`
      + `  (${format.channels}×${format.bitsPerSample} bits ${format.sampleRate} Hz`
      + ` → 1×16 bits ${rate} Hz, ${mode})`);
  } catch (error) {
    after += original.length;
    console.warn(`${name.padEnd(18)} ignoré : ${error.message}`);
  }
}

console.log(`\nTotal : ${kb(before)} → ${kb(after)}  (${Math.round(100 - (after * 100) / before)} % de gain)`);
