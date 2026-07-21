// Generates a distinct, attention-grabbing alarm tone for patrol-start alerts.
// Output: a mono 16-bit PCM WAV written to the Android raw resources folder and
// the web public folder so both native and PWA can play the same alert.
//
// Run: node scripts/generate-patrol-sound.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SAMPLE_RATE = 44100;

/** Build one two-tone "alert" beep pair with a short envelope to avoid clicks. */
function appendTone(samples, freq, durationSec, gain) {
  const total = Math.floor(SAMPLE_RATE * durationSec);
  const attack = Math.floor(SAMPLE_RATE * 0.008);
  const release = Math.floor(SAMPLE_RATE * 0.02);
  for (let i = 0; i < total; i++) {
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > total - release) env = Math.max(0, (total - i) / release);
    const s = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    samples.push(s * env * gain);
  }
}

function appendSilence(samples, durationSec) {
  const total = Math.floor(SAMPLE_RATE * durationSec);
  for (let i = 0; i < total; i++) samples.push(0);
}

// Pattern: rapid high/low two-tone triplet, brief gap, repeated — reads as an
// urgent "patrol" alert rather than a generic notification blip.
const samples = [];
for (let rep = 0; rep < 2; rep++) {
  appendTone(samples, 988, 0.16, 0.9); // B5
  appendTone(samples, 1319, 0.16, 0.9); // E6
  appendTone(samples, 988, 0.16, 0.9); // B5
  appendTone(samples, 1319, 0.28, 0.9); // E6 (held)
  appendSilence(samples, 0.14);
}

// Encode as 16-bit PCM WAV.
const numSamples = samples.length;
const dataBytes = numSamples * 2;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write("RIFF", 0, "ascii");
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write("WAVE", 8, "ascii");
buffer.write("fmt ", 12, "ascii");
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // audio format = PCM
buffer.writeUInt16LE(1, 22); // channels = mono
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
buffer.writeUInt16LE(2, 32); // block align
buffer.writeUInt16LE(16, 34); // bits per sample
buffer.write("data", 36, "ascii");
buffer.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < numSamples; i++) {
  const clamped = Math.max(-1, Math.min(1, samples[i]));
  buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
}

const targets = [
  resolve(root, "android/app/src/main/res/raw/patrol_alert.wav"),
  resolve(root, "client/public/patrol_alert.wav"),
];
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`wrote ${target} (${(buffer.length / 1024).toFixed(1)} KB, ${(numSamples / SAMPLE_RATE).toFixed(2)}s)`);
}
