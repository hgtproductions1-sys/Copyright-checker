export type StudioAudioFormat =
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'flac'
  | 'aiff'
  | 'wma';

export type StudioAudioBitrate = '128k' | '192k' | '320k';

export interface StudioAudioFormatSpec {
  id: StudioAudioFormat;
  label: string;
  extension: string;
  mimeType: string;
  ffmpegFormat: string;
  ffmpegCodec: string;
  lossless: boolean;
  browserNativePlayable: boolean;
  summary: string;
}

export const STUDIO_AUDIO_FORMAT_ORDER: readonly StudioAudioFormat[] = [
  'mp3',
  'wav',
  'm4a',
  'flac',
  'aiff',
  'wma',
];

export const STUDIO_AUDIO_FORMATS: Record<
  StudioAudioFormat,
  StudioAudioFormatSpec
> = {
  mp3: {
    id: 'mp3',
    label: 'MP3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    ffmpegFormat: 'mp3',
    ffmpegCodec: 'libmp3lame',
    lossless: false,
    browserNativePlayable: true,
    summary: 'Universal compressed stereo MP3',
  },
  wav: {
    id: 'wav',
    label: 'WAV',
    extension: 'wav',
    mimeType: 'audio/wav',
    ffmpegFormat: 'wav',
    ffmpegCodec: 'pcm_s16le',
    lossless: true,
    browserNativePlayable: true,
    summary: 'Uncompressed 16-bit PCM master',
  },
  m4a: {
    id: 'm4a',
    label: 'M4A',
    extension: 'm4a',
    mimeType: 'audio/mp4',
    ffmpegFormat: 'ipod',
    ffmpegCodec: 'aac',
    lossless: false,
    browserNativePlayable: true,
    summary: 'AAC Apple & studio container',
  },
  flac: {
    id: 'flac',
    label: 'FLAC',
    extension: 'flac',
    mimeType: 'audio/flac',
    ffmpegFormat: 'flac',
    ffmpegCodec: 'flac',
    lossless: true,
    browserNativePlayable: true,
    summary: 'Lossless compressed studio archive',
  },
  aiff: {
    id: 'aiff',
    label: 'AIFF',
    extension: 'aiff',
    mimeType: 'audio/aiff',
    ffmpegFormat: 'aiff',
    ffmpegCodec: 'pcm_s16be',
    lossless: true,
    browserNativePlayable: false,
    summary: 'Uncompressed Apple / DAW PCM',
  },
  wma: {
    id: 'wma',
    label: 'WMA',
    extension: 'wma',
    mimeType: 'audio/x-ms-wma',
    ffmpegFormat: 'asf',
    ffmpegCodec: 'wmav2',
    lossless: false,
    browserNativePlayable: false,
    summary: 'Windows Media Audio',
  },
};

export function normalizeStudioAudioFormat(
  raw?: string | null
): StudioAudioFormat {
  const lower = (raw ?? '').trim().toLowerCase().replace(/^\./, '');
  if (lower === 'aif') return 'aiff';
  if (
    lower === 'mp3' ||
    lower === 'wav' ||
    lower === 'm4a' ||
    lower === 'flac' ||
    lower === 'aiff' ||
    lower === 'wma'
  ) {
    return lower;
  }
  return 'mp3';
}

export function normalizeStudioAudioBitrate(
  raw?: string | null
): StudioAudioBitrate {
  const cleaned = (raw ?? '').trim().toLowerCase();
  if (cleaned === '128k' || cleaned === '320k') {
    return cleaned;
  }
  return '192k';
}

export function inferAudioFormatFromFilename(
  fileName: string
): StudioAudioFormat | null {
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  const ext = match[1];
  if (ext === 'aif') return 'aiff';
  if (
    ext === 'mp3' ||
    ext === 'wav' ||
    ext === 'm4a' ||
    ext === 'flac' ||
    ext === 'aiff' ||
    ext === 'wma'
  ) {
    return ext;
  }
  return null;
}

export function buildFfmpegAudioEncodeArgs(
  format: StudioAudioFormat,
  bitrate: StudioAudioBitrate = '192k'
): string[] {
  const spec = STUDIO_AUDIO_FORMATS[format];
  const args: string[] = ['-f', spec.ffmpegFormat, '-c:a', spec.ffmpegCodec];
  if (!spec.lossless) {
    args.push('-b:a', bitrate);
  }
  args.push('-ar', '44100', '-ac', '2');
  if (format === 'm4a') {
    args.push('-movflags', '+faststart');
  }
  return args;
}

export function formatOutputTrackFilename(
  baseName: string,
  format: StudioAudioFormat
): string {
  const spec = STUDIO_AUDIO_FORMATS[format];
  const stripped = baseName
    .trim()
    .replace(/\.(mp3|wav|m4a|flac|aiff?|wma)$/i, '');
  return `${stripped || 'studio-master'}.${spec.extension}`;
}
