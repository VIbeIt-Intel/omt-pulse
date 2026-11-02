/** Records the local mic into a short WAV while the radio button is held. */

const TARGET_RATE = 16_000;
const MAX_SECONDS = 60;
const MIN_SECONDS = 0.4;

export type RadioClipCapture = {
  stop: () => Blob | null;
};

function encodeWav(chunks: Float32Array[], rate: number): Blob {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function startRadioClipCapture(track: MediaStreamTrack): RadioClipCapture | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  let samples = 0;
  const maxSamples = TARGET_RATE * MAX_SECONDS;
  const inputRate = ctx.sampleRate || 48000;
  const ratio = inputRate / TARGET_RATE;

  processor.onaudioprocess = (event) => {
    if (samples >= maxSamples) return;
    const input = event.inputBuffer.getChannelData(0);
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
        count += 1;
      }
      out[i] = count > 0 ? sum / count : 0;
    }
    const room = maxSamples - samples;
    const slice = out.length > room ? out.subarray(0, room) : out;
    chunks.push(slice);
    samples += slice.length;
  };

  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);
  void ctx.resume().catch(() => undefined);

  return {
    stop() {
      try { processor.onaudioprocess = null; } catch { /* ignore */ }
      try { processor.disconnect(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      try { silent.disconnect(); } catch { /* ignore */ }
      void ctx.close().catch(() => undefined);
      if (samples < TARGET_RATE * MIN_SECONDS) return null;
      return encodeWav(chunks, TARGET_RATE);
    },
  };
}

export function uploadRadioClip(commandId: number, audio: Blob): void {
  const body = new FormData();
  body.append("commandId", String(commandId));
  body.append("audio", audio, "radio.wav");
  void fetch("/api/radio/clips", {
    method: "POST",
    body,
    credentials: "include",
  }).catch(() => undefined);
}
