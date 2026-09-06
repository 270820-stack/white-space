import { getAudioContext, getReverbSend } from "./harp.js?v=6";

const BEEP_HZ = [392, 523, 659, 784, 988, 1175, 1480, 1865, 2093, 2637];
const ANIM_GAIN = 0.28;

let animBus = null;
let animVolume = 1;

function getAnimBus() {
  const audio = getAudioContext();
  if (!animBus) {
    animBus = audio.createGain();
    const dry = audio.createGain();
    dry.gain.value = 0.35;
    animBus.connect(dry);
    dry.connect(audio.destination);
    animBus.connect(getReverbSend());
  }
  animBus.gain.value = ANIM_GAIN * animVolume;
  return animBus;
}

export function getAnimVolume() {
  return animVolume;
}

export function setAnimVolume(value) {
  animVolume = Math.max(0, Math.min(1, value));
  if (animBus) animBus.gain.value = ANIM_GAIN * animVolume;
}

function noiseBuffer(audio, seconds, reverse) {
  const n = Math.floor(audio.sampleRate * seconds);
  const buf = audio.createBuffer(1, n, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  if (reverse) {
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const tmp = data[i];
      data[i] = data[j];
      data[j] = tmp;
    }
  }
  return buf;
}

function beep(audio, dest, t, freq, len) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const tone = audio.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1400;
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.78), t + len);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.022, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(tone);
  tone.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + len + 0.03);
}

function choppyInvertedWind(audio, dest, t, dur) {
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, dur + 0.4, true);
  src.playbackRate.value = 0.5 + Math.random() * 0.2;

  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.85;
  band.frequency.setValueAtTime(1800, t);
  band.frequency.exponentialRampToValueAtTime(320, t + dur);

  const high = audio.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 140;

  const gate = audio.createGain();
  gate.gain.setValueAtTime(0.04, t);
  let u = t;
  while (u < t + dur) {
    const on = 0.08 + Math.random() * 0.14;
    const off = 0.04 + Math.random() * 0.08;
    gate.gain.linearRampToValueAtTime(0.14, u + on * 0.45);
    u += on;
    gate.gain.linearRampToValueAtTime(0.05, u + off);
    u += off;
  }
  gate.gain.linearRampToValueAtTime(0.0001, t + dur);

  src.connect(band);
  band.connect(high);
  high.connect(gate);
  gate.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function swiftWhoosh(audio, dest, t, dir) {
  const len = 0.16 + Math.random() * 0.12;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, len + 0.08, dir < 0);
  src.playbackRate.value = 1.1 + Math.random() * 0.5;

  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 2.4;
  const f0 = dir > 0 ? 420 : 2400;
  const f1 = dir > 0 ? 2600 : 380;
  band.frequency.setValueAtTime(f0, t);
  band.frequency.exponentialRampToValueAtTime(f1, t + len);

  const pan = audio.createStereoPanner();
  pan.pan.setValueAtTime(dir > 0 ? -0.7 : 0.7, t);
  pan.pan.linearRampToValueAtTime(dir > 0 ? 0.7 : -0.7, t + len);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);

  src.connect(band);
  band.connect(gain);
  gain.connect(pan);
  pan.connect(dest);
  src.start(t);
  src.stop(t + len + 0.04);
}

function swiftTone(audio, dest, t) {
  const len = 0.12 + Math.random() * 0.1;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3200;
  osc.type = "sine";
  const a = 600 + Math.random() * 900;
  const b = 1800 + Math.random() * 1600;
  const up = Math.random() > 0.5;
  osc.frequency.setValueAtTime(up ? a : b, t);
  osc.frequency.exponentialRampToValueAtTime(up ? b : a, t + len);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.032, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + len + 0.03);
}

export function playSwapGlitch() {
  const audio = getAudioContext();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  const t = audio.currentTime;
  const dur = 2.65;
  const bus = getAnimBus();

  choppyInvertedWind(audio, bus, t, dur);

  const whooshTimes = [0, 0.22, 0.48, 0.85, 1.18, 1.52, 1.9, 2.22];
  whooshTimes.forEach((off, i) => {
    swiftWhoosh(audio, bus, t + off, i % 2 === 0 ? 1 : -1);
    if (i % 2 === 0) swiftTone(audio, bus, t + off + 0.04);
  });

  for (let i = 0; i < 14; i++) {
    const when = t + Math.random() * dur;
    const freq = BEEP_HZ[(Math.random() * BEEP_HZ.length) | 0];
    const len = 0.04 + Math.random() * 0.07;
    beep(audio, bus, when, freq, len);
  }

  for (let i = 0; i < 4; i++) {
    const when = t + i * 0.22 + Math.random() * 0.05;
    beep(audio, bus, when, BEEP_HZ[i % BEEP_HZ.length], 0.05);
  }
}
