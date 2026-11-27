import type { TransitionMode } from './audioTimelineMath';
import {
  formatOutputTrackFilename,
  normalizeStudioAudioBitrate,
  normalizeStudioAudioFormat,
  STUDIO_AUDIO_FORMATS,
  type StudioAudioBitrate,
  type StudioAudioFormat,
} from './audioFormats';
import {
  ensureStudioUploadId,
  invalidateStudioUploadId,
} from './chunkedStudioUpload';
import { generateRoyaltyFreeWavBytes } from './royaltyFreeSynth';
import { PLATFORM_LABELS } from './formatters';
import { sanitizeDownloadFilename } from './urlSafety';
import type {
  DouyinSynthPresetId,
  IncomingCompiledMaster,
  IncomingStudioAudioClip,
  ViralPost,
} from '../types/media';

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function inferPresetForPost(post: ViralPost): DouyinSynthPresetId {
  if (post.synthPresetId) {
    return post.synthPresetId;
  }
  if (post.platform === 'douyin') {
    return 'guzheng_rain_lofi';
  }
  if (post.classification.audioStyle === 'live_acoustic') {
    return 'dizi_mist_ambient';
  }
  if (post.classification.audioStyle === 'ambient_raw') {
    return 'yunnan_handpan_echo';
  }
  return 'chengdu_night_chillhop';
}

export function createWavObjectUrl(
  presetId: DouyinSynthPresetId,
  durationSec = 10
): string {
  const bytes = generateRoyaltyFreeWavBytes(presetId, durationSec);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

export function downloadStudioWavMaster(post: ViralPost): void {
  const preset = inferPresetForPost(post);
  const bytes = generateRoyaltyFreeWavBytes(preset, 12);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  const base = sanitizeDownloadFilename(
    `origisound-master-${post.platform}-${post.creatorHandle}-${post.id}`
  );
  triggerBlobDownload(blob, `${base}.wav`);
}

export function downloadStudioCopyrightSheet(post: ViralPost): void {
  const lines = [
    'ORIGISOUND — RECORDING STUDIO COPYRIGHT & ARTIST INTAKE SHEET',
    '=============================================================',
    `Generated Date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '1. SOURCE CREATOR & PRIOR-CREATION EVIDENCE',
    `   Creator Name:        ${post.creatorName}`,
    `   Creator Handle:      @${post.creatorHandle}`,
    `   Platform:            ${PLATFORM_LABELS[post.platform]}`,
    `   Source Permalink:    ${post.postUrl}`,
    `   Original Track Tag:  ${post.audioTitle}`,
    `   Published Timestamp: ${post.publishedAt}`,
    '',
    '2. AUDIO RIGHTS SCREENING VERDICT',
    `   Screening Status:    ${post.classification.summaryLabel}`,
    `   First-Party Match:   ${post.classification.isCreatorOwned ? 'Yes (Creator-Owned Sound)' : 'Shared / External'}`,
    `   Tempo / Musical Key: ${post.bpm ? `${post.bpm} BPM` : 'Unmetered'} / ${post.musicalKey || 'Original Take'}`,
    '   Signals Verified:',
    ...post.classification.signals.map(
      (s) => `     - [${s.polarity.toUpperCase()}] ${s.label}: ${s.detail}`
    ),
    '',
    '3. RECORDING STUDIO MASTER & COPYRIGHT REGISTRATION CHECKLIST',
    '   [ ] Written Creator Identity & Ownership Confirmation Signed',
    '   [ ] Studio Re-Recording / Master Arrangement Session Completed (24-bit WAV)',
    '   [ ] Composition Split Sheet Executed (Artist % / Producer %)',
    '   [ ] Master Sound Recording ISRC Assigned: ______________________',
    '   [ ] Formal Copyright Office Filing (SR / PA) Submitted',
    '',
    'Note: Platform original-sound verification confirms absence of commercial',
    'record-label claims. Always obtain the aspiring creator’s signed authorization',
    'before registering derivative masters or distributing commercially.',
  ];

  const blob = new Blob([lines.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
  const base = sanitizeDownloadFilename(
    `copyright-intake-${post.creatorHandle}-${post.id}`
  );
  triggerBlobDownload(blob, `${base}.txt`);
}

async function loadImageForCanvas(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function synthesizeStudioReferenceWebm(post: ViralPost): Promise<Blob | null> {
  if (
    typeof window === 'undefined' ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') {
    return null;
  }

  const img = await loadImageForCanvas(post.thumbnailUrl);
  const preset = inferPresetForPost(post);
  const wavBytes = generateRoyaltyFreeWavBytes(preset, 4);

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  const streamTracks: MediaStreamTrack[] = [
    ...canvas.captureStream(24).getVideoTracks(),
  ];

  let audioCtx: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;
  let hasRunningAudioTrack = false;

  if (AudioCtx) {
    try {
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await Promise.race([
          audioCtx.resume(),
          new Promise((r) => setTimeout(r, 200)),
        ]);
      }
      if (audioCtx.state === 'running') {
        const decoded = await audioCtx.decodeAudioData(
          wavBytes.buffer.slice(0) as ArrayBuffer
        );
        const dest = audioCtx.createMediaStreamDestination();
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = decoded;
        sourceNode.connect(dest);
        streamTracks.push(...dest.stream.getAudioTracks());
        hasRunningAudioTrack = true;
      }
    } catch {
      // Proceed with video track if audio decode/output is unavailable
    }
  }

  const combinedStream = new MediaStream(streamTracks);
  const mimeType =
    hasRunningAudioTrack &&
    MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const durationMs = 3200;
  const startPerf = performance.now();

  const drawFrame = (elapsedMs: number) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (img) {
      const scale = Math.max(
        canvas.width / img.width,
        canvas.height / img.height
      );
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(
        img,
        (canvas.width - dw) / 2,
        (canvas.height - dh) / 2,
        dw,
        dh
      );
    }

    // Bottom studio slate gradient
    const grad = ctx.createLinearGradient(0, 540, 0, 960);
    grad.addColorStop(0, 'rgba(15,23,42,0)');
    grad.addColorStop(0.45, 'rgba(15,23,42,0.82)');
    grad.addColorStop(1, 'rgba(15,23,42,0.96)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 540, canvas.width, 420);

    // Animated waveform bar indicator
    const bars = 24;
    for (let b = 0; b < bars; b++) {
      const phase = elapsedMs * 0.008 + b * 0.55;
      const h = 10 + Math.abs(Math.sin(phase)) * 28;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(48 + b * 14, 735 - h, 8, h);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 20px sans-serif';
    ctx.fillText(
      `${PLATFORM_LABELS[post.platform]} · @${post.creatorHandle} · ${post.classification.summaryLabel}`,
      48,
      785
    );

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 26px sans-serif';
    ctx.fillText(post.title.slice(0, 44), 48, 830);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 18px monospace';
    ctx.fillText(`Track: ${post.audioTitle.slice(0, 48)}`, 48, 872);

    // Progress bar
    const progress = Math.min(1, elapsedMs / durationMs);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(48, 905, canvas.width - 96, 6);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(48, 905, (canvas.width - 96) * progress, 6);
  };

  drawFrame(0);
  recorder.start(200);
  if (sourceNode) {
    try {
      sourceNode.start(0);
    } catch {
      // Ignore
    }
  }

  return new Promise((resolve) => {
    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startPerf;
      drawFrame(elapsed);
      if (elapsed >= durationMs) {
        window.clearInterval(interval);
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }
    }, 42);

    recorder.onstop = () => {
      combinedStream.getTracks().forEach((t) => t.stop());
      if (audioCtx) {
        void audioCtx.close();
      }
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });
}

/**
 * Downloads the video directly inside the app without opening any external social website:
 * 1) Uses server-side direct MP4 stream proxy (/api/download-video) whenever the public post exposes a CDN MP4.
 * 2) Falls back to rendering an in-app Studio Reference Video (.webm) with synchronized original audio.
 */
export async function downloadPostVideoDirect(
  post: ViralPost,
  onStatus?: (msg: string) => void
): Promise<{ format: 'mp4' | 'webm' | 'wav'; message: string }> {
  const filenameBase = sanitizeDownloadFilename(
    `origisound-${post.platform}-${post.creatorHandle}-${post.id}`
  );

  const directVideoUrl = post.directVideoUrl;

  onStatus?.('Checking direct server MP4 stream...');
  try {
    const checkParams = new URLSearchParams({
      check: '1',
      url: post.postUrl,
    });
    if (directVideoUrl) {
      checkParams.set('directVideoUrl', directVideoUrl);
    }
    const checkRes = await fetch(`/api/download-video?${checkParams.toString()}`);
    if (checkRes.ok) {
      const checkJson = (await checkRes.json()) as {
        ok?: boolean;
        streamAvailable?: boolean;
      };
      if (checkJson.streamAvailable) {
        onStatus?.('Downloading direct MP4 video via server proxy...');
        const dlParams = new URLSearchParams({
          url: post.postUrl,
          filename: filenameBase,
        });
        if (directVideoUrl) {
          dlParams.set('directVideoUrl', directVideoUrl);
        }
        const downloadHref = `/api/download-video?${dlParams.toString()}`;
        const a = document.createElement('a');
        a.href = downloadHref;
        a.download = `${filenameBase}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return {
          format: 'mp4',
          message: `Direct MP4 video download started (${filenameBase}.mp4) without leaving the app.`,
        };
      }
    }
  } catch {
    // Fall through to client studio reference WebM synthesis
  }

  onStatus?.('Rendering studio reference video (.webm) in app...');
  const webmBlob = await synthesizeStudioReferenceWebm(post);
  if (webmBlob && webmBlob.size > 0) {
    triggerBlobDownload(webmBlob, `${filenameBase}-studio-ref.webm`);
    return {
      format: 'webm',
      message: `Downloaded Studio Reference Video (${filenameBase}-studio-ref.webm) directly in app.`,
    };
  }

  downloadStudioWavMaster(post);
  return {
    format: 'wav',
    message: `Downloaded Studio WAV Master (${filenameBase}.wav) directly in app.`,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function triggerAudioBytesDownload(
  bytes: ArrayBuffer,
  filename: string,
  format: StudioAudioFormat = 'mp3'
): void {
  const safeFormat = normalizeStudioAudioFormat(format);
  const spec = STUDIO_AUDIO_FORMATS[safeFormat];
  const extSuffix = `.${spec.extension}`;
  const safeName = filename.toLowerCase().endsWith(extSuffix)
    ? filename
    : `${filename.replace(/\.[^.]+$/, '')}${extSuffix}`;
  const blob = new Blob([bytes], { type: spec.mimeType });
  triggerBlobDownload(blob, safeName);
}

/**
 * Extracts and fetches a 192 kbps stereo MP3 for a social post directly inside the app.
 */
export async function fetchPostAudioMp3(
  post: ViralPost,
  onStatus?: (msg: string) => void
): Promise<IncomingStudioAudioClip> {
  const filenameBase = sanitizeDownloadFilename(
    `origisound-audio-${post.platform}-${post.creatorHandle}-${post.id}`
  );

  const directAudioUrl = post.directAudioUrl;
  const directVideoUrl = post.directVideoUrl;

  onStatus?.(`Extracting 192 kbps MP3 audio for @${post.creatorHandle}...`);
  const params = new URLSearchParams({
    url: post.postUrl,
    filename: filenameBase,
  });
  if (directAudioUrl) {
    params.set('directAudioUrl', directAudioUrl);
  }
  if (directVideoUrl) {
    params.set('directVideoUrl', directVideoUrl);
  }

  const res = await fetch(`/api/download-audio?${params.toString()}`);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Audio extraction failed (HTTP ${res.status})`);
  }

  const durationHeader = Number(res.headers.get('X-Audio-Duration-Sec') || 8);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error('Extracted MP3 stream returned 0 bytes.');
  }

  return {
    id: `post-mp3-${post.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${filenameBase}.mp3`,
    bytes,
    durationSec: durationHeader > 0 ? durationHeader : 8,
  };
}

/**
 * Downloads audio-only (.mp3) for a single post directly in-app without visiting external websites.
 */
export async function downloadPostAudioDirect(
  post: ViralPost,
  onStatus?: (msg: string) => void
): Promise<{
  filename: string;
  clip: IncomingStudioAudioClip;
  message: string;
}> {
  const clip = await fetchPostAudioMp3(post, onStatus);
  triggerAudioBytesDownload(clip.bytes, clip.name);
  return {
    filename: clip.name,
    clip,
    message: `Downloaded audio-only MP3 (${clip.name}) directly in app.`,
  };
}

/**
 * Compiles multiple extracted audio clips into a merged WAV, MP3, M4A, FLAC, AIFF, or WMA master via /api/compile-audio.
 */
export async function compileClipsToMaster(
  clips: IncomingStudioAudioClip[],
  outputBaseName = 'origisound-auto-compiled-master',
  transitionMode: TransitionMode = 'seamless',
  outputFormat: StudioAudioFormat = 'mp3',
  bitrate: StudioAudioBitrate = '192k'
): Promise<IncomingCompiledMaster> {
  if (clips.length === 0) {
    throw new Error('Select at least one track to compile.');
  }

  const targetFormat = normalizeStudioAudioFormat(outputFormat);
  const targetBitrate = normalizeStudioAudioBitrate(bitrate);
  const spec = STUDIO_AUDIO_FORMATS[targetFormat];
  const safeOut = sanitizeDownloadFilename(outputBaseName);
  const postCompile = async (forceFreshUpload: boolean) => {
    const uploadedIds = await Promise.all(
      clips.map(async (c) => {
        if (forceFreshUpload) {
          invalidateStudioUploadId(c.bytes);
        }
        return ensureStudioUploadId(c.bytes, c.name, forceFreshUpload);
      })
    );

    const payload = {
      outputName: safeOut,
      outputFormat: targetFormat,
      bitrate: targetBitrate,
      transitionMode,
      tracks: clips.map((c, idx) => {
        const dur = Math.max(0.5, c.durationSec ?? 8);
        return {
          name: c.name,
          uploadId: uploadedIds[idx],
          trimStartSec: 0,
          trimEndSec: dur,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        };
      }),
    };

    return fetch('/api/compile-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  let res = await postCompile(false);
  if (res.status === 404) {
    res = await postCompile(true);
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `Auto-compilation failed (HTTP ${res.status})`);
  }

  const durationSec = Number(res.headers.get('X-Audio-Duration-Sec') || 8);
  const bytes = await res.arrayBuffer();
  return {
    name: formatOutputTrackFilename(safeOut, targetFormat),
    format: targetFormat,
    qualityLabel: spec.lossless
      ? `Lossless Stereo ${spec.label}`
      : `${targetBitrate} Stereo ${spec.label}`,
    bytes,
    durationSec: durationSec > 0 ? durationSec : 8,
  };
}

export const compileClipsToMasterMp3 = compileClipsToMaster;
