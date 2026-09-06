const PENTA = [0, 2, 4, 7, 9];
const BASE_MIDI = 38;
const CABLE_GAIN = 0.2;

let ctx = null;
let master = null;
let reverbSend = null;
let cableVolume = 1;

function makeImpulse(audio, seconds, decay) {
  const rate = audio.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = audio.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = (1 - i / length) ** decay;
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return impulse;
}

function getCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ctx = new Ctx();

  master = ctx.createGain();
  master.gain.value = CABLE_GAIN * cableVolume;

  const dry = ctx.createGain();
  dry.gain.value = 0.32;
  master.connect(dry);
  dry.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 5.5, 1.6);
  const wetFilter = ctx.createBiquadFilter();
  wetFilter.type = "lowpass";
  wetFilter.frequency.value = 4200;
  const wet = ctx.createGain();
  wet.gain.value = 0.95;
  reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;
  master.connect(convolver);
  reverbSend.connect(convolver);
  convolver.connect(wetFilter);
  wetFilter.connect(wet);
  wet.connect(ctx.destination);

  return ctx;
}

export function getAudioContext() {
  return getCtx();
}

export function getReverbSend() {
  getCtx();
  return reverbSend;
}

export function getCableVolume() {
  return cableVolume;
}

export function setCableVolume(value) {
  cableVolume = Math.max(0, Math.min(1, value));
  if (master) master.gain.value = CABLE_GAIN * cableVolume;
}

export function unlockHarp() {
  const audio = getCtx();
  if (audio.state === "suspended") {
    audio.resume().catch(() => {});
  }
}

export function noteFreq(index) {
  const degree = ((index % PENTA.length) + PENTA.length) % PENTA.length;
  const oct = Math.floor(index / PENTA.length) % 5;
  const midi = BASE_MIDI + oct * 12 + PENTA[degree];
  return 440 * 2 ** ((midi - 69) / 12);
}

export function pluckHarp(index) {
  const audio = getCtx();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  const freq = noteFreq(index);
  const t = audio.currentTime;
  const dur = 3.6 + 130 / freq;

  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.6;
  filter.frequency.setValueAtTime(Math.min(4800, freq * 8), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.6, 160), t + dur * 0.75);
  filter.connect(master);

  const out = audio.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.85, t + 0.01);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(filter);

  for (let n = 1; n <= 8; n++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = n === 1 ? "triangle" : "sine";
    osc.frequency.value = freq * n * (1 + 0.00025 * n * n);
    const amp = 0.44 / n ** 1.35;
    const ring = dur / Math.sqrt(n);
    gain.gain.setValueAtTime(Math.max(amp, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + ring + 0.05);
  }
}
