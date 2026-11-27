import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Dices,
  Download,
  FileAudio,
  Film,
  Layers,
  Play,
  Plus,
  Scissors,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  STUDIO_AUDIO_FORMAT_ORDER,
  STUDIO_AUDIO_FORMATS,
  formatOutputTrackFilename,
  inferAudioFormatFromFilename,
  normalizeStudioAudioFormat,
  type StudioAudioBitrate,
  type StudioAudioFormat,
} from '../lib/audioFormats';
import {
  STUDIO_CHUNK_SIZE_BYTES,
  ensureStudioUploadId,
  invalidateStudioUploadId,
} from '../lib/chunkedStudioUpload';
import {
  computeTimelineLayout,
  dbToLinearGain,
  deriveAudioTrackName,
  formatPreciseTimecode,
  generateRandomSongSlug,
  sanitizeClipTiming,
  summarizeBatchVideoQueue,
  type BatchVideoQueueItem,
  type TimelinePlacedClip,
  type TransitionMode,
} from '../lib/audioTimelineMath';
import { sanitizeDownloadFilename } from '../lib/urlSafety';
import { CoverArtPanel } from './CoverArtPanel';
import { VisualAudioTrimmer } from './VisualAudioTrimmer';

import type {
  IncomingCompiledMaster,
  IncomingStudioAudioClip,
} from '../types/media';

export interface StudioAudioClip {
  id: string;
  name: string;
  audioBytes: ArrayBuffer;
  playableBytes?: ArrayBuffer;
  objectUrl: string;
  peaks: number[];
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
}

interface QueuedStudioVideo extends BatchVideoQueueItem {
  file: File;
}

interface AudioStudioViewProps {
  incomingVideoFile: File | null;
  onConsumeIncomingVideo: () => void;
  incomingAudioClips: IncomingStudioAudioClip[];
  incomingCompiledMaster: IncomingCompiledMaster | null;
  onConsumeIncomingAudio: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function buildFallbackPeaks(bytes: ArrayBuffer, barCount = 96): number[] {
  const view = new Uint8Array(bytes);
  const step = Math.max(1, Math.floor(view.length / barCount));
  const peaks: number[] = [];
  for (let b = 0; b < barCount; b++) {
    let sum = 0;
    const start = b * step;
    const count = Math.min(32, view.length - start);
    for (let k = 0; k < count; k++) {
      sum += Math.abs(view[start + k] - 128) / 128;
    }
    const avg = count > 0 ? sum / count : 0.25;
    peaks.push(Math.min(0.95, Math.max(0.14, avg * 1.4)));
  }
  return peaks;
}

async function fetchServerPreviewWav(
  bytes: ArrayBuffer,
  fileName: string
): Promise<{ wavBytes: ArrayBuffer; durationSec?: number } | null> {
  try {
    const requestPreview = async (forceFresh: boolean) => {
      if (bytes.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
        if (forceFresh) invalidateStudioUploadId(bytes);
        const uploadId = await ensureStudioUploadId(bytes, fileName, forceFresh);
        return fetch(`/api/audio-preview?uploadId=${encodeURIComponent(uploadId)}`, {
          method: 'POST',
          headers: {
            'X-File-Name': encodeURIComponent(fileName || 'audio'),
          },
        });
      }
      return fetch('/api/audio-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(fileName || 'audio'),
        },
        body: bytes,
      });
    };

    let res = await requestPreview(false);
    if (res.status === 404 && bytes.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
      res = await requestPreview(true);
    }
    if (!res.ok) return null;
    const dur = Number(res.headers.get('X-Audio-Duration-Sec') || 0);
    const wavBytes = await res.arrayBuffer();
    if (wavBytes.byteLength === 0) return null;
    return {
      wavBytes,
      durationSec: dur > 0 ? dur : undefined,
    };
  } catch {
    return null;
  }
}

function extractWaveformPeaksFromChannel(
  ch: Float32Array,
  barCount = 96
): number[] {
  const blockSize = Math.max(1, Math.floor(ch.length / barCount));
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    let maxAbs = 0;
    const offset = i * blockSize;
    const limit = Math.min(ch.length, offset + blockSize);
    for (let j = offset; j < limit; j += 4) {
      const v = Math.abs(ch[j]);
      if (v > maxAbs) maxAbs = v;
    }
    peaks.push(Math.min(1, Math.max(0.08, maxAbs)));
  }
  return peaks;
}

async function decodeAudioPeaksAndDuration(
  bytes: ArrayBuffer,
  fallbackDurationSec = 6,
  fileName = 'audio.mp3'
): Promise<{
  durationSec: number;
  peaks: number[];
  playableBytes: ArrayBuffer;
  playableMime: string;
}> {
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (AudioCtx) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      const ch = decoded.getChannelData(0);
      return {
        durationSec: Number(Math.max(0.5, decoded.duration).toFixed(2)),
        peaks: extractWaveformPeaksFromChannel(ch, 96),
        playableBytes: bytes,
        playableMime: 'audio/mpeg',
      };
    } catch {
      // Browser cannot decode containers like WMA/AIFF directly; transcode preview WAV via FFmpeg
      const serverPreview = await fetchServerPreviewWav(bytes, fileName);
      if (serverPreview && ctx) {
        try {
          const decodedPreview = await ctx.decodeAudioData(
            serverPreview.wavBytes.slice(0)
          );
          const ch = decodedPreview.getChannelData(0);
          return {
            durationSec: Number(
              Math.max(
                0.5,
                serverPreview.durationSec ?? decodedPreview.duration
              ).toFixed(2)
            ),
            peaks: extractWaveformPeaksFromChannel(ch, 96),
            playableBytes: serverPreview.wavBytes,
            playableMime: 'audio/wav',
          };
        } catch {
          // Fall through with serverPreview wavBytes
          return {
            durationSec: Number(
              Math.max(0.5, serverPreview.durationSec ?? fallbackDurationSec).toFixed(
                2
              )
            ),
            peaks: buildFallbackPeaks(serverPreview.wavBytes, 96),
            playableBytes: serverPreview.wavBytes,
            playableMime: 'audio/wav',
          };
        }
      }
    } finally {
      if (ctx) {
        void ctx.close().catch(() => undefined);
      }
    }
  }

  return {
    durationSec: Number(Math.max(0.5, fallbackDurationSec).toFixed(2)),
    peaks: buildFallbackPeaks(bytes, 96),
    playableBytes: bytes,
    playableMime: 'audio/mpeg',
  };
}

function ClipWaveformCanvas({ clip }: { clip: StudioAudioClip }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const dur = Math.max(0.25, clip.sourceDurationSec);
    const startRatio = Math.max(0, Math.min(1, clip.trimStartSec / dur));
    const endRatio = Math.max(startRatio, Math.min(1, clip.trimEndSec / dur));
    const startX = startRatio * w;
    const endX = endRatio * w;

    // Shaded trimmed-out zones
    ctx.fillStyle = '#e2e8f0';
    if (startX > 0) ctx.fillRect(0, 0, startX, h);
    if (endX < w) ctx.fillRect(endX, 0, w - endX, h);

    const gainScale = Math.min(1.4, Math.max(0.35, dbToLinearGain(clip.gainDb)));
    const barCount = clip.peaks.length;
    const barStep = w / barCount;
    const barWidth = Math.max(2, barStep * 0.66);

    for (let i = 0; i < barCount; i++) {
      const x = i * barStep + (barStep - barWidth) / 2;
      const centerRatio = (i + 0.5) / barCount;
      const inActive = centerRatio >= startRatio && centerRatio <= endRatio;
      const amp = Math.min(0.96, clip.peaks[i] * gainScale);
      const barH = Math.max(4, amp * (h - 12));
      const y = (h - barH) / 2;

      ctx.fillStyle = inActive ? '#0369a1' : '#94a3b8';
      ctx.fillRect(x, y, barWidth, barH);
    }

    // Draw trim boundary lines
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, h);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, h);
    ctx.stroke();

    // Draw fade-in / fade-out envelope ramps
    if (clip.fadeInSec > 0.02 || clip.fadeOutSec > 0.02) {
      const fadeInW = (clip.fadeInSec / dur) * w;
      const fadeOutW = (clip.fadeOutSec / dur) * w;
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(startX, h - 4);
      ctx.lineTo(Math.min(endX, startX + fadeInW), 6);
      ctx.lineTo(Math.max(startX, endX - fadeOutW), 6);
      ctx.lineTo(endX, h - 4);
      ctx.stroke();
    }
  }, [clip]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={56}
      aria-label={`Waveform preview for ${clip.name}`}
      className="w-full h-14 rounded-md border border-slate-200 block"
    />
  );
}

function ArrangementTimelineCanvas({
  placedClips,
  totalDurationSec,
  playheadSec,
  isPlaying,
}: {
  placedClips: TimelinePlacedClip[];
  totalDurationSec: number;
  playheadSec: number;
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Subtle ruler ticks along top
    const total = Math.max(0.5, totalDurationSec);
    const tickInterval = total <= 12 ? 1 : total <= 30 ? 2 : 5;
    ctx.strokeStyle = '#334155';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;

    for (let t = 0; t <= total; t += tickInterval) {
      const tx = Math.min(w - 1, (t / total) * w);
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, 10);
      ctx.stroke();
      if (tx < w - 34) {
        ctx.fillText(`${t}s`, tx + 3, 10);
      }
    }

    // Draw proportional clip blocks
    placedClips.forEach((clip, idx) => {
      const x = Math.max(0, (clip.timelineStartSec / total) * w);
      const rawW = (clip.activeDurationSec / total) * w;
      const blockW = Math.max(18, Math.min(w - x, rawW));
      const blockY = 16;
      const blockH = h - 22;

      ctx.fillStyle = idx % 2 === 0 ? '#0369a1' : '#0f766e';
      ctx.fillRect(x + 1, blockY, Math.max(4, blockW - 2), blockH);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, blockY, Math.max(4, blockW - 2), blockH);

      if (blockW > 48) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 4, blockY, blockW - 8, blockH);
        ctx.clip();
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${idx + 1}. ${clip.name}`, x + 7, blockY + 18);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(
          `${formatPreciseTimecode(clip.timelineStartSec)}–${formatPreciseTimecode(clip.timelineEndSec)}`,
          x + 7,
          blockY + 32
        );
        ctx.restore();
      }
    });

    // Draw live playhead cursor
    if (isPlaying || playheadSec > 0) {
      const px = Math.max(1, Math.min(w - 1, (playheadSec / total) * w));
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [placedClips, totalDurationSec, playheadSec, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={960}
      height={62}
      data-testid="arrangement-timeline-canvas"
      aria-label={`Master arrangement timeline showing ${placedClips.length} clips totaling ${formatPreciseTimecode(totalDurationSec)}`}
      className="w-full h-16 rounded-lg border border-slate-700 block"
    />
  );
}

export function AudioStudioView({
  incomingVideoFile,
  onConsumeIncomingVideo,
  incomingAudioClips,
  incomingCompiledMaster,
  onConsumeIncomingAudio,
}: AudioStudioViewProps) {
  // Section 1: Audio & Video Studio Converter state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [converterFormat, setConverterFormat] =
    useState<StudioAudioFormat>('mp3');
  const [mp3Bitrate, setMp3Bitrate] = useState<StudioAudioBitrate>('192k');
  const [videoTrimStart, setVideoTrimStart] = useState<string>('0');
  const [videoTrimEnd, setVideoTrimEnd] = useState<string>('');
  const [converting, setConverting] = useState(false);
  const [loadingSampleVideo, setLoadingSampleVideo] = useState(false);
  const [converterError, setConverterError] = useState<string | null>(null);
  const [convertedMp3, setConvertedMp3] = useState<{
    name: string;
    format: StudioAudioFormat;
    bytes: ArrayBuffer;
    downloadUrl: string;
    previewUrl: string;
    durationSec: number;
    qualityLabel: string;
  } | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const mp3FilesInputRef = useRef<HTMLInputElement | null>(null);
  const batchVideoInputRef = useRef<HTMLInputElement | null>(null);

  // Section 2: Multi-Format Audio Editor & Compiler + Multi-Video Batch Queue state
  const [clips, setClips] = useState<StudioAudioClip[]>([]);
  const [queuedVideos, setQueuedVideos] = useState<QueuedStudioVideo[]>([]);
  const [batchVideoFormat, setBatchVideoFormat] =
    useState<StudioAudioFormat>('mp3');
  const [batchVideoBitrate, setBatchVideoBitrate] =
    useState<StudioAudioBitrate>('192k');
  const [batchConverting, setBatchConverting] = useState(false);
  const [loadingBatchSamples, setLoadingBatchSamples] = useState(false);
  const [transitionMode, setTransitionMode] =
    useState<TransitionMode>('seamless');
  const [outputFormat, setOutputFormat] = useState<StudioAudioFormat>('mp3');
  const [outputBitrate, setOutputBitrate] = useState<StudioAudioBitrate>('192k');
  const [outputName, setOutputName] = useState('studio-compiled-master');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiledMaster, setCompiledMaster] = useState<{
    name: string;
    format: StudioAudioFormat;
    downloadUrl: string;
    previewUrl: string;
    sizeBytes: number;
    durationSec: number;
    qualityLabel: string;
  } | null>(null);

  // Playback transport state
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isPlayingArrangement, setIsPlayingArrangement] = useState(false);
  const [soloClipId, setSoloClipId] = useState<string | null>(null);
  const [soloPlayheadSec, setSoloPlayheadSec] = useState<number | null>(null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soloAudioRef = useRef<HTMLAudioElement | null>(null);
  const playheadTimerRef = useRef<number | null>(null);
  const soloTimerRef = useRef<number | null>(null);
  const clipsRef = useRef<StudioAudioClip[]>([]);
  clipsRef.current = clips;

  const stopAllPlayback = useCallback(() => {
    if (playheadTimerRef.current !== null) {
      window.clearInterval(playheadTimerRef.current);
      playheadTimerRef.current = null;
    }
    if (soloTimerRef.current !== null) {
      window.clearInterval(soloTimerRef.current);
      soloTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    if (soloAudioRef.current) {
      soloAudioRef.current.pause();
      soloAudioRef.current.src = '';
      soloAudioRef.current = null;
    }
    setIsPlayingArrangement(false);
    setSoloClipId(null);
    setSoloPlayheadSec(null);
    setPlayheadSec(0);
  }, []);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      clipsRef.current.forEach((c) => URL.revokeObjectURL(c.objectUrl));
    };
  }, [stopAllPlayback]);

  // Keep a valid selected clip active for the Visual Audio Trimmer whenever tracks are present
  useEffect(() => {
    if (clips.length === 0) {
      if (selectedClipId !== null) setSelectedClipId(null);
      return;
    }
    if (!selectedClipId || !clips.some((c) => c.id === selectedClipId)) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selectedClipId]);

  useEffect(() => {
    return () => {
      if (convertedMp3?.downloadUrl) {
        URL.revokeObjectURL(convertedMp3.downloadUrl);
      }
      if (
        convertedMp3?.previewUrl &&
        convertedMp3.previewUrl !== convertedMp3.downloadUrl
      ) {
        URL.revokeObjectURL(convertedMp3.previewUrl);
      }
    };
  }, [convertedMp3]);

  useEffect(() => {
    return () => {
      if (compiledMaster?.downloadUrl) {
        URL.revokeObjectURL(compiledMaster.downloadUrl);
      }
      if (
        compiledMaster?.previewUrl &&
        compiledMaster.previewUrl !== compiledMaster.downloadUrl
      ) {
        URL.revokeObjectURL(compiledMaster.previewUrl);
      }
    };
  }, [compiledMaster]);

  // Accept incoming video from Copyright Checker
  useEffect(() => {
    if (incomingVideoFile) {
      setVideoFile(incomingVideoFile);
      setConverterError(null);
      onConsumeIncomingVideo();
    }
  }, [incomingVideoFile, onConsumeIncomingVideo]);

  const timeline = useMemo(
    () => computeTimelineLayout(clips, transitionMode),
    [clips, transitionMode]
  );

  const appendAudioBytesAsClip = useCallback(
    async (name: string, bytes: ArrayBuffer, hintedDurationSec?: number) => {
      const { durationSec, peaks, playableBytes, playableMime } =
        await decodeAudioPeaksAndDuration(bytes, hintedDurationSec ?? 6, name);
      const previewBlob = new Blob([playableBytes], { type: playableMime });
      const objectUrl = URL.createObjectURL(previewBlob);
      const newClip: StudioAudioClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        audioBytes: bytes,
        playableBytes,
        objectUrl,
        peaks,
        sourceDurationSec: durationSec,
        trimStartSec: 0,
        trimEndSec: durationSec,
        gainDb: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
      };
      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
    },
    []
  );

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const processingBatchKeyRef = useRef<string | null>(null);

  // Accept incoming single or batch clips (and optional auto-compiled master) from Discover / Inspector / Saved
  useEffect(() => {
    if (incomingAudioClips.length === 0 && !incomingCompiledMaster) {
      processingBatchKeyRef.current = null;
      return;
    }

    const batchKey = `${incomingAudioClips.map((c) => c.id).join('|')}::${
      incomingCompiledMaster?.name || ''
    }`;
    if (processingBatchKeyRef.current === batchKey) {
      return;
    }
    processingBatchKeyRef.current = batchKey;

    const batchClips = [...incomingAudioClips];
    const masterPayload = incomingCompiledMaster;

    void (async () => {
      const decodedClips: StudioAudioClip[] = [];
      for (const item of batchClips) {
        const { durationSec, peaks, playableBytes, playableMime } =
          await decodeAudioPeaksAndDuration(
            item.bytes,
            item.durationSec ?? 8,
            item.name
          );
        const blob = new Blob([playableBytes], { type: playableMime });
        const objectUrl = URL.createObjectURL(blob);
        decodedClips.push({
          id:
            item.id ||
            `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: item.name,
          audioBytes: item.bytes,
          playableBytes,
          objectUrl,
          peaks,
          sourceDurationSec: durationSec,
          trimStartSec: 0,
          trimEndSec: durationSec,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        });
      }

      if (!isMountedRef.current) {
        decodedClips.forEach((c) => URL.revokeObjectURL(c.objectUrl));
        return;
      }

      if (decodedClips.length > 0) {
        setClips((prev) => [...prev, ...decodedClips]);
        setEditorError(null);
      }

      if (masterPayload) {
        const masterFormat = normalizeStudioAudioFormat(
          masterPayload.format || inferAudioFormatFromFilename(masterPayload.name)
        );
        const masterSpec = STUDIO_AUDIO_FORMATS[masterFormat];
        const masterBlob = new Blob([masterPayload.bytes], {
          type: masterSpec.mimeType,
        });
        const masterUrl = URL.createObjectURL(masterBlob);
        let masterPreviewUrl = masterUrl;
        if (!masterSpec.browserNativePlayable) {
          const prev = await fetchServerPreviewWav(
            masterPayload.bytes,
            masterPayload.name
          );
          if (prev) {
            masterPreviewUrl = URL.createObjectURL(
              new Blob([prev.wavBytes], { type: 'audio/wav' })
            );
          }
        }
        setOutputFormat(masterFormat);
        setCompiledMaster({
          name: masterPayload.name,
          format: masterFormat,
          downloadUrl: masterUrl,
          previewUrl: masterPreviewUrl,
          sizeBytes: masterPayload.bytes.byteLength,
          durationSec: masterPayload.durationSec,
          qualityLabel:
            masterPayload.qualityLabel ||
            (masterSpec.lossless
              ? `Lossless Stereo ${masterSpec.label}`
              : `192k Stereo ${masterSpec.label}`),
        });
      }

      onConsumeIncomingAudio();

      window.setTimeout(() => {
        document
          .getElementById('mp3-compiler-section')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    })();
  }, [incomingAudioClips, incomingCompiledMaster, onConsumeIncomingAudio]);

  const handleLoadSampleVideo = async () => {
    setLoadingSampleVideo(true);
    setConverterError(null);
    try {
      const res = await fetch('/api/sample-video?kind=original');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const sampleFile = new File([blob], 'sample-studio-original-clip.mp4', {
        type: 'video/mp4',
      });
      setVideoFile(sampleFile);
    } catch (err) {
      setConverterError(
        err instanceof Error ? err.message : 'Unable to load sample video.'
      );
    } finally {
      setLoadingSampleVideo(false);
    }
  };

  const handleConvertVideoToMp3 = async () => {
    if (!videoFile) {
      setConverterError(
        'Select or load a video or audio file first to convert.'
      );
      return;
    }
    setConverting(true);
    setConverterError(null);
    const spec = STUDIO_AUDIO_FORMATS[converterFormat];
    try {
      const params = new URLSearchParams({
        format: converterFormat,
        bitrate: mp3Bitrate,
      });
      const startNum = Number(videoTrimStart);
      const endNum = Number(videoTrimEnd);
      if (Number.isFinite(startNum) && startNum > 0) {
        params.set('trimStart', String(startNum));
      }
      if (Number.isFinite(endNum) && endNum > 0) {
        params.set('trimEnd', String(endNum));
      }

      const bodyBuf = await videoFile.arrayBuffer();
      const postConvert = async (forceFresh: boolean) => {
        const reqParams = new URLSearchParams(params);
        if (bodyBuf.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
          if (forceFresh) invalidateStudioUploadId(bodyBuf);
          const uploadId = await ensureStudioUploadId(
            bodyBuf,
            videoFile.name,
            forceFresh
          );
          reqParams.set('uploadId', uploadId);
          return fetch(`/api/convert-media?${reqParams.toString()}`, {
            method: 'POST',
            headers: {
              'X-File-Name': encodeURIComponent(videoFile.name),
            },
          });
        }
        return fetch(`/api/convert-media?${reqParams.toString()}`, {
          method: 'POST',
          headers: {
            'Content-Type': videoFile.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(videoFile.name),
          },
          body: bodyBuf,
        });
      };

      let res = await postConvert(false);
      if (res.status === 404 && bodyBuf.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
        res = await postConvert(true);
      }

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errJson.error || `Conversion failed (HTTP ${res.status})`);
      }

      const durationHeader = Number(res.headers.get('X-Audio-Duration-Sec') || 6);
      const outBytes = await res.arrayBuffer();
      const outBlob = new Blob([outBytes], { type: spec.mimeType });
      const downloadUrl = URL.createObjectURL(outBlob);

      let previewUrl = downloadUrl;
      if (!spec.browserNativePlayable) {
        const prev = await fetchServerPreviewWav(
          outBytes,
          `${videoFile.name}.${spec.extension}`
        );
        if (prev) {
          previewUrl = URL.createObjectURL(
            new Blob([prev.wavBytes], { type: 'audio/wav' })
          );
        }
      }

      const baseName = sanitizeDownloadFilename(
        videoFile.name.replace(/\.[^.]+$/, '')
      );

      setConvertedMp3({
        name: `${baseName}.${spec.extension}`,
        format: converterFormat,
        bytes: outBytes,
        downloadUrl,
        previewUrl,
        durationSec: durationHeader > 0 ? durationHeader : 6,
        qualityLabel: spec.lossless ? `Lossless ${spec.label}` : `${mp3Bitrate} ${spec.label}`,
      });
    } catch (err) {
      setConverterError(
        err instanceof Error
          ? err.message
          : `Unable to convert file to ${spec.label}.`
      );
    } finally {
      setConverting(false);
    }
  };

  const triggerDownloadUrl = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleUploadMp3Files = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setEditorError(null);
    for (const file of Array.from(fileList)) {
      if (file.size === 0) continue;
      if (file.size > 80 * 1024 * 1024) {
        setEditorError(`Skipped ${file.name}: exceeds 80 MB per-track limit.`);
        continue;
      }
      const buf = await file.arrayBuffer();
      await appendAudioBytesAsClip(file.name, buf);
    }
  };

  const updateClip = (
    clipId: string,
    patch: Partial<
      Pick<
        StudioAudioClip,
        'trimStartSec' | 'trimEndSec' | 'gainDb' | 'fadeInSec' | 'fadeOutSec'
      >
    >
  ) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const sanitized = sanitizeClipTiming({
          id: c.id,
          name: c.name,
          sourceDurationSec: c.sourceDurationSec,
          trimStartSec: patch.trimStartSec ?? c.trimStartSec,
          trimEndSec: patch.trimEndSec ?? c.trimEndSec,
          gainDb: patch.gainDb ?? c.gainDb,
          fadeInSec: patch.fadeInSec ?? c.fadeInSec,
          fadeOutSec: patch.fadeOutSec ?? c.fadeOutSec,
        });
        return {
          ...c,
          trimStartSec: sanitized.trimStartSec,
          trimEndSec: sanitized.trimEndSec,
          gainDb: sanitized.gainDb,
          fadeInSec: sanitized.fadeInSec,
          fadeOutSec: sanitized.fadeOutSec,
        };
      })
    );
  };

  const moveClip = (index: number, direction: -1 | 1) => {
    setClips((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const duplicateClip = (clip: StudioAudioClip) => {
    const previewData = clip.playableBytes ?? clip.audioBytes;
    const blob = new Blob([previewData], { type: 'audio/wav' });
    const objectUrl = URL.createObjectURL(blob);
    setClips((prev) => [
      ...prev,
      {
        ...clip,
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: clip.name.replace(/(\.[^.]+)?$/, ' (Copy)$1'),
        objectUrl,
      },
    ]);
  };

  const removeClip = (clipId: string) => {
    if (soloClipId === clipId) {
      stopAllPlayback();
    }
    setClips((prev) => {
      const found = prev.find((c) => c.id === clipId);
      if (found) URL.revokeObjectURL(found.objectUrl);
      return prev.filter((c) => c.id !== clipId);
    });
  };

  const handleToggleSoloClip = (clip: StudioAudioClip) => {
    if (soloClipId === clip.id) {
      stopAllPlayback();
      return;
    }
    stopAllPlayback();
    setSelectedClipId(clip.id);
    const startSec = clip.trimStartSec;
    const endSec = Math.max(startSec + 0.25, clip.trimEndSec);
    const audio = new Audio(clip.objectUrl);
    soloAudioRef.current = audio;
    audio.currentTime = startSec;
    audio.volume = Math.min(1, Math.max(0.05, dbToLinearGain(clip.gainDb)));
    setSoloClipId(clip.id);
    setSoloPlayheadSec(startSec);

    const wallStartMs = performance.now();
    soloTimerRef.current = window.setInterval(() => {
      const elapsedSec = (performance.now() - wallStartMs) / 1000;
      const curSec =
        !audio.paused && audio.currentTime >= startSec
          ? audio.currentTime
          : startSec + elapsedSec;
      if (curSec >= endSec) {
        stopAllPlayback();
      } else {
        setSoloPlayheadSec(curSec);
      }
    }, 40);

    audio.ontimeupdate = () => {
      if (audio.currentTime >= endSec) {
        stopAllPlayback();
      }
    };
    audio.onended = () => stopAllPlayback();
    void audio.play().catch(() => {
      // Keep visual preview playhead active if headless browser audio output is muted
    });
  };

  const handleToggleArrangementPlayback = async () => {
    if (isPlayingArrangement) {
      stopAllPlayback();
      return;
    }
    if (timeline.placedClips.length === 0) return;

    stopAllPlayback();
    setIsPlayingArrangement(true);
    const totalDur = timeline.totalDurationSec;
    const wallStartMs = performance.now();

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const baseNow = ctx.currentTime + 0.05;

        for (const placed of timeline.placedClips) {
          const sourceClip = clips.find((c) => c.id === placed.id);
          if (!sourceClip) continue;
          const decoded = await ctx.decodeAudioData(
            (sourceClip.playableBytes ?? sourceClip.audioBytes).slice(0)
          );
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          const gainNode = ctx.createGain();
          const targetGain = dbToLinearGain(placed.gainDb);

          const startAt = baseNow + placed.timelineStartSec;
          const endAt = baseNow + placed.timelineEndSec;

          if (placed.fadeInSec > 0.02) {
            gainNode.gain.setValueAtTime(0.001, startAt);
            gainNode.gain.linearRampToValueAtTime(
              targetGain,
              startAt + placed.fadeInSec
            );
          } else {
            gainNode.gain.setValueAtTime(targetGain, startAt);
          }

          if (placed.fadeOutSec > 0.02) {
            gainNode.gain.setValueAtTime(
              targetGain,
              Math.max(startAt, endAt - placed.fadeOutSec)
            );
            gainNode.gain.linearRampToValueAtTime(0.001, endAt);
          }

          src.connect(gainNode);
          gainNode.connect(ctx.destination);
          src.start(startAt, placed.trimStartSec, placed.activeDurationSec);
        }
      } catch {
        // Playhead timer below still animates timeline accurately
      }
    }

    playheadTimerRef.current = window.setInterval(() => {
      const elapsedSec = (performance.now() - wallStartMs) / 1000;
      if (elapsedSec >= totalDur) {
        stopAllPlayback();
      } else {
        setPlayheadSec(elapsedSec);
      }
    }, 60);
  };

  const batchSummary = useMemo(
    () => summarizeBatchVideoQueue(queuedVideos),
    [queuedVideos]
  );

  const compileClipsArray = useCallback(
    async (
      targetClips: StudioAudioClip[],
      mode: TransitionMode,
      targetOutputName: string,
      targetFormat: StudioAudioFormat
    ) => {
      const spec = STUDIO_AUDIO_FORMATS[targetFormat];
      if (targetClips.length === 0) {
        setEditorError(
          'Add at least one audio clip or converted video to the timeline before compiling.'
        );
        return;
      }
      if (targetClips.length > 12) {
        setEditorError(
          'A single compilation supports up to 12 clips. Remove extra clips before compiling.'
        );
        return;
      }
      stopAllPlayback();
      setCompiling(true);
      setEditorError(null);
      try {
        const expectedTimeline = computeTimelineLayout(targetClips, mode);

        const postCompileRequest = async (forceFreshUpload: boolean) => {
          const uploadedIds = await Promise.all(
            targetClips.map(async (c) => {
              if (forceFreshUpload) {
                invalidateStudioUploadId(c.audioBytes);
              }
              return ensureStudioUploadId(
                c.audioBytes,
                c.name,
                forceFreshUpload
              );
            })
          );

          const payload = {
            outputName: targetOutputName,
            outputFormat: targetFormat,
            bitrate: outputBitrate,
            transitionMode: mode,
            tracks: targetClips.map((c, idx) => ({
              name: c.name,
              uploadId: uploadedIds[idx],
              trimStartSec: c.trimStartSec,
              trimEndSec: c.trimEndSec,
              gainDb: c.gainDb,
              fadeInSec: c.fadeInSec,
              fadeOutSec: c.fadeOutSec,
            })),
          };

          return fetch('/api/compile-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        };

        let res = await postCompileRequest(false);
        if (res.status === 404) {
          res = await postCompileRequest(true);
        }

        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errJson.error || `Compilation failed (HTTP ${res.status})`
          );
        }

        const mergedDuration = Number(
          res.headers.get('X-Audio-Duration-Sec') ||
            expectedTimeline.totalDurationSec
        );
        const mergedBytes = await res.arrayBuffer();
        const mergedBlob = new Blob([mergedBytes], { type: spec.mimeType });
        const downloadUrl = URL.createObjectURL(mergedBlob);
        let previewUrl = downloadUrl;
        if (!spec.browserNativePlayable) {
          const prev = await fetchServerPreviewWav(
            mergedBytes,
            `${targetOutputName}.${spec.extension}`
          );
          if (prev) {
            previewUrl = URL.createObjectURL(
              new Blob([prev.wavBytes], { type: 'audio/wav' })
            );
          }
        }

        const safeFile = formatOutputTrackFilename(
          sanitizeDownloadFilename(targetOutputName),
          targetFormat
        );

        setCompiledMaster({
          name: safeFile,
          format: targetFormat,
          downloadUrl,
          previewUrl,
          sizeBytes: mergedBytes.byteLength,
          durationSec: mergedDuration,
          qualityLabel: spec.lossless
            ? `Lossless Stereo ${spec.label}`
            : `${outputBitrate} Stereo ${spec.label}`,
        });

        triggerDownloadUrl(downloadUrl, safeFile);
      } catch (err) {
        setEditorError(
          err instanceof Error
            ? err.message
            : `Unable to compile clips into ${spec.label}.`
        );
      } finally {
        setCompiling(false);
      }
    },
    [outputBitrate, stopAllPlayback]
  );

  const handleCompileMergedMp3 = async () => {
    await compileClipsArray(clips, transitionMode, outputName, outputFormat);
  };

  const handleAddBatchVideoFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setEditorError(null);
    const additions: QueuedStudioVideo[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size === 0) continue;
      if (file.size > 45 * 1024 * 1024) {
        setEditorError(
          `Skipped ${file.name}: video exceeds 45 MB per-file conversion limit.`
        );
        continue;
      }
      additions.push({
        id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        fileName: file.name,
        fileSizeBytes: file.size,
        status: 'queued',
      });
    }
    if (additions.length > 0) {
      setQueuedVideos((prev) => [...prev, ...additions]);
    }
  };

  const handleLoadSampleBatchVideos = async () => {
    setLoadingBatchSamples(true);
    setEditorError(null);
    try {
      const [resA, resB] = await Promise.all([
        fetch('/api/sample-video?kind=original&preset=guzheng_rain_lofi'),
        fetch('/api/sample-video?kind=original&preset=yunnan_handpan_echo'),
      ]);
      if (!resA.ok || !resB.ok) {
        throw new Error('Failed to load studio sample videos.');
      }
      const [blobA, blobB] = await Promise.all([resA.blob(), resB.blob()]);
      const fileA = new File([blobA], 'studio-guzheng-take-1.mp4', {
        type: 'video/mp4',
      });
      const fileB = new File([blobB], 'studio-handpan-take-2.mp4', {
        type: 'video/mp4',
      });
      setQueuedVideos((prev) => [
        ...prev,
        {
          id: `vid-${Date.now()}-a`,
          file: fileA,
          fileName: fileA.name,
          fileSizeBytes: fileA.size,
          status: 'queued',
        },
        {
          id: `vid-${Date.now()}-b`,
          file: fileB,
          fileName: fileB.name,
          fileSizeBytes: fileB.size,
          status: 'queued',
        },
      ]);
    } catch (err) {
      setEditorError(
        err instanceof Error
          ? err.message
          : 'Unable to load sample studio videos.'
      );
    } finally {
      setLoadingBatchSamples(false);
    }
  };

  const removeQueuedVideo = (videoId: string) => {
    setQueuedVideos((prev) => prev.filter((item) => item.id !== videoId));
  };

  const handleConvertAndMaybeCompileVideos = async (autoCompileAfter: boolean) => {
    const pendingItems = queuedVideos.filter(
      (item) => item.status === 'queued' || item.status === 'error'
    );
    if (pendingItems.length === 0) {
      if (autoCompileAfter && clips.length > 0) {
        await compileClipsArray(clips, transitionMode, outputName, outputFormat);
      }
      return;
    }

    if (clips.length + pendingItems.length > 12) {
      setEditorError(
        `Timeline supports up to 12 clips total (${clips.length} currently loaded + ${pendingItems.length} queued). Remove extra items first.`
      );
      return;
    }

    setBatchConverting(true);
    setEditorError(null);
    const batchSpec = STUDIO_AUDIO_FORMATS[batchVideoFormat];
    const newlyConvertedClips: StudioAudioClip[] = [];

    for (const item of pendingItems) {
      setQueuedVideos((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'converting', error: undefined }
            : q
        )
      );

      try {
        const params = new URLSearchParams({
          format: batchVideoFormat,
          bitrate: batchVideoBitrate,
        });
        const bodyBuf = await item.file.arrayBuffer();
        const postBatchConvert = async (forceFresh: boolean) => {
          const reqParams = new URLSearchParams(params);
          if (bodyBuf.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
            if (forceFresh) invalidateStudioUploadId(bodyBuf);
            const uploadId = await ensureStudioUploadId(
              bodyBuf,
              item.file.name,
              forceFresh
            );
            reqParams.set('uploadId', uploadId);
            return fetch(`/api/convert-media?${reqParams.toString()}`, {
              method: 'POST',
              headers: {
                'X-File-Name': encodeURIComponent(item.file.name),
              },
            });
          }
          return fetch(`/api/convert-media?${reqParams.toString()}`, {
            method: 'POST',
            headers: {
              'Content-Type': item.file.type || 'video/mp4',
              'X-File-Name': encodeURIComponent(item.file.name),
            },
            body: bodyBuf,
          });
        };

        let res = await postBatchConvert(false);
        if (res.status === 404 && bodyBuf.byteLength > STUDIO_CHUNK_SIZE_BYTES) {
          res = await postBatchConvert(true);
        }

        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errJson.error || `Conversion failed (HTTP ${res.status})`
          );
        }

        const durationHeader = Number(
          res.headers.get('X-Audio-Duration-Sec') || 6
        );
        const extractedBytes = await res.arrayBuffer();
        const trackName = deriveAudioTrackName(
          item.fileName,
          batchSpec.extension
        );
        const { durationSec, peaks, playableBytes, playableMime } =
          await decodeAudioPeaksAndDuration(
            extractedBytes,
            durationHeader > 0 ? durationHeader : 6,
            trackName
          );
        const blob = new Blob([playableBytes], { type: playableMime });
        const objectUrl = URL.createObjectURL(blob);

        const newClip: StudioAudioClip = {
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: trackName,
          audioBytes: extractedBytes,
          playableBytes,
          objectUrl,
          peaks,
          sourceDurationSec: durationSec,
          trimStartSec: 0,
          trimEndSec: durationSec,
          gainDb: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
        };

        newlyConvertedClips.push(newClip);
        setClips((prev) => [...prev, newClip]);
        setSelectedClipId(newClip.id);

        setQueuedVideos((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'converted',
                  convertedMp3Name: trackName,
                  durationSec,
                }
              : q
          )
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : `Unable to convert video to ${batchSpec.label}.`;
        setQueuedVideos((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'error', error: message } : q
          )
        );
      }
    }

    setBatchConverting(false);

    if (autoCompileAfter) {
      const combinedClips = [...clipsRef.current];
      const existingIds = new Set(combinedClips.map((c) => c.id));
      for (const nc of newlyConvertedClips) {
        if (!existingIds.has(nc.id)) {
          combinedClips.push(nc);
        }
      }
      if (combinedClips.length > 0) {
        await compileClipsArray(
          combinedClips,
          transitionMode,
          outputName,
          outputFormat
        );
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* SECTION 01: MULTI-FORMAT AUDIO & VIDEO CONVERTER */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              01. Audio &amp; Video Studio Converter
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Convert any video (MP4, MOV, WebM, MKV) or audio file into WAV,
              MP3, M4A, FLAC, AIFF, or WMA. Download the converted master file
              immediately or send it straight into the Multi-Audio Editor below.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loadingSampleVideo || converting}
              onClick={() => void handleLoadSampleVideo()}
              className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {loadingSampleVideo
                ? 'Loading Video...'
                : 'Load Sample Studio Video (.mp4)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end pt-1">
          <div className="lg:col-span-4 space-y-1.5">
            <label
              htmlFor="studio-video-file-input"
              className="block text-xs font-semibold text-slate-800"
            >
              Source Video or Audio File
            </label>
            <input
              ref={videoInputRef}
              id="studio-video-file-input"
              type="file"
              accept="video/*,audio/*,.wav,.mp3,.m4a,.flac,.aiff,.aif,.wma"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setVideoFile(f);
                  setConverterError(null);
                }
              }}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 truncate font-medium">
                <Upload className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {videoFile
                    ? `${videoFile.name} (${formatFileSize(videoFile.size)})`
                    : 'Choose video or audio (WAV/MP3/M4A/FLAC/AIFF/WMA)...'}
                </span>
              </span>
              <span className="text-sky-700 font-semibold shrink-0">Browse</span>
            </button>
          </div>

          <div className="lg:col-span-2 space-y-1.5">
            <label
              htmlFor="converter-format-select"
              className="block text-xs font-semibold text-slate-800"
            >
              Output Format
            </label>
            <select
              id="converter-format-select"
              value={converterFormat}
              onChange={(e) =>
                setConverterFormat(e.target.value as StudioAudioFormat)
              }
              className="w-full px-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              {STUDIO_AUDIO_FORMAT_ORDER.map((fmt) => {
                const spec = STUDIO_AUDIO_FORMATS[fmt];
                return (
                  <option key={fmt} value={fmt}>
                    {spec.label} ({spec.lossless ? 'Lossless' : 'Compressed'})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="lg:col-span-2 space-y-1.5">
            <label
              htmlFor="mp3-bitrate-select"
              className="block text-xs font-semibold text-slate-800"
            >
              Quality / Bitrate
            </label>
            <select
              id="mp3-bitrate-select"
              value={mp3Bitrate}
              disabled={STUDIO_AUDIO_FORMATS[converterFormat].lossless}
              onChange={(e) =>
                setMp3Bitrate(e.target.value as StudioAudioBitrate)
              }
              className="w-full px-3 py-2.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-60"
            >
              {STUDIO_AUDIO_FORMATS[converterFormat].lossless ? (
                <option value={mp3Bitrate}>
                  Lossless 44.1 kHz
                </option>
              ) : (
                <>
                  <option value="128k">128 kbps (Standard)</option>
                  <option value="192k">192 kbps (Studio)</option>
                  <option value="320k">320 kbps (Master)</option>
                </>
              )}
            </select>
          </div>

          <div className="lg:col-span-2 grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label
                htmlFor="video-trim-start"
                className="block text-xs font-semibold text-slate-800"
              >
                Start (s)
              </label>
              <input
                id="video-trim-start"
                type="number"
                min="0"
                step="0.5"
                value={videoTrimStart}
                onChange={(e) => setVideoTrimStart(e.target.value)}
                className="w-full px-2.5 py-2.5 text-xs font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="video-trim-end"
                className="block text-xs font-semibold text-slate-800"
              >
                End (s)
              </label>
              <input
                id="video-trim-end"
                type="number"
                min="0"
                step="0.5"
                placeholder="Full"
                value={videoTrimEnd}
                onChange={(e) => setVideoTrimEnd(e.target.value)}
                className="w-full px-2.5 py-2.5 text-xs font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <button
              type="button"
              disabled={converting}
              onClick={() => void handleConvertVideoToMp3()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {converting
                  ? `Converting...`
                  : `Convert to ${STUDIO_AUDIO_FORMATS[converterFormat].label}`}
              </span>
            </button>
          </div>
        </div>

        {converterError && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
          >
            {converterError}
          </div>
        )}

        {convertedMp3 && (
          <div
            data-testid="converted-audio-output"
            className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-sky-700" aria-hidden="true" />
                <span>{convertedMp3.name}</span>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-500">
                {formatPreciseTimecode(convertedMp3.durationSec)} ·{' '}
                {formatFileSize(convertedMp3.bytes.byteLength)} ·{' '}
                {convertedMp3.qualityLabel}
              </div>
            </div>

            <audio
              src={convertedMp3.previewUrl}
              controls
              className="h-9 w-full lg:w-72"
            />

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  triggerDownloadUrl(convertedMp3.downloadUrl, convertedMp3.name)
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download {STUDIO_AUDIO_FORMATS[convertedMp3.format].label}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void appendAudioBytesAsClip(
                    convertedMp3.name,
                    convertedMp3.bytes,
                    convertedMp3.durationSec
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-300 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add to Audio Editor Timeline</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 02: MULTI-FORMAT AUDIO EDITOR & COMPILER */}
      <section
        id="mp3-compiler-section"
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="space-y-1 max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              02. Multi-Format Audio Editor &amp; Compiler
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Upload multiple WAV, MP3, M4A, FLAC, AIFF, or WMA tracks — or add
              multiple videos to convert automatically — then trim, balance
              gain, generate 3,000×3,000 JPG cover art, and compile into any
              studio audio format.
            </p>
          </div>

          <div className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
            {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · Total{' '}
            <span className="font-bold text-slate-900">
              {formatPreciseTimecode(timeline.totalDurationSec)}
            </span>
          </div>
        </div>

        {/* Editor Import & Mastering Controls Bar */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div>
              <input
                ref={mp3FilesInputRef}
                id="editor-mp3-files-input"
                type="file"
                accept=".wav,.mp3,.m4a,.flac,.aiff,.aif,.wma,audio/*"
                multiple
                onChange={(e) => {
                  void handleUploadMp3Files(e.target.files);
                  e.target.value = '';
                }}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => mp3FilesInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Upload Audio (WAV/MP3/M4A/FLAC/AIFF/WMA)</span>
              </button>
            </div>

            <div>
              <input
                ref={batchVideoInputRef}
                id="editor-multi-video-input"
                type="file"
                accept="video/*,.mp4,.mov,.webm,.mkv"
                multiple
                onChange={(e) => {
                  handleAddBatchVideoFiles(e.target.files);
                  e.target.value = '';
                }}
                className="sr-only"
              />
              <button
                type="button"
                disabled={batchConverting || compiling}
                onClick={() => batchVideoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Multiple Videos</span>
              </button>
            </div>

            <button
              type="button"
              disabled={loadingBatchSamples || batchConverting || compiling}
              onClick={() => void handleLoadSampleBatchVideos()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <span>
                {loadingBatchSamples
                  ? 'Loading Sample Videos...'
                  : 'Load 2 Sample Videos'}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor="transition-mode-select"
                className="block text-xs font-medium text-slate-600"
              >
                Clip Transition
              </label>
              <select
                id="transition-mode-select"
                value={transitionMode}
                onChange={(e) =>
                  setTransitionMode(e.target.value as TransitionMode)
                }
                className="px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="seamless">Seamless Join (0.0s)</option>
                <option value="gap_0_5s">Studio Gap (+0.5s Silence)</option>
                <option value="crossfade_1s">Smooth Crossfade (1.0s)</option>
                <option value="crossfade_2s">Long Crossfade (2.0s)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="compiled-output-format"
                className="block text-xs font-medium text-slate-600"
              >
                Compile Format
              </label>
              <select
                id="compiled-output-format"
                value={outputFormat}
                onChange={(e) =>
                  setOutputFormat(e.target.value as StudioAudioFormat)
                }
                className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              >
                {STUDIO_AUDIO_FORMAT_ORDER.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {STUDIO_AUDIO_FORMATS[fmt].label} (.{STUDIO_AUDIO_FORMATS[fmt].extension})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="compiled-output-bitrate"
                className="block text-xs font-medium text-slate-600"
              >
                Compile Bitrate
              </label>
              <select
                id="compiled-output-bitrate"
                value={outputBitrate}
                disabled={STUDIO_AUDIO_FORMATS[outputFormat].lossless}
                onChange={(e) =>
                  setOutputBitrate(e.target.value as StudioAudioBitrate)
                }
                className="px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 disabled:opacity-60"
              >
                {STUDIO_AUDIO_FORMATS[outputFormat].lossless ? (
                  <option value={outputBitrate}>Lossless 44.1 kHz</option>
                ) : (
                  <>
                    <option value="128k">128 kbps</option>
                    <option value="192k">192 kbps</option>
                    <option value="320k">320 kbps</option>
                  </>
                )}
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="compiled-output-name"
                className="block text-xs font-medium text-slate-600"
              >
                Merged Song Name
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="compiled-output-name"
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 w-44"
                />
                <button
                  type="button"
                  onClick={() => {
                    const nextName = generateRandomSongSlug(outputName);
                    setOutputName(nextName);
                    setCompiledMaster((prev) =>
                      prev
                        ? {
                            ...prev,
                            name: formatOutputTrackFilename(
                              sanitizeDownloadFilename(nextName),
                              prev.format
                            ),
                          }
                        : prev
                    );
                  }}
                  aria-label="Generate random song name for compiled track"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Dices className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                  <span>Generate Name</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Video Batch Conversion Queue */}
        {queuedVideos.length > 0 && (
          <div
            data-testid="batch-video-queue"
            className="border border-slate-200 rounded-xl bg-slate-50/70 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                  <span>Video-to-Audio Batch Queue ({queuedVideos.length})</span>
                </h3>
                <p className="text-xs font-mono tabular-nums text-slate-500">
                  {batchSummary.queued} queued · {batchSummary.converted} converted
                  {batchSummary.error > 0 ? ` · ${batchSummary.error} error` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Batch video conversion audio format"
                  value={batchVideoFormat}
                  disabled={batchConverting}
                  onChange={(e) =>
                    setBatchVideoFormat(e.target.value as StudioAudioFormat)
                  }
                  className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  {STUDIO_AUDIO_FORMAT_ORDER.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {STUDIO_AUDIO_FORMATS[fmt].label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Batch video conversion audio bitrate"
                  value={batchVideoBitrate}
                  disabled={
                    batchConverting ||
                    STUDIO_AUDIO_FORMATS[batchVideoFormat].lossless
                  }
                  onChange={(e) =>
                    setBatchVideoBitrate(e.target.value as StudioAudioBitrate)
                  }
                  className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-900 disabled:opacity-60"
                >
                  {STUDIO_AUDIO_FORMATS[batchVideoFormat].lossless ? (
                    <option value={batchVideoBitrate}>Lossless</option>
                  ) : (
                    <>
                      <option value="128k">128 kbps</option>
                      <option value="192k">192 kbps</option>
                      <option value="320k">320 kbps</option>
                    </>
                  )}
                </select>

                <button
                  type="button"
                  disabled={batchConverting || compiling}
                  onClick={() => setQueuedVideos([])}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  Clear Queue
                </button>

                <button
                  type="button"
                  disabled={
                    batchConverting ||
                    compiling ||
                    batchSummary.queued + batchSummary.error === 0
                  }
                  onClick={() => void handleConvertAndMaybeCompileVideos(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Scissors className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                  <span>
                    {batchConverting
                      ? 'Converting Videos...'
                      : `Convert Videos to ${STUDIO_AUDIO_FORMATS[batchVideoFormat].label}`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={
                    batchConverting ||
                    compiling ||
                    (batchSummary.queued + batchSummary.error === 0 &&
                      clips.length === 0)
                  }
                  onClick={() => void handleConvertAndMaybeCompileVideos(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {batchConverting
                      ? 'Converting & Compiling...'
                      : compiling
                      ? `Compiling Master ${STUDIO_AUDIO_FORMATS[outputFormat].label}...`
                      : `Convert & Compile All into 1 ${STUDIO_AUDIO_FORMATS[outputFormat].label}`}
                  </span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200 border-t border-slate-200">
              {queuedVideos.map((item, idx) => (
                <div
                  key={item.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono tabular-nums font-bold text-slate-500">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <span className="font-medium text-slate-900 truncate max-w-xs sm:max-w-sm">
                      {item.fileName}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      · {formatFileSize(item.fileSizeBytes)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {item.status === 'queued' && (
                      <span className="text-slate-600 whitespace-nowrap">
                        Queued for MP3 extraction
                      </span>
                    )}
                    {item.status === 'converting' && (
                      <span className="text-sky-700 font-medium whitespace-nowrap">
                        Converting to MP3...
                      </span>
                    )}
                    {item.status === 'converted' && (
                      <span className="inline-flex items-center gap-1 text-teal-800 font-medium whitespace-nowrap font-mono tabular-nums">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          Added {item.convertedMp3Name} (
                          {formatPreciseTimecode(item.durationSec ?? 0)})
                        </span>
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{item.error || 'Conversion failed'}</span>
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={item.status === 'converting'}
                      onClick={() => removeQueuedVideo(item.id)}
                      aria-label={`Remove queued video ${item.fileName}`}
                      className="p-1 text-slate-400 hover:text-rose-700 rounded hover:bg-rose-50 cursor-pointer disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {editorError && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
          >
            {editorError}
          </div>
        )}

        {/* Master Arrangement Timeline Ruler & Transport */}
        {clips.length > 0 && (
          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleToggleArrangementPlayback()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-white text-slate-900 rounded-md hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isPlayingArrangement ? (
                    <>
                      <Square className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                      <span>Stop Arrangement</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                      <span>Play Arrangement</span>
                    </>
                  )}
                </button>
                <span className="font-mono tabular-nums text-xs text-slate-300">
                  {formatPreciseTimecode(playheadSec)} /{' '}
                  {formatPreciseTimecode(timeline.totalDurationSec)}
                </span>
              </div>

              <button
                type="button"
                disabled={compiling || clips.length === 0}
                onClick={() => void handleCompileMergedMp3()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-500 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {compiling
                    ? `Compiling Merged ${STUDIO_AUDIO_FORMATS[outputFormat].label}...`
                    : `Compile & Download Merged ${STUDIO_AUDIO_FORMATS[outputFormat].label} (${clips.length})`}
                </span>
              </button>
            </div>

            {/* Proportional Sequence Canvas */}
            <ArrangementTimelineCanvas
              placedClips={timeline.placedClips}
              totalDurationSec={timeline.totalDurationSec}
              playheadSec={playheadSec}
              isPlaying={isPlayingArrangement}
            />
          </div>
        )}

        {/* Interactive Visual Audio Trimmer for the Active Clip */}
        {clips.length > 0 && (() => {
          const activeIndex = Math.max(
            0,
            clips.findIndex((c) => c.id === selectedClipId)
          );
          const activeClip = clips[activeIndex];
          if (!activeClip) return null;
          return (
            <VisualAudioTrimmer
              clips={clips}
              selectedClip={activeClip}
              selectedIndex={activeIndex}
              soloClipId={soloClipId}
              soloPlayheadSec={soloPlayheadSec}
              onSelectClip={(id) => setSelectedClipId(id)}
              onUpdateTrim={(id, patch) => updateClip(id, patch)}
              onTogglePreview={(clipTarget) => {
                const full = clips.find((c) => c.id === clipTarget.id);
                if (full) handleToggleSoloClip(full);
              }}
            />
          );
        })()}

        {/* Empty Timeline State */}
        {clips.length === 0 ? (
          <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-3 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-900">
              Your multi-format audio compilation timeline is empty
            </h3>
            <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
              Add WAV, MP3, M4A, FLAC, AIFF, or WMA audio files — or select
              multiple videos to convert automatically — then trim and compile
              everything into one master file.
            </p>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => mp3FilesInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Select Audio Files to Compile</span>
              </button>
              <button
                type="button"
                onClick={() => batchVideoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-300 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Select Multiple Videos to Convert &amp; Compile</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            {clips.map((clip, idx) => {
              const placed = timeline.placedClips[idx];
              const isSoloPlaying = soloClipId === clip.id;
              const isSelectedForTrim =
                selectedClipId === clip.id ||
                (!selectedClipId && idx === 0);
              return (
                <div
                  key={clip.id}
                  className={`p-4 space-y-3 transition-colors ${
                    isSelectedForTrim ? 'bg-sky-50/45' : 'bg-white'
                  }`}
                >
                  {/* Clip Header & Reorder/Trim/Solo/Remove Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono tabular-nums text-xs font-bold text-slate-500">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {clip.name}
                      </span>
                      {placed && (
                        <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          · {formatPreciseTimecode(placed.timelineStartSec)} →{' '}
                          {formatPreciseTimecode(placed.timelineEndSec)} (
                          {formatPreciseTimecode(placed.activeDurationSec)})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedClipId(clip.id)}
                        aria-pressed={isSelectedForTrim}
                        aria-label={`Select ${clip.name} in visual trimmer`}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                          isSelectedForTrim
                            ? 'bg-sky-700 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        <Scissors className="w-3 h-3" aria-hidden="true" />
                        <span>{isSelectedForTrim ? 'Trimming' : 'Trim'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleSoloClip(clip)}
                        aria-label={
                          isSoloPlaying
                            ? `Stop preview for ${clip.name}`
                            : `Preview clip ${clip.name}`
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                      >
                        {isSoloPlaying ? (
                          <>
                            <Square className="w-3 h-3 text-sky-700" aria-hidden="true" />
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 text-sky-700" aria-hidden="true" />
                            <span>Clip Preview</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveClip(idx, -1)}
                        aria-label={`Move ${clip.name} earlier`}
                        className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-35 rounded-md hover:bg-slate-100 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === clips.length - 1}
                        onClick={() => moveClip(idx, 1)}
                        aria-label={`Move ${clip.name} later`}
                        className="p-1.5 text-slate-600 hover:text-slate-900 disabled:opacity-35 rounded-md hover:bg-slate-100 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateClip(clip)}
                        aria-label={`Duplicate ${clip.name}`}
                        className="p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeClip(clip.id)}
                        aria-label={`Remove ${clip.name}`}
                        className="p-1.5 text-slate-500 hover:text-rose-700 rounded-md hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Waveform Canvas */}
                  <ClipWaveformCanvas clip={clip} />

                  {/* Trim, Gain, and Fade Parameters */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="space-y-1">
                      <label
                        htmlFor={`trim-start-${clip.id}`}
                        className="block text-slate-600 font-medium"
                      >
                        Trim Start (s)
                      </label>
                      <input
                        id={`trim-start-${clip.id}`}
                        type="number"
                        min={0}
                        max={Math.max(0, clip.trimEndSec - 0.25)}
                        step={0.25}
                        value={clip.trimStartSec}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            trimStartSec: Number(e.target.value),
                          })
                        }
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`trim-end-${clip.id}`}
                        className="block text-slate-600 font-medium"
                      >
                        Trim End (s)
                      </label>
                      <input
                        id={`trim-end-${clip.id}`}
                        type="number"
                        min={clip.trimStartSec + 0.25}
                        max={clip.sourceDurationSec}
                        step={0.25}
                        value={clip.trimEndSec}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            trimEndSec: Number(e.target.value),
                          })
                        }
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`gain-${clip.id}`}
                        className="block text-slate-600 font-medium"
                      >
                        Volume ({clip.gainDb >= 0 ? `+${clip.gainDb}` : clip.gainDb} dB)
                      </label>
                      <input
                        id={`gain-${clip.id}`}
                        type="range"
                        min={-18}
                        max={6}
                        step={0.5}
                        value={clip.gainDb}
                        onChange={(e) =>
                          updateClip(clip.id, { gainDb: Number(e.target.value) })
                        }
                        className="w-full accent-sky-700 mt-2"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`fade-in-${clip.id}`}
                        className="block text-slate-600 font-medium"
                      >
                        Fade In (s)
                      </label>
                      <input
                        id={`fade-in-${clip.id}`}
                        type="number"
                        min={0}
                        max={5}
                        step={0.25}
                        value={clip.fadeInSec}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            fadeInSec: Number(e.target.value),
                          })
                        }
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`fade-out-${clip.id}`}
                        className="block text-slate-600 font-medium"
                      >
                        Fade Out (s)
                      </label>
                      <input
                        id={`fade-out-${clip.id}`}
                        type="number"
                        min={0}
                        max={5}
                        step={0.25}
                        value={clip.fadeOutSec}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            fadeOutSec: Number(e.target.value),
                          })
                        }
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Compiled Master Output Result */}
        {compiledMaster && (
          <div className="p-4 bg-teal-50/80 border border-teal-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-teal-950">
                Compiled Master Ready: {compiledMaster.name}
              </div>
              <div className="text-xs font-mono tabular-nums text-teal-800">
                {formatPreciseTimecode(compiledMaster.durationSec)} ·{' '}
                {formatFileSize(compiledMaster.sizeBytes)} ·{' '}
                {compiledMaster.qualityLabel}
              </div>
            </div>

            <audio
              src={compiledMaster.previewUrl}
              controls
              className="h-9 w-full lg:w-80"
            />

            <button
              type="button"
              onClick={() =>
                triggerDownloadUrl(
                  compiledMaster.downloadUrl,
                  compiledMaster.name
                )
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Download Merged {STUDIO_AUDIO_FORMATS[compiledMaster.format].label}
              </span>
            </button>
          </div>
        )}

        {/* Distribution Cover Art Studio (3,000 x 3,000 px Square JPG, Zero AI Credits) */}
        <CoverArtPanel
          songSlug={outputName}
          waveformPeaks={
            clips.find((c) => c.id === selectedClipId)?.peaks ??
            clips[0]?.peaks ??
            []
          }
        />
      </section>
    </div>
  );
}
