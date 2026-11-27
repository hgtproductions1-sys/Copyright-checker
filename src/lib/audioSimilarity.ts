export interface SegmentAcousticProfile {
  index: number;
  startSec: number;
  endSec: number;
  rmsDb: number;
  peakDb: number;
  crestDb: number;
  stereoSidePct: number;
  zeroCrossingRate: number;
  riskLevel: 'clear' | 'review' | 'flagged';
  riskReason: string;
}

export interface AudioSimilarityReport {
  primaryName: string;
  referenceName: string;
  primaryDurationSec: number;
  referenceDurationSec: number;
  overallSimilarityPct: number;
  envelopeCorrelationPct: number;
  textureCorrelationPct: number;
  bestLagSec: number;
  primaryRmsDb: number;
  referenceRmsDb: number;
  verdict: 'high_match' | 'partial_overlap' | 'distinct_audio';
  verdictTitle: string;
  verdictSummary: string;
}

export function computePearsonCorrelation(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len < 2) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < len; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / len;
  const meanB = sumB / len;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < len; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const denom = Math.sqrt(denA * denB);
  if (denom < 1e-9) return 0;
  return Math.max(-1, Math.min(1, num / denom));
}

export function analyzePcmSegments(params: {
  monoSamples: Float32Array;
  stereoSideSamples?: Float32Array | null;
  sampleRateHz: number;
  segmentSec?: number;
  hasBlockedMetadata?: boolean;
}): SegmentAcousticProfile[] {
  const { monoSamples, stereoSideSamples, sampleRateHz } = params;
  if (monoSamples.length === 0 || sampleRateHz <= 0) return [];

  const segDuration = Math.max(0.5, params.segmentSec ?? 2);
  const samplesPerSeg = Math.max(200, Math.round(segDuration * sampleRateHz));
  const segCount = Math.max(1, Math.ceil(monoSamples.length / samplesPerSeg));
  const segments: SegmentAcousticProfile[] = [];

  for (let idx = 0; idx < segCount; idx++) {
    const startSample = idx * samplesPerSeg;
    const endSample = Math.min(monoSamples.length, startSample + samplesPerSeg);
    const count = endSample - startSample;
    if (count < 32) continue;

    let sumSq = 0;
    let peak = 0;
    let crossings = 0;
    let sideSq = 0;

    for (let i = startSample; i < endSample; i++) {
      const s = monoSamples[i];
      const abs = Math.abs(s);
      sumSq += s * s;
      if (abs > peak) peak = abs;
      if (i > startSample && ((monoSamples[i - 1] < 0 && s >= 0) || (monoSamples[i - 1] >= 0 && s < 0))) {
        crossings++;
      }
      if (stereoSideSamples && i < stereoSideSamples.length) {
        const diff = stereoSideSamples[i];
        sideSq += diff * diff;
      }
    }

    const rms = Math.sqrt(sumSq / count);
    const rmsDb = Number((20 * Math.log10(Math.max(rms, 1e-5))).toFixed(1));
    const peakDb = Number((20 * Math.log10(Math.max(peak, 1e-5))).toFixed(1));
    const crestDb = Number(Math.max(0, peakDb - rmsDb).toFixed(1));
    const sideRms = stereoSideSamples ? Math.sqrt(sideSq / count) : 0;
    const stereoSidePct = Number(
      Math.min(100, (sideRms / Math.max(rms, 1e-4)) * 100).toFixed(1)
    );
    const zeroCrossingRate = Number((crossings / count).toFixed(3));

    const startSec = Number((startSample / sampleRateHz).toFixed(2));
    const endSec = Number((endSample / sampleRateHz).toFixed(2));

    let riskLevel: SegmentAcousticProfile['riskLevel'] = 'clear';
    let riskReason = 'Natural creator mic / sparse ambient dynamics';

    if (rmsDb < -46) {
      riskLevel = 'clear';
      riskReason = 'Quiet ambient floor — no audible music bed detected';
    } else if (params.hasBlockedMetadata) {
      riskLevel = 'flagged';
      riskReason = 'Covered by detected container rights holder / ISRC claim';
    } else if (rmsDb > -10.5 && crestDb < 7.2) {
      riskLevel = 'flagged';
      riskReason = `Brickwall commercial mastering (${rmsDb} dBFS, crest ${crestDb} dB)`;
    } else if (rmsDb > -13.5 && crestDb < 8.5 && stereoSidePct > 28) {
      riskLevel = 'review';
      riskReason = `Wide stereo produced mix (${stereoSidePct}% stereo side, crest ${crestDb} dB)`;
    }

    segments.push({
      index: idx,
      startSec,
      endSec,
      rmsDb,
      peakDb,
      crestDb,
      stereoSidePct,
      zeroCrossingRate,
      riskLevel,
      riskReason,
    });
  }

  return segments;
}

export function extractFixedTimeEnvelope(
  samples: Float32Array,
  sampleRateHz: number,
  frameSec = 0.25
): { energy: number[]; zcr: number[]; rmsDb: number } {
  const frameLen = Math.max(128, Math.round(frameSec * Math.max(1000, sampleRateHz)));
  if (samples.length === 0) {
    return { energy: [], zcr: [], rmsDb: -100 };
  }

  const frameCount = Math.max(4, Math.floor(samples.length / frameLen));
  const energy: number[] = [];
  const zcr: number[] = [];
  let globalSq = 0;

  for (let b = 0; b < frameCount; b++) {
    const start = b * frameLen;
    const end = Math.min(samples.length, start + frameLen);
    const len = Math.max(1, end - start);
    let sq = 0;
    let cross = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      sq += s * s;
      globalSq += s * s;
      if (i > start && ((samples[i - 1] < 0 && s >= 0) || (samples[i - 1] >= 0 && s < 0))) {
        cross++;
      }
    }
    energy.push(Math.sqrt(sq / len));
    zcr.push(cross / len);
  }

  const globalRms = Math.sqrt(globalSq / samples.length);
  const rmsDb = Number((20 * Math.log10(Math.max(globalRms, 1e-5))).toFixed(1));

  return { energy, zcr, rmsDb };
}

export function compareAudioEnvelopes(params: {
  primarySamples: Float32Array;
  referenceSamples: Float32Array;
  sampleRateHz: number;
  primaryName: string;
  referenceName: string;
}): AudioSimilarityReport {
  const frameSec = 0.25;
  const primaryDur = Number(
    (params.primarySamples.length / Math.max(1, params.sampleRateHz)).toFixed(2)
  );
  const refDur = Number(
    (params.referenceSamples.length / Math.max(1, params.sampleRateHz)).toFixed(2)
  );

  const pEnv = extractFixedTimeEnvelope(params.primarySamples, params.sampleRateHz, frameSec);
  const rEnv = extractFixedTimeEnvelope(params.referenceSamples, params.sampleRateHz, frameSec);

  const lenP = pEnv.energy.length;
  const lenR = rEnv.energy.length;
  const overlapWindow = Math.max(4, Math.min(lenP, lenR));
  const minOverlap = Math.max(4, Math.floor(overlapWindow * 0.75));
  const minShift = -(lenR - minOverlap);
  const maxShift = lenP - minOverlap;

  let bestCombined = -1;
  let bestEnvCorr = 0;
  let bestTexCorr = 0;
  let bestShift = 0;

  for (let shift = minShift; shift <= maxShift; shift++) {
    const pSliceE: number[] = [];
    const rSliceE: number[] = [];
    const pSliceZ: number[] = [];
    const rSliceZ: number[] = [];

    for (let i = 0; i < lenP; i++) {
      const j = i - shift;
      if (j >= 0 && j < lenR) {
        pSliceE.push(pEnv.energy[i]);
        rSliceE.push(rEnv.energy[j]);
        pSliceZ.push(pEnv.zcr[i]);
        rSliceZ.push(rEnv.zcr[j]);
      }
    }

    if (pSliceE.length < minOverlap) {
      continue;
    }

    const envCorr = computePearsonCorrelation(pSliceE, rSliceE);
    const texCorr = computePearsonCorrelation(pSliceZ, rSliceZ);

    const meanZcrP = pSliceZ.reduce((s, v) => s + v, 0) / pSliceZ.length;
    const meanZcrR = rSliceZ.reduce((s, v) => s + v, 0) / rSliceZ.length;
    const timbreSim =
      1 - Math.min(1, Math.abs(meanZcrP - meanZcrR) / Math.max(meanZcrP, meanZcrR, 0.04));

    const score =
      Math.max(0, envCorr) * 0.5 +
      Math.max(0, texCorr) * 0.25 +
      timbreSim * 0.25;

    if (score > bestCombined) {
      bestCombined = score;
      bestEnvCorr = envCorr;
      bestTexCorr = texCorr;
      bestShift = shift;
    }
  }

  const envPct = Math.max(0, Math.min(100, Math.round(Math.max(0, bestEnvCorr) * 100)));
  const texPct = Math.max(0, Math.min(100, Math.round(Math.max(0, bestTexCorr) * 100)));
  const combinedPct = Math.max(
    0,
    Math.min(100, Math.round(Math.max(0, bestCombined) * 100))
  );
  const bestLagSec = Number((bestShift * frameSec).toFixed(2));

  let verdict: AudioSimilarityReport['verdict'] = 'distinct_audio';
  let verdictTitle = 'Distinct Audio Profiles — Low Acoustic Overlap';
  let verdictSummary = `Measured ${combinedPct}% cross-band similarity (${envPct}% amplitude envelope, ${texPct}% spectral texture). No rhythmic or dynamic structural duplication detected.`;

  if (combinedPct >= 68) {
    verdict = 'high_match';
    verdictTitle = 'High Acoustic / Beat Structural Match Detected';
    verdictSummary = `Strong ${combinedPct}% cross-band match (${envPct}% energy contour, ${texPct}% spectral texture at ${bestLagSec >= 0 ? '+' : ''}${bestLagSec}s alignment). Treat as matching beat/sample source and verify stem clearance.`;
  } else if (combinedPct >= 38) {
    verdict = 'partial_overlap';
    verdictTitle = 'Partial Cadence / Groove Overlap — Manual Listen Recommended';
    verdictSummary = `Moderate ${combinedPct}% structural overlap (${envPct}% energy envelope, ${texPct}% texture). Could reflect shared percussion tempo or subtle background bleed.`;
  }

  return {
    primaryName: params.primaryName,
    referenceName: params.referenceName,
    primaryDurationSec: primaryDur,
    referenceDurationSec: refDur,
    overallSimilarityPct: combinedPct,
    envelopeCorrelationPct: envPct,
    textureCorrelationPct: texPct,
    bestLagSec,
    primaryRmsDb: pEnv.rmsDb,
    referenceRmsDb: rEnv.rmsDb,
    verdict,
    verdictTitle,
    verdictSummary,
  };
}
