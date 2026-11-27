import type {
  AudioRightsClass,
  AudioStyle,
  SavedLead,
  SocialPlatform,
} from '../types/media';

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  douyin: 'Douyin',
  facebook: 'Facebook',
};

export const AUDIO_STYLE_LABELS: Record<AudioStyle, string> = {
  voiceover: 'Creator Voiceover',
  ambient_raw: 'Raw Room / ASMR',
  street_interview: 'Street Mic / Vox-Pop',
  live_acoustic: 'Live Acoustic Take',
  royalty_free_music: 'Royalty-Free Original Music',
  commercial_music: 'Commercial Music',
};

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'Unmetered';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(Math.round(value));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return mins > 0 ? `${mins}:${String(rem).padStart(2, '0')}` : `0:${String(rem).padStart(2, '0')}`;
}

export function formatRelativeAge(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) {
    return 'Recent';
  }
  const diffHours = Math.max(1, Math.round((Date.now() - ts) / (1000 * 60 * 60)));
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const days = Math.round(diffHours / 24);
  return `${days}d ago`;
}

export function getAudioStatusTextClass(status: AudioRightsClass): string {
  if (status === 'verified_original') {
    return 'text-teal-700 font-semibold';
  }
  if (status === 'reused_original') {
    return 'text-sky-700 font-semibold';
  }
  return 'text-rose-700 font-semibold';
}

export function buildShortlistCsv(leads: SavedLead[]): string {
  const headers = [
    'Platform',
    'Creator Handle',
    'Title',
    'Audio Status',
    'Audio Track Attribution',
    'Views',
    'Views Per Day',
    'Engagement Pct',
    'Post URL',
    'Saved At',
    'Notes',
  ];

  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = leads.map(({ post, savedAt, notes }) => [
    PLATFORM_LABELS[post.platform],
    `@${post.creatorHandle}`,
    post.title,
    post.classification.summaryLabel,
    post.audioTitle,
    post.views,
    post.viewsPerDay,
    `${post.engagementRatePct}%`,
    post.postUrl,
    savedAt,
    notes,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}
