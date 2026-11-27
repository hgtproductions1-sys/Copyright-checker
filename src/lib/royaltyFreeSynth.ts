import type { DouyinSynthPresetId } from '../types/media.ts';

interface SynthPresetSpec {
  bpm: number;
  scaleHz: number[];
  bassHz: number[];
  timbre: 'plucked' | 'flute' | 'rhodes' | 'handpan';
  rainLevel: number;
  drumLevel: number;
}

const PRESET_SPECS: Record<DouyinSynthPresetId, SynthPresetSpec> = {
  guzheng_rain_lofi: {
    bpm: 78,
    // D Major Pentatonic (D4, E4, F#4, A4, B4, D5, E5, F#5)
    scaleHz: [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99],
    bassHz: [146.83, 110.0, 123.47, 98.0],
    timbre: 'plucked',
    rainLevel: 0.018,
    drumLevel: 0.22,
  },
  dizi_mist_ambient: {
    bpm: 68,
    // G Major Pentatonic (G4, A4, B4, D5, E5, G5)
    scaleHz: [392.0, 440.0, 493.88, 587.33, 659.25, 783.99],
    bassHz: [98.0, 130.81, 110.0, 146.83],
    timbre: 'flute',
    rainLevel: 0.012,
    drumLevel: 0.08,
  },
  chengdu_night_chillhop: {
    bpm: 86,
    // A Minor Pentatonic (A3, C4, D4, E4, G4, A4, C5)
    scaleHz: [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25],
    bassHz: [110.0, 87.31, 98.0, 82.41],
    timbre: 'rhodes',
    rainLevel: 0.008,
    drumLevel: 0.28,
  },
  jiangnan_pipa_groove: {
    bpm: 92,
    // C Major Pentatonic (C4, D4, E4, G4, A4, C5, D5)
    scaleHz: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33],
    bassHz: [130.81, 110.0, 87.31, 98.0],
    timbre: 'plucked',
    rainLevel: 0.006,
    drumLevel: 0.26,
  },
  yunnan_handpan_echo: {
    bpm: 74,
    // E Minor Pentatonic (E4, G4, A4, B4, D5, E5)
    scaleHz: [329.63, 392.0, 440.0, 493.88, 587.33, 659.25],
    bassHz: [82.41, 98.0, 110.0, 123.47],
    timbre: 'handpan',
    rainLevel: 0.01,
    drumLevel: 0.14,
  },
  suzhou_rhodes_tea: {
    bpm: 82,
    // F Major Pentatonic (F4, G4, A4, C5, D5, F5)
    scaleHz: [349.23, 392.0, 440.0, 523.25, 587.33, 698.46],
    bassHz: [87.31, 110.0, 130.81, 98.0],
    timbre: 'rhodes',
    rainLevel: 0.014,
    drumLevel: 0.24,
  },
};

const MELODY_PATTERNS: Record<DouyinSynthPresetId, number[]> = {
  guzheng_rain_lofi: [0, 2, 3, 5, 4, 3, 2, 1, 0, 3, 4, 6, 5, 3, 2, 0],
  dizi_mist_ambient: [0, -1, 2, 3, 4, -1, 3, 2, 1, -1, 3, 5, 4, -1, 2, 0],
  chengdu_night_chillhop: [0, 2, 4, 3, 5, 4, 2, 1, 0, 3, 5, 6, 4, 3, 1, 0],
  jiangnan_pipa_groove: [4, 3, 2, 0, 2, 3, 5, 4, 6, 5, 3, 2, 3, 2, 1, 0],
  yunnan_handpan_echo: [0, 3, 2, 4, 1, 3, 5, 4, 0, 2, 4, 3, 2, 1, 3, 0],
  suzhou_rhodes_tea: [2, 3, 4, 2, 0, 1, 3, 2, 5, 4, 3, 1, 2, 3, 1, 0],
};

function voiceSample(
  timbre: SynthPresetSpec['timbre'],
  freq: number,
  noteTime: number
): number {
  const twoPiF = 2 * Math.PI * freq;
  if (timbre === 'plucked') {
    const env = Math.exp(-noteTime * 4.8);
    return (
      env *
      (0.62 * Math.sin(twoPiF * noteTime) +
        0.24 * Math.sin(2 * twoPiF * noteTime) * Math.exp(-noteTime * 8) +
        0.14 * Math.sin(3 * twoPiF * noteTime) * Math.exp(-noteTime * 12))
    );
  }
  if (timbre === 'flute') {
    const attack = Math.min(1, noteTime / 0.08);
    const decay = Math.exp(-noteTime * 1.6);
    const vibrato = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * noteTime);
    return (
      attack *
      decay *
      (0.75 * Math.sin(twoPiF * vibrato * noteTime) +
        0.2 * Math.sin(2 * twoPiF * vibrato * noteTime))
    );
  }
  if (timbre === 'handpan') {
    const env = Math.exp(-noteTime * 3.2);
    return (
      env *
      (0.7 * Math.sin(twoPiF * noteTime) +
        0.22 * Math.sin(2.0 * twoPiF * noteTime) * Math.exp(-noteTime * 6) +
        0.08 * Math.sin(2.99 * twoPiF * noteTime) * Math.exp(-noteTime * 9))
    );
  }
  // rhodes
  const env = Math.min(1, noteTime / 0.015) * Math.exp(-noteTime * 2.8);
  return (
    env *
    (0.72 * Math.sin(twoPiF * noteTime) +
      0.18 * Math.sin(2 * twoPiF * noteTime) +
      0.1 * Math.sin(4 * twoPiF * noteTime) * Math.exp(-noteTime * 10))
  );
}

/**
 * Deterministically synthesizes an original, 100% royalty-free / non-copyrighted
 * 16-bit PCM WAV instrumental track from mathematical waveforms.
 */
export function generateRoyaltyFreeWavBytes(
  presetId: DouyinSynthPresetId,
  durationSec = 10
): Uint8Array {
  const spec = PRESET_SPECS[presetId] || PRESET_SPECS.guzheng_rain_lofi;
  const pattern = MELODY_PATTERNS[presetId] || MELODY_PATTERNS.guzheng_rain_lofi;
  const sampleRate = 22050;
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // Standard RIFF WAVE 16-bit mono PCM header
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const stepSec = 60 / spec.bpm / 2; // eighth-note grid
  const beatSec = 60 / spec.bpm;
  let lfsr = 0xace1;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const stepIndex = Math.floor(t / stepSec);
    const noteTime = t - stepIndex * stepSec;

    // Lead melody
    const deg = pattern[stepIndex % pattern.length];
    let lead = 0;
    if (deg >= 0) {
      const freq = spec.scaleHz[deg % spec.scaleHz.length];
      lead = voiceSample(spec.timbre, freq, noteTime) * 0.42;
    }

    // Warm root bass every 4 eighth-notes (half bar)
    const barIndex = Math.floor(stepIndex / 4);
    const barTime = t - barIndex * 4 * stepSec;
    const bassFreq = spec.bassHz[barIndex % spec.bassHz.length];
    const bass =
      Math.sin(2 * Math.PI * bassFreq * barTime) *
      Math.exp(-barTime * 1.5) *
      0.28;

    // Soft lo-fi kick + rim percussion
    const beatIndex = Math.floor(t / beatSec);
    const beatTime = t - beatIndex * beatSec;
    let drum = 0;
    if (beatIndex % 2 === 0 && beatTime < 0.14) {
      const pitchDrop = 115 * Math.exp(-beatTime * 26) + 46;
      drum =
        Math.sin(2 * Math.PI * pitchDrop * beatTime) *
        Math.exp(-beatTime * 22) *
        spec.drumLevel;
    } else if (beatIndex % 2 === 1 && beatTime < 0.05) {
      drum =
        Math.sin(2 * Math.PI * 820 * beatTime) *
        Math.exp(-beatTime * 65) *
        (spec.drumLevel * 0.45);
    }

    // Deterministic gentle vinyl/rain noise via 16-bit LFSR
    const bit =
      ((lfsr >> 0) ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
    lfsr = (lfsr >> 1) | (bit << 15);
    const noise = ((lfsr / 32768) - 1) * spec.rainLevel;

    // Smooth fade-in and fade-out
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = Math.min(1, (durationSec - t) / 0.35);
    const mixed = Math.max(
      -0.96,
      Math.min(0.96, (lead + bass + drum + noise) * fadeIn * fadeOut)
    );

    view.setInt16(44 + i * 2, Math.round(mixed * 32767), true);
  }

  return new Uint8Array(buffer);
}
