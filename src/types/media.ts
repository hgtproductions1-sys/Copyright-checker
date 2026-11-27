import type { StudioAudioFormat } from '../lib/audioFormats';

export type SocialPlatform = 'tiktok' | 'instagram' | 'douyin' | 'facebook';

export type AudioRightsClass =
  | 'verified_original'
  | 'reused_original'
  | 'copyrighted_commercial';

export type AudioStyle =
  | 'voiceover'
  | 'ambient_raw'
  | 'street_interview'
  | 'live_acoustic'
  | 'royalty_free_music'
  | 'commercial_music';

export type DouyinSynthPresetId =
  | 'guzheng_rain_lofi'
  | 'dizi_mist_ambient'
  | 'chengdu_night_chillhop'
  | 'jiangnan_pipa_groove'
  | 'yunnan_handpan_echo'
  | 'suzhou_rhodes_tea';

export interface AudioSignal {
  code: string;
  label: string;
  polarity: 'original' | 'copyrighted' | 'neutral';
  detail: string;
}

export interface AudioClassification {
  status: AudioRightsClass;
  isOriginalSafe: boolean;
  isCreatorOwned: boolean;
  audioStyle: AudioStyle;
  summaryLabel: string;
  signals: AudioSignal[];
  detectedLabelOrRightsHolder?: string;
}

export interface ViralPost {
  id: string;
  platform: SocialPlatform;
  niche: string;
  title: string;
  caption: string;
  creatorName: string;
  creatorHandle: string;
  postUrl: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  directAudioUrl?: string;
  directVideoUrl?: string;
  audioTitle: string;
  audioAuthor: string;
  isLicensedCatalog?: boolean;
  synthPresetId?: DouyinSynthPresetId;
  bpm?: number;
  musicalKey?: string;
  publishedAt: string;
  durationSec: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  sourceType: 'live_public' | 'curated_index' | 'inspected_url';
  classification: AudioClassification;
  viewsPerDay: number;
  engagementRatePct: number;
}

export interface IncomingStudioAudioClip {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  durationSec?: number;
}

export interface IncomingCompiledMaster {
  name: string;
  format?: StudioAudioFormat;
  qualityLabel?: string;
  bytes: ArrayBuffer;
  durationSec: number;
}

export type AudioFilterMode =
  | 'original_only'
  | 'creator_owned_only'
  | 'all_with_excluded';

export type SortOrder = 'velocity' | 'views' | 'engagement' | 'recent';

export interface SearchResponse {
  items: ViralPost[];
  meta: {
    totalMatchedOriginal: number;
    excludedCopyrightedCount: number;
    liveProbeAttempted: boolean;
    liveItemsResolved: number;
    liveProbeNote: string;
    queriedPlatforms: SocialPlatform[];
  };
}

export interface UrlInspectResponse {
  ok: boolean;
  post?: ViralPost;
  rawMetadata?: {
    resolvedSource: string;
    httpStatus: number;
    extractedTitle: string;
    extractedAuthor: string;
    extractedAudioTrack: string;
  };
  error?: string;
}

export interface SavedLead {
  post: ViralPost;
  savedAt: string;
  notes: string;
}
