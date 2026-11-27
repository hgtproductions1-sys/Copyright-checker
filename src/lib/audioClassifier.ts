import type {
  AudioClassification,
  AudioSignal,
  AudioStyle,
  SocialPlatform,
} from '../types/media.ts';

export interface AudioMetadataInput {
  platform: SocialPlatform;
  creatorHandle: string;
  creatorName?: string;
  audioTitle: string;
  audioAuthor?: string;
  caption?: string;
  isLicensedCatalog?: boolean;
}

const ORIGINAL_AUDIO_PATTERNS: Array<{ pattern: RegExp; lang: string }> = [
  { pattern: /\boriginal\s+(sound|audio|track|voice)\b/i, lang: 'English' },
  { pattern: /创作的原声|原声|原生音频/, lang: 'Chinese (Douyin)' },
  { pattern: /\bsonido\s+original\b/i, lang: 'Spanish' },
  { pattern: /\bson\s+original\b/i, lang: 'French' },
  { pattern: /\bsom\s+original\b/i, lang: 'Portuguese' },
  { pattern: /\bsuara\s+asli\b/i, lang: 'Indonesian' },
  { pattern: /\bâm\s+thanh\s+gốc\b/i, lang: 'Vietnamese' },
  { pattern: /オリジナル楽曲|オリジナル音源/, lang: 'Japanese' },
  { pattern: /오리지널\s*사운드/, lang: 'Korean' },
];

const COMMERCIAL_RIGHTS_HOLDERS: Array<{ pattern: RegExp; holder: string }> = [
  { pattern: /\b(universal\s+music|umg|interscope|republic\s+records|def\s+jam)\b/i, holder: 'Universal Music Group' },
  { pattern: /\b(sony\s+music|columbia\s+records|rca\s+records|epic\s+records)\b/i, holder: 'Sony Music Entertainment' },
  { pattern: /\b(warner\s+music|wmg|atlantic\s+records|parlophone)\b/i, holder: 'Warner Music Group' },
  { pattern: /\b(epidemic\s+sound|artlist|musicbed|lickd)\b/i, holder: 'Commercial Sync Catalog' },
  { pattern: /\b(vevo|spinnin|monstercat|empire\s+distribution|distrokid\s+official)\b/i, holder: 'Commercial Distributor' },
  { pattern: /腾讯音乐|网易云音乐官方|索尼音乐|环球音乐|华纳音乐/, holder: 'Licensed Mainland Music Catalog' },
];

const COMMERCIAL_TRACK_MARKERS: RegExp[] = [
  /\((official\s+(audio|music\s+video|lyric|visualizer)|radio\s+edit|remastered|sped\s+up\s+version|club\s+mix)\)/i,
  /\b(feat\.|ft\.)\s+[a-z0-9]/i,
  /\blicensed\s+to\s+youtube|rights\s+manager\s+protected|contains\s+music\s+from\b/i,
  /\bsound\s+removed\s+due\s+to\s+copyright|audio\s+muted\b/i,
];

function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\s+/g, '');
}

const ROYALTY_FREE_MUSIC_REGEX =
  /无版权|免版权|免费商用|可商用\s*bgm|免费\s*bgm|独立音乐人原创|原创纯音乐|原创伴奏|\b(royalty[\s-]*free|no\s+copyright\s+music|copyright[\s-]*free|cc0\s+music|free\s+bgm)\b/i;

function inferAudioStyle(caption: string, audioTitle: string, isCommercial: boolean): AudioStyle {
  if (isCommercial) {
    return 'commercial_music';
  }
  const combined = `${caption} ${audioTitle}`.toLowerCase();
  if (ROYALTY_FREE_MUSIC_REGEX.test(combined)) {
    return 'royalty_free_music';
  }
  if (
    /\b(interview|street\s+ask|vox\s*pop|asking\s+strangers|asking\s+commuters|street\s+answers)\b/.test(
      combined
    ) ||
    /街头采访|路人采访/.test(combined)
  ) {
    return 'street_interview';
  }
  if (
    /\b(acoustic|unplugged|live\s+vocals|guitar\s+take|guitar\s+improvisation|piano\s+improv)\b/.test(
      combined
    ) ||
    /清唱|弹唱|即兴木吉他/.test(combined)
  ) {
    return 'live_acoustic';
  }
  if (
    /\b(asmr|no\s+talking|raw\s+sound|raw\s+audio|shop\s+mic|room\s+mic|workshop|sizzle|wok|chisel|shavings|pottery|stoneware|crust\s+blister|comal|mallet|ambient)\b/.test(
      combined
    ) ||
    /沉浸式|原声实录|无bgm|锅气/.test(combined)
  ) {
    return 'ambient_raw';
  }
  return 'voiceover';
}

export function classifyAudioRights(input: AudioMetadataInput): AudioClassification {
  const signals: AudioSignal[] = [];
  const audioTitle = (input.audioTitle || '').trim();
  const audioAuthor = (input.audioAuthor || '').trim();
  const caption = (input.caption || '').trim();
  const creatorNorm = normalizeHandle(input.creatorHandle || input.creatorName || '');
  const audioAuthorNorm = normalizeHandle(audioAuthor);
  const combinedAudio = `${audioTitle} ${audioAuthor}`;

  let detectedRightsHolder: string | undefined;

  if (input.isLicensedCatalog) {
    signals.push({
      code: 'LICENSED_CATALOG_FLAG',
      label: 'Platform licensed music catalog ID',
      polarity: 'copyrighted',
      detail: 'Audio links to a registered commercial music catalog entry rather than user-generated sound.',
    });
  }

  for (const entry of COMMERCIAL_RIGHTS_HOLDERS) {
    if (entry.pattern.test(combinedAudio) || entry.pattern.test(caption)) {
      detectedRightsHolder = entry.holder;
      signals.push({
        code: 'COMMERCIAL_LABEL_MATCH',
        label: `Rights holder detected: ${entry.holder}`,
        polarity: 'copyrighted',
        detail: `Matched commercial label or distributor signature (${entry.holder}).`,
      });
      break;
    }
  }

  for (const marker of COMMERCIAL_TRACK_MARKERS) {
    if (marker.test(combinedAudio)) {
      signals.push({
        code: 'COMMERCIAL_RELEASE_MARKER',
        label: 'Commercial release title formatting',
        polarity: 'copyrighted',
        detail: `Audio title "${audioTitle}" matches commercial single/release naming conventions.`,
      });
      break;
    }
  }

  let matchedOriginalLang: string | null = null;
  for (const entry of ORIGINAL_AUDIO_PATTERNS) {
    if (entry.pattern.test(audioTitle)) {
      matchedOriginalLang = entry.lang;
      signals.push({
        code: 'NATIVE_ORIGINAL_TAG',
        label: `Platform original-audio marker (${entry.lang})`,
        polarity: 'original',
        detail: `Audio track title "${audioTitle}" carries the native ${entry.lang} original sound designation.`,
      });
      break;
    }
  }

  const isRoyaltyFreeDeclared = ROYALTY_FREE_MUSIC_REGEX.test(
    `${audioTitle} ${caption}`
  );
  if (isRoyaltyFreeDeclared && !input.isLicensedCatalog && !detectedRightsHolder) {
    signals.push({
      code: 'ROYALTY_FREE_MUSIC_GRANT',
      label: 'Non-copyrighted / royalty-free music declaration',
      polarity: 'original',
      detail:
        'Creator explicitly released this instrumental as non-copyrighted / royalty-free BGM (无版权 / 免版权可商用) outside commercial label catalogs.',
    });
  }

  const audioMentionsCreator =
    creatorNorm.length >= 2 &&
    (audioTitle.toLowerCase().replace(/\s+/g, '').includes(creatorNorm) ||
      (audioAuthorNorm.length >= 2 && audioAuthorNorm === creatorNorm) ||
      (input.creatorName &&
        audioTitle.toLowerCase().includes(input.creatorName.trim().toLowerCase())));

  if (audioMentionsCreator) {
    signals.push({
      code: 'CREATOR_HANDLE_MATCH',
      label: 'Audio author matches post creator',
      polarity: 'original',
      detail: `Sound attribution belongs directly to @${creatorNorm}, confirming first-party recording.`,
    });
  } else if (
    matchedOriginalLang &&
    audioAuthorNorm.length >= 2 &&
    creatorNorm.length >= 2 &&
    audioAuthorNorm !== creatorNorm
  ) {
    signals.push({
      code: 'REUSED_UGC_AUDIO',
      label: 'Reused independent creator sound',
      polarity: 'neutral',
      detail: `Uses user-generated original sound recorded by @${audioAuthorNorm} rather than a record label.`,
    });
  }

  if (/#(originalaudio|originalsound|rawaudio|notalking|asmrsounds|原声|同期声)/i.test(caption)) {
    signals.push({
      code: 'CREATOR_CAPTION_DECLARATION',
      label: 'Raw / original sound declared in caption',
      polarity: 'original',
      detail: 'Creator explicitly tagged raw room audio, voiceover, or original sound in post description.',
    });
  }

  const looksLikeArtistDashSong =
    !matchedOriginalLang &&
    !audioMentionsCreator &&
    /^[^-—]{2,40}\s[-—]\s[^-—]{2,60}$/.test(audioTitle) &&
    !/original|原声|voiceover|mic|ambient/i.test(audioTitle);

  if (looksLikeArtistDashSong) {
    signals.push({
      code: 'ARTIST_TRACK_SYNTAX',
      label: 'Commercial "Artist - Track" title structure',
      polarity: 'copyrighted',
      detail: `Track "${audioTitle}" follows commercial music catalog naming without an original-sound marker.`,
    });
  }

  const hasCopyrightedSignal = signals.some((s) => s.polarity === 'copyrighted');
  const hasOriginalSignal = signals.some((s) => s.polarity === 'original');

  if (hasCopyrightedSignal) {
    return {
      status: 'copyrighted_commercial',
      isOriginalSafe: false,
      isCreatorOwned: false,
      audioStyle: inferAudioStyle(caption, audioTitle, true),
      summaryLabel: detectedRightsHolder
        ? `Copyrighted (${detectedRightsHolder})`
        : 'Copyrighted / Licensed Track',
      signals,
      detectedLabelOrRightsHolder: detectedRightsHolder,
    };
  }

  if (hasOriginalSignal && audioMentionsCreator) {
    return {
      status: 'verified_original',
      isOriginalSafe: true,
      isCreatorOwned: true,
      audioStyle: inferAudioStyle(caption, audioTitle, false),
      summaryLabel: 'Verified Creator Original',
      signals,
    };
  }

  if (hasOriginalSignal) {
    return {
      status: 'reused_original',
      isOriginalSafe: true,
      isCreatorOwned: false,
      audioStyle: inferAudioStyle(caption, audioTitle, false),
      summaryLabel: 'Original UGC Audio (Shared)',
      signals,
    };
  }

  if (audioMentionsCreator) {
    return {
      status: 'verified_original',
      isOriginalSafe: true,
      isCreatorOwned: true,
      audioStyle: inferAudioStyle(caption, audioTitle, false),
      summaryLabel: 'Creator Self-Titled Audio',
      signals,
    };
  }

  // Conservative fallback: if no original sound signal exists, treat unknown external tracks cautiously
  signals.push({
    code: 'UNVERIFIED_EXTERNAL_TRACK',
    label: 'Unverified non-creator audio track',
    polarity: 'copyrighted',
    detail: 'Audio lacks platform original-sound attribution and does not match the uploader handle.',
  });

  return {
    status: 'copyrighted_commercial',
    isOriginalSafe: false,
    isCreatorOwned: false,
    audioStyle: 'commercial_music',
    summaryLabel: 'Unverified / Likely Licensed',
    signals,
  };
}

export function computeViralityMetrics(params: {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  publishedAt: string;
  nowMs?: number;
}): { viewsPerDay: number; engagementRatePct: number } {
  const now = params.nowMs ?? Date.now();
  const publishedMs = Date.parse(params.publishedAt);
  const ageDays = Number.isFinite(publishedMs)
    ? Math.max(0.5, (now - publishedMs) / (1000 * 60 * 60 * 24))
    : 7;

  const safeViews = Math.max(1, params.views);
  const viewsPerDay = Math.round(safeViews / ageDays);
  const interactions = Math.max(0, params.likes) + Math.max(0, params.comments) + Math.max(0, params.shares);
  const engagementRatePct = Number(((interactions / safeViews) * 100).toFixed(2));

  return { viewsPerDay, engagementRatePct };
}
