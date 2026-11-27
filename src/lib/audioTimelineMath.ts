export interface EditorClipTiming {
  id: string;
  name: string;
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface TimelinePlacedClip extends EditorClipTiming {
  activeDurationSec: number;
  timelineStartSec: number;
  timelineEndSec: number;
}

export interface TimelineSummary {
  placedClips: TimelinePlacedClip[];
  totalDurationSec: number;
  transitionMode: TransitionMode;
}

export type TransitionMode =
  | 'seamless'
  | 'gap_0_5s'
  | 'crossfade_1s'
  | 'crossfade_2s';

const MIN_CLIP_LEN_SEC = 0.25;

export function sanitizeClipTiming(clip: EditorClipTiming): EditorClipTiming {
  const sourceDurationSec = Math.max(
    MIN_CLIP_LEN_SEC,
    Number.isFinite(clip.sourceDurationSec) ? clip.sourceDurationSec : 1
  );

  let trimStartSec = Number.isFinite(clip.trimStartSec) ? clip.trimStartSec : 0;
  trimStartSec = Math.max(0, Math.min(trimStartSec, sourceDurationSec - MIN_CLIP_LEN_SEC));

  let trimEndSec = Number.isFinite(clip.trimEndSec)
    ? clip.trimEndSec
    : sourceDurationSec;
  trimEndSec = Math.max(
    trimStartSec + MIN_CLIP_LEN_SEC,
    Math.min(trimEndSec, sourceDurationSec)
  );

  const activeLen = trimEndSec - trimStartSec;
  const maxFade = Math.min(5, activeLen / 2);

  const fadeInSec = Math.max(
    0,
    Math.min(Number.isFinite(clip.fadeInSec) ? clip.fadeInSec : 0, maxFade)
  );
  const fadeOutSec = Math.max(
    0,
    Math.min(Number.isFinite(clip.fadeOutSec) ? clip.fadeOutSec : 0, maxFade)
  );

  const gainDb = Math.max(
    -24,
    Math.min(12, Number.isFinite(clip.gainDb) ? clip.gainDb : 0)
  );

  return {
    ...clip,
    sourceDurationSec: Number(sourceDurationSec.toFixed(2)),
    trimStartSec: Number(trimStartSec.toFixed(2)),
    trimEndSec: Number(trimEndSec.toFixed(2)),
    gainDb: Number(gainDb.toFixed(1)),
    fadeInSec: Number(fadeInSec.toFixed(2)),
    fadeOutSec: Number(fadeOutSec.toFixed(2)),
  };
}

export function getTransitionOffsetSec(mode: TransitionMode): number {
  switch (mode) {
    case 'gap_0_5s':
      return 0.5;
    case 'crossfade_1s':
      return -1.0;
    case 'crossfade_2s':
      return -2.0;
    case 'seamless':
    default:
      return 0;
  }
}

export function computeTimelineLayout(
  clips: EditorClipTiming[],
  transitionMode: TransitionMode
): TimelineSummary {
  if (clips.length === 0) {
    return {
      placedClips: [],
      totalDurationSec: 0,
      transitionMode,
    };
  }

  const rawOffset = getTransitionOffsetSec(transitionMode);
  const placedClips: TimelinePlacedClip[] = [];
  let cursorSec = 0;

  for (let i = 0; i < clips.length; i++) {
    const clean = sanitizeClipTiming(clips[i]);
    const activeDurationSec = Number(
      (clean.trimEndSec - clean.trimStartSec).toFixed(2)
    );

    if (i > 0) {
      const prev = placedClips[i - 1];
      if (rawOffset < 0) {
        // Crossfade overlap cannot exceed half of either adjacent clip
        const maxOverlap = Math.min(
          Math.abs(rawOffset),
          prev.activeDurationSec * 0.45,
          activeDurationSec * 0.45
        );
        cursorSec = Math.max(0, prev.timelineEndSec - maxOverlap);
      } else {
        cursorSec = prev.timelineEndSec + rawOffset;
      }
    }

    const timelineStartSec = Number(cursorSec.toFixed(2));
    const timelineEndSec = Number((timelineStartSec + activeDurationSec).toFixed(2));

    placedClips.push({
      ...clean,
      activeDurationSec,
      timelineStartSec,
      timelineEndSec,
    });
  }

  const totalDurationSec =
    placedClips.length > 0
      ? placedClips[placedClips.length - 1].timelineEndSec
      : 0;

  return {
    placedClips,
    totalDurationSec: Number(totalDurationSec.toFixed(2)),
    transitionMode,
  };
}

export function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

export function formatPreciseTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  const wholeSec = Math.floor(rem);
  const tenths = Math.floor((rem - wholeSec + 1e-6) * 10);
  return `${String(mins).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${tenths}`;
}

export type TrimmerDragTarget = 'start' | 'end' | 'window';

export interface TrimmerDragParams {
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  target: TrimmerDragTarget;
  pointerSec: number;
  grabOffsetSec?: number;
  initialWindowSpanSec?: number;
}

function roundToStep(value: number, step = 0.05): number {
  return Number((Math.round(value / step) * step).toFixed(2));
}

export function detectTrimmerHitTarget(params: {
  pointerRatio: number;
  startRatio: number;
  endRatio: number;
  edgeToleranceRatio?: number;
}): { target: TrimmerDragTarget; jumpImmediately: boolean } {
  const pointerRatio = Math.max(0, Math.min(1, params.pointerRatio));
  const startRatio = Math.max(0, Math.min(1, params.startRatio));
  const endRatio = Math.max(startRatio, Math.min(1, params.endRatio));
  const tol = params.edgeToleranceRatio ?? 0.025;

  const distStart = Math.abs(pointerRatio - startRatio);
  const distEnd = Math.abs(pointerRatio - endRatio);

  if (distStart <= tol && distStart <= distEnd) {
    return { target: 'start', jumpImmediately: false };
  }
  if (distEnd <= tol) {
    return { target: 'end', jumpImmediately: false };
  }
  if (pointerRatio > startRatio && pointerRatio < endRatio) {
    return { target: 'window', jumpImmediately: false };
  }
  if (pointerRatio < startRatio) {
    return { target: 'start', jumpImmediately: true };
  }
  return { target: 'end', jumpImmediately: true };
}

export function computeTrimmerDragUpdate(
  params: TrimmerDragParams
): { trimStartSec: number; trimEndSec: number } {
  const sourceDur = Math.max(
    MIN_CLIP_LEN_SEC,
    Number.isFinite(params.sourceDurationSec) ? params.sourceDurationSec : 1
  );
  const safePointer = Math.max(
    0,
    Math.min(sourceDur, Number.isFinite(params.pointerSec) ? params.pointerSec : 0)
  );
  const curStart = Math.max(0, Math.min(params.trimStartSec, sourceDur - MIN_CLIP_LEN_SEC));
  const curEnd = Math.max(curStart + MIN_CLIP_LEN_SEC, Math.min(params.trimEndSec, sourceDur));

  if (params.target === 'start') {
    const maxStart = Math.max(0, curEnd - MIN_CLIP_LEN_SEC);
    const nextStart = Math.max(0, Math.min(maxStart, roundToStep(safePointer)));
    return {
      trimStartSec: Number(nextStart.toFixed(2)),
      trimEndSec: Number(curEnd.toFixed(2)),
    };
  }

  if (params.target === 'end') {
    const minEnd = Math.min(sourceDur, curStart + MIN_CLIP_LEN_SEC);
    const nextEnd = Math.max(minEnd, Math.min(sourceDur, roundToStep(safePointer)));
    return {
      trimStartSec: Number(curStart.toFixed(2)),
      trimEndSec: Number(nextEnd.toFixed(2)),
    };
  }

  const span = Math.max(
    MIN_CLIP_LEN_SEC,
    Math.min(sourceDur, params.initialWindowSpanSec ?? curEnd - curStart)
  );
  const offset = Number.isFinite(params.grabOffsetSec)
    ? (params.grabOffsetSec as number)
    : span / 2;
  const maxStart = Math.max(0, sourceDur - span);
  const nextStart = Math.max(0, Math.min(maxStart, roundToStep(safePointer - offset)));
  const nextEnd = Math.min(sourceDur, nextStart + span);

  return {
    trimStartSec: Number(nextStart.toFixed(2)),
    trimEndSec: Number(nextEnd.toFixed(2)),
  };
}

export type BatchVideoQueueStatus =
  | 'queued'
  | 'converting'
  | 'converted'
  | 'error';

export interface BatchVideoQueueItem {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  status: BatchVideoQueueStatus;
  error?: string;
  convertedMp3Name?: string;
  durationSec?: number;
}

export function deriveAudioTrackName(
  sourceFileName: string,
  extension = 'mp3'
): string {
  const cleaned = sourceFileName.trim().replace(/[\\/]+/g, '-');
  const safeExt = extension.replace(/^\./, '').toLowerCase() || 'mp3';
  if (!cleaned) return `converted-video.${safeExt}`;
  const stripped = cleaned.replace(/\.[^.]+$/, '');
  return `${stripped || 'converted-video'}.${safeExt}`;
}

export function deriveMp3TrackName(videoFileName: string): string {
  return deriveAudioTrackName(videoFileName, 'mp3');
}

export function summarizeBatchVideoQueue(
  items: Pick<BatchVideoQueueItem, 'status'>[]
): {
  total: number;
  queued: number;
  converting: number;
  converted: number;
  error: number;
} {
  let queued = 0;
  let converting = 0;
  let converted = 0;
  let error = 0;
  for (const item of items) {
    if (item.status === 'queued') queued++;
    else if (item.status === 'converting') converting++;
    else if (item.status === 'converted') converted++;
    else if (item.status === 'error') error++;
  }
  return {
    total: items.length,
    queued,
    converting,
    converted,
    error,
  };
}

const SONG_NAME_ADJECTIVES = [
  'amber',
  'analog',
  'aurora',
  'blue',
  'bronze',
  'cedar',
  'chrome',
  'cobalt',
  'copper',
  'crimson',
  'crystal',
  'drifting',
  'dusky',
  'electric',
  'emerald',
  'faded',
  'golden',
  'harbor',
  'indigo',
  'ivory',
  'jade',
  'lunar',
  'meadow',
  'midnight',
  'misty',
  'monsoon',
  'neon',
  'obsidian',
  'ochre',
  'quiet',
  'saffron',
  'satin',
  'scarlet',
  'shadow',
  'silent',
  'silver',
  'solar',
  'static',
  'velvet',
  'violet',
  'wild',
];

const SONG_NAME_NOUNS = [
  'alley',
  'bamboo',
  'bloom',
  'breeze',
  'canyon',
  'cassette',
  'chord',
  'chorus',
  'coast',
  'compass',
  'courtyard',
  'current',
  'dusk',
  'echo',
  'ember',
  'frequency',
  'groove',
  'harbor',
  'horizon',
  'lantern',
  'lotus',
  'mirage',
  'moonlight',
  'motif',
  'nocturne',
  'orbit',
  'overture',
  'pavilion',
  'prism',
  'pulse',
  'rain',
  'resonance',
  'river',
  'skyline',
  'solstice',
  'static',
  'terrace',
  'tide',
  'vapor',
  'vinyl',
  'zephyr',
];

const SONG_NAME_TAGS = [
  'cut',
  'draft',
  'dub',
  'edit',
  'flip',
  'loop',
  'master',
  'mix',
  'redux',
  'session',
  'take',
  'tape',
  'v2',
  '404',
  '808',
];

function pickRandomItem(items: readonly string[]): string {
  return items[Math.floor(Math.random() * items.length)];
}

export function generateRandomSongSlug(excludeSlug?: string): string {
  const normalizedExclude = (excludeSlug ?? '').trim().toLowerCase();
  for (let attempt = 0; attempt < 12; attempt++) {
    const adj = pickRandomItem(SONG_NAME_ADJECTIVES);
    const noun = pickRandomItem(SONG_NAME_NOUNS);
    if (adj === noun) continue;
    const useThirdToken = Math.random() < 0.72;
    const raw = useThirdToken
      ? `${adj}-${noun}-${pickRandomItem(SONG_NAME_TAGS)}`
      : `${adj}-${noun}`;
    const candidate = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (candidate && candidate !== normalizedExclude) {
      return candidate;
    }
  }
  return `midnight-echo-${Math.floor(100 + Math.random() * 899)}`;
}
