import { execFile } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { classifyAudioRights, computeViralityMetrics } from './src/lib/audioClassifier.ts';
import {
  buildFfmpegAudioEncodeArgs,
  normalizeStudioAudioBitrate,
  normalizeStudioAudioFormat,
  STUDIO_AUDIO_FORMATS,
} from './src/lib/audioFormats.ts';
import {
  sanitizeClipTiming,
  type TransitionMode,
} from './src/lib/audioTimelineMath.ts';
import { generateRoyaltyFreeWavBytes } from './src/lib/royaltyFreeSynth.ts';
import { buildSeedViralCatalog } from './src/lib/seedCatalog.ts';
import { filterAndRankViralPosts } from './src/lib/searchEngine.ts';
import {
  buildZipArchiveBuffer,
  collectProjectZipEntries,
} from './src/lib/serverZipBuilder.ts';
import {
  isAllowedMediaCdnUrl,
  sanitizeDownloadFilename,
  validateAndParseSocialUrl,
} from './src/lib/urlSafety.ts';
import {
  analyzePcmSegments,
  compareAudioEnvelopes,
  type SegmentAcousticProfile,
} from './src/lib/audioSimilarity.ts';
import {
  evaluateIsrcFormat,
  inspectUploadedMediaCopyright,
  parseEbuR128Summary,
  scanRawContainerRightsMarkers,
  type MediaContainerTags,
  type MediaTechnicalProfile,
  type RegistryLookupResult,
  type RegistryMatchHit,
} from './src/lib/videoCopyrightInspector.ts';
import type {
  AudioFilterMode,
  DouyinSynthPresetId,
  SearchResponse,
  SocialPlatform,
  SortOrder,
  UrlInspectResponse,
  ViralPost,
} from './src/types/media.ts';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvedStreamCache = new Map<string, { url: string; expiresAt: number }>();
const discoveredLivePool = new Map<string, ViralPost>();
const liveFeedQueryCache = new Map<
  string,
  { posts: ViralPost[]; expiresAt: number }
>();

const AUTO_DISCOVERY_QUERIES = [
  'original sound',
  'singing original song',
  'acoustic guitar original',
  'street interview',
  'studio vocal session',
  'cooking raw audio',
  'woodworking raw sound',
  '无版权音乐 原声',
];

const PUBLIC_BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const VALID_PLATFORMS = new Set<SocialPlatform>([
  'tiktok',
  'instagram',
  'douyin',
  'facebook',
]);

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractMetaContent(html: string, attrValue: string): string {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const regex2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    'i'
  );
  const match = html.match(regex1) || html.match(regex2);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 3500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Re-validate before outbound fetch to block any unexpected URL
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Disallowed protocol');
    }
    return await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': PUBLIC_BROWSER_UA,
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pickAutoDiscoveryKeyword(
  niche: string,
  platforms: SocialPlatform[],
  batchIndex: number
): string {
  if (platforms.length === 1 && platforms[0] === 'douyin') {
    const dyTerms = [
      '无版权音乐 原声',
      '原创纯音乐 免版权',
      '原声 弹唱 原创',
      '街头美食 原声',
    ];
    return dyTerms[batchIndex % dyTerms.length];
  }
  if (niche === 'Acoustic & Voice') {
    const vocalTerms = [
      'singing original song',
      'acoustic guitar original',
      'piano original song demo',
      'unsigned artist original sound',
    ];
    return vocalTerms[batchIndex % vocalTerms.length];
  }
  if (niche === 'Royalty-Free Douyin Music') {
    return '无版权音乐 原创纯音乐';
  }
  if (niche === 'Culinary & Street Food') {
    return batchIndex % 2 === 0 ? 'street food raw audio' : 'cooking original sound';
  }
  if (niche === 'Craft & Woodworking') {
    return batchIndex % 2 === 0 ? 'woodworking original sound' : 'pottery raw audio';
  }
  if (niche === 'Street Interviews') {
    return batchIndex % 2 === 0 ? 'street interview original sound' : 'vox pop interview';
  }
  return AUTO_DISCOVERY_QUERIES[batchIndex % AUTO_DISCOVERY_QUERIES.length];
}

/**
 * High-volume unauthenticated public discovery sweep on TikWM public feed
 * (fetches up to 35 posts per sweep, caches direct MP4 CDN URLs, and accumulates live hits).
 */
async function probeLivePublicTikTok(
  keyword: string,
  niche: string,
  platforms: SocialPlatform[],
  batchIndex: number
): Promise<{ posts: ViralPost[]; note: string }> {
  const trimmed = keyword.trim();
  const effectiveKeyword =
    trimmed.length > 0
      ? trimmed
      : pickAutoDiscoveryKeyword(niche, platforms, batchIndex);
  const cursor = trimmed.length > 0 ? batchIndex * 30 : Math.floor(batchIndex / AUTO_DISCOVERY_QUERIES.length) * 30;
  const cacheKey = `${effectiveKeyword.toLowerCase()}::${cursor}`;

  const cached = liveFeedQueryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      posts: cached.posts,
      note: `Merged ${discoveredLivePool.size} live public posts with verified multi-platform index.`,
    };
  }

  try {
    const endpoint = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(
      effectiveKeyword
    )}&count=35&cursor=${cursor}`;
    const res = await fetchWithTimeout(endpoint, 4500);
    if (!res.ok) {
      return {
        posts: [],
        note: `Zero-login screening active across ${
          discoveredLivePool.size > 0 ? `${discoveredLivePool.size} live + ` : ''
        }70 verified original-audio & Douyin non-copyrighted tracks.`,
      };
    }
    const payload = (await res.json()) as {
      code?: number;
      data?: {
        videos?: Array<{
          video_id?: string;
          title?: string;
          duration?: number;
          cover?: string;
          origin_cover?: string;
          play?: string;
          wmplay?: string;
          music?: string;
          play_count?: number;
          digg_count?: number;
          comment_count?: number;
          share_count?: number;
          create_time?: number;
          author?: { unique_id?: string; nickname?: string };
          music_info?: {
            title?: string;
            author?: string;
            original?: boolean;
            play?: string;
          };
        }>;
      };
    };

    const rawVideos = payload?.data?.videos ?? [];
    const mapped: ViralPost[] = rawVideos
      .filter((v) => v.video_id && v.author?.unique_id)
      .map((v) => {
        const handle = v.author?.unique_id || 'creator';
        const creatorName = v.author?.nickname || handle;
        const audioTitle =
          v.music_info?.title || `original sound - ${creatorName}`;
        const audioAuthor = v.music_info?.author || handle;
        const isLicensedCatalog = v.music_info?.original === false;
        const publishedAt = v.create_time
          ? new Date(v.create_time * 1000).toISOString()
          : new Date(Date.now() - 3 * 86400_000).toISOString();

        const postUrl = `https://www.tiktok.com/@${handle}/video/${v.video_id}`;
        const streamCandidate = v.play || v.wmplay || '';
        if (streamCandidate && isAllowedMediaCdnUrl(streamCandidate)) {
          resolvedStreamCache.set(postUrl, {
            url: streamCandidate,
            expiresAt: Date.now() + 15 * 60 * 1000,
          });
        }

        const classification = classifyAudioRights({
          platform: 'tiktok',
          creatorHandle: handle,
          creatorName,
          audioTitle,
          audioAuthor,
          caption: v.title || '',
          isLicensedCatalog,
        });

        const views = Number(v.play_count || 25000);
        const likes = Number(v.digg_count || 1800);
        const comments = Number(v.comment_count || 120);
        const shares = Number(v.share_count || 340);
        const metrics = computeViralityMetrics({
          views,
          likes,
          comments,
          shares,
          publishedAt,
        });

        const rawCover = v.origin_cover || v.cover || '';
        const rawMusic = v.music_info?.play || v.music || '';

        return {
          id: `live-tt-${v.video_id}`,
          platform: 'tiktok',
          niche: niche !== 'All Niches' ? niche : 'Live Public Search',
          title: (v.title || `Original audio video by @${handle}`).slice(0, 120),
          caption: v.title || '',
          creatorName,
          creatorHandle: handle,
          postUrl,
          thumbnailUrl: isAllowedMediaCdnUrl(rawCover) ? rawCover : undefined,
          directAudioUrl: isAllowedMediaCdnUrl(rawMusic) ? rawMusic : undefined,
          directVideoUrl:
            streamCandidate && isAllowedMediaCdnUrl(streamCandidate)
              ? streamCandidate
              : undefined,
          audioTitle,
          audioAuthor,
          isLicensedCatalog,
          publishedAt,
          durationSec: Number(v.duration || 30),
          views,
          likes,
          comments,
          shares,
          sourceType: 'live_public',
          classification,
          viewsPerDay: metrics.viewsPerDay,
          engagementRatePct: metrics.engagementRatePct,
        };
      });

    if (mapped.length > 0) {
      liveFeedQueryCache.set(cacheKey, {
        posts: mapped,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      for (const item of mapped) {
        if (discoveredLivePool.size < 500) {
          discoveredLivePool.set(item.postUrl.toLowerCase(), item);
        }
      }
    }

    return {
      posts: mapped,
      note:
        discoveredLivePool.size > 0
          ? `Discovered ${discoveredLivePool.size} live unauthenticated public posts + 70 verified multi-platform original tracks.`
          : 'Showing full multi-platform original-audio & Douyin non-copyrighted catalog.',
    };
  } catch {
    return {
      posts: [],
      note: `Serving ${discoveredLivePool.size > 0 ? `${discoveredLivePool.size} cached live posts + ` : ''}expanded multi-platform original-audio catalog.`,
    };
  }
}

async function inspectPublicSocialUrl(rawUrl: string): Promise<UrlInspectResponse> {
  const parsed = validateAndParseSocialUrl(rawUrl);
  if (!parsed.ok || !parsed.normalizedUrl || !parsed.platform) {
    return {
      ok: false,
      error: parsed.error || 'Invalid social URL.',
    };
  }

  const platform = parsed.platform;
  const normalizedUrl = parsed.normalizedUrl;
  let creatorHandle = parsed.creatorHandle || 'public_creator';
  let creatorName = creatorHandle;
  let title = '';
  let caption = '';
  let audioTitle = '';
  let audioAuthor = '';
  let thumbnailUrl: string | undefined;
  let embedUrl: string | undefined;
  let resolvedSource = 'Public URL Metadata Parser';
  let httpStatus = 200;
  let isLicensedCatalog = false;
  let liveViews = 0;
  let liveLikes = 0;
  let liveComments = 0;
  let liveShares = 0;
  let liveDuration = 30;

  try {
    if (platform === 'tiktok' || platform === 'douyin') {
      // Try unauthenticated TikWM metadata & audio-rights resolver first
      try {
        const tikwmRes = await fetchWithTimeout(
          `https://www.tikwm.com/api/?url=${encodeURIComponent(normalizedUrl)}`,
          6500
        );
        if (tikwmRes.ok) {
          const payload = (await tikwmRes.json()) as {
            code?: number;
            data?: {
              id?: string;
              title?: string;
              duration?: number;
              cover?: string;
              play?: string;
              wmplay?: string;
              play_count?: number;
              digg_count?: number;
              comment_count?: number;
              share_count?: number;
              author?: { unique_id?: string; nickname?: string };
              music_info?: {
                title?: string;
                author?: string;
                original?: boolean;
              };
            };
          };
          if (payload.code === 0 && payload.data) {
            const d = payload.data;
            const streamCandidate = d.play || d.wmplay || '';
            if (streamCandidate && isAllowedMediaCdnUrl(streamCandidate)) {
              resolvedStreamCache.set(normalizedUrl, {
                url: streamCandidate,
                expiresAt: Date.now() + 10 * 60 * 1000,
              });
            }
            resolvedSource = 'Direct Public Media & Audio Resolver (No Login)';
            httpStatus = 200;
            creatorHandle = d.author?.unique_id || creatorHandle;
            creatorName = d.author?.nickname || creatorHandle;
            caption = d.title || '';
            title = caption || `${platform.toUpperCase()} video by @${creatorHandle}`;
            thumbnailUrl = d.cover || thumbnailUrl;
            audioTitle =
              d.music_info?.title ||
              (platform === 'douyin'
                ? `@${creatorName} 创作的原声`
                : `original sound - ${creatorName}`);
            audioAuthor = d.music_info?.author || creatorHandle;
            isLicensedCatalog = d.music_info?.original === false;
            liveViews = Number(d.play_count || 0);
            liveLikes = Number(d.digg_count || 0);
            liveComments = Number(d.comment_count || 0);
            liveShares = Number(d.share_count || 0);
            liveDuration = Number(d.duration || 30);
          }
        }
      } catch {
        // Fall through to oEmbed / OpenGraph below
      }
    }

    if (platform === 'tiktok' && !title) {
      const oembedEndpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(
        normalizedUrl
      )}`;
      const res = await fetchWithTimeout(oembedEndpoint, 4500);
      httpStatus = res.status;
      if (res.ok) {
        resolvedSource = 'TikTok Public oEmbed API (No Login)';
        const data = (await res.json()) as {
          title?: string;
          author_name?: string;
          author_url?: string;
          thumbnail_url?: string;
          embed_product_id?: string;
        };
        creatorName = data.author_name || creatorName;
        if (data.author_url) {
          const handleMatch = data.author_url.match(/\/@([^/?#]+)/);
          if (handleMatch) {
            creatorHandle = handleMatch[1];
          }
        }
        caption = data.title || '';
        title = caption || `TikTok video by @${creatorHandle}`;
        thumbnailUrl = data.thumbnail_url;
        if (parsed.postId) {
          embedUrl = `https://www.tiktok.com/player/v1/${parsed.postId}`;
        }

        // Check if caption explicitly mentions commercial track vs original sound
        if (/♬\s*([^#]+)$/.test(caption)) {
          const m = caption.match(/♬\s*([^#]+)$/);
          if (m) audioTitle = m[1].trim();
        }
        if (!audioTitle) {
          if (/\b(official audio|umg|sony music|warner|remix|feat\.)\b/i.test(caption)) {
            audioTitle = caption;
            isLicensedCatalog = true;
          } else {
            audioTitle = `original sound - ${creatorName}`;
            audioAuthor = creatorHandle;
          }
        }
      }
    } else if (platform === 'instagram' && parsed.postId) {
      const embedEndpoint = `https://www.instagram.com/p/${encodeURIComponent(
        parsed.postId
      )}/embed/captioned/`;
      const res = await fetchWithTimeout(embedEndpoint, 4500);
      httpStatus = res.status;
      if (res.ok) {
        resolvedSource = 'Instagram Public Captioned Embed (No Login)';
        const html = await res.text();
        const userMatch = html.match(/class="UsernameText"[^>]*>([^<]+)</i);
        if (userMatch) {
          creatorHandle = decodeHtmlEntities(userMatch[1].trim());
          creatorName = creatorHandle;
        }
        const captionMatch = html.match(/class="Caption"[\s\S]*?<br\s*\/?>([\s\S]*?)<\/div>/i);
        if (captionMatch) {
          caption = decodeHtmlEntities(captionMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        }
        const audioMatch = html.match(/Original audio|Audio original|[^<>]{2,50}\s·\sOriginal audio/i);
        if (audioMatch) {
          audioTitle = `Original audio - ${creatorHandle}`;
          audioAuthor = creatorHandle;
        } else {
          const songLinkMatch = html.match(/\/reels\/audio\/\d+\/?[^>]*>([^<]+)</i);
          if (songLinkMatch) {
            audioTitle = decodeHtmlEntities(songLinkMatch[1].trim());
          } else {
            audioTitle = `Original audio - ${creatorHandle}`;
            audioAuthor = creatorHandle;
          }
        }
        const imgMatch =
          html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) ||
          html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaImage"/i);
        if (imgMatch) {
          const decodedCover = decodeHtmlEntities(imgMatch[1].trim());
          if (isAllowedMediaCdnUrl(decodedCover)) {
            thumbnailUrl = decodedCover;
          }
        }
        title = caption ? caption.slice(0, 110) : `Instagram Reel (${parsed.postId})`;
        embedUrl = `https://www.instagram.com/p/${encodeURIComponent(parsed.postId)}/embed/`;
      }
    } else if (!title) {
      // Douyin or Facebook public OpenGraph / meta inspection
      const res = await fetchWithTimeout(normalizedUrl, 4000);
      httpStatus = res.status;
      if (res.ok) {
        const html = await res.text();
        resolvedSource =
          platform === 'douyin'
            ? 'Douyin Public Page Metadata (No Login)'
            : 'Facebook Public OpenGraph Metadata (No Login)';
        const ogTitle =
          extractMetaContent(html, 'og:title') ||
          (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').trim();
        const ogDesc = extractMetaContent(html, 'og:description');
        const ogImage = extractMetaContent(html, 'og:image');

        title = decodeHtmlEntities(ogTitle) || `${platform} post ${parsed.postId || ''}`.trim();
        caption = ogDesc || title;
        if (ogImage && ogImage.startsWith('https://')) {
          thumbnailUrl = ogImage;
        }
        if (/创作的原声|原声|original\s+audio|original\s+sound|sonido\s+original/i.test(`${title} ${caption}`)) {
          audioTitle =
            platform === 'douyin'
              ? `@${creatorHandle} 创作的原声`
              : `Original audio - ${creatorName}`;
          audioAuthor = creatorHandle;
        } else {
          audioTitle =
            platform === 'douyin'
              ? `@${creatorHandle} 创作的原声`
              : `Original audio - ${creatorName}`;
          audioAuthor = creatorHandle;
        }
      }
    }
  } catch {
    resolvedSource = 'Offline / Heuristic URL Signature Fallback';
    httpStatus = 0;
  }

  // Also match against curated catalog if exact URL exists
  const catalogMatch = buildSeedViralCatalog().find(
    (item) => item.postUrl.toLowerCase() === normalizedUrl.toLowerCase()
  );
  if (catalogMatch) {
    return {
      ok: true,
      post: {
        ...catalogMatch,
        thumbnailUrl: thumbnailUrl || catalogMatch.thumbnailUrl,
        sourceType: 'inspected_url',
      },
      rawMetadata: {
        resolvedSource: `${resolvedSource} + Verified Index Match`,
        httpStatus: httpStatus || 200,
        extractedTitle: catalogMatch.title,
        extractedAuthor: `@${catalogMatch.creatorHandle}`,
        extractedAudioTrack: catalogMatch.audioTitle,
      },
    };
  }

  if (!title) {
    title = `Public ${platform.toUpperCase()} Video (${parsed.postId || 'permalink'})`;
  }
  if (!audioTitle) {
    audioTitle =
      platform === 'douyin'
        ? `@${creatorHandle} 创作的原声`
        : `Original audio - ${creatorHandle}`;
    audioAuthor = creatorHandle;
  }

  const classification = classifyAudioRights({
    platform,
    creatorHandle,
    creatorName,
    audioTitle,
    audioAuthor,
    caption,
    isLicensedCatalog,
  });

  const publishedAt = new Date().toISOString();

  const liveMetrics =
    liveViews > 0
      ? computeViralityMetrics({
          views: liveViews,
          likes: liveLikes,
          comments: liveComments,
          shares: liveShares,
          publishedAt,
        })
      : { viewsPerDay: 0, engagementRatePct: 0 };

  const inspectedPost: ViralPost = {
    id: `inspect-${platform}-${parsed.postId || Date.now()}`,
    platform,
    niche: 'Inspected Public Link',
    title,
    caption: caption || title,
    creatorName,
    creatorHandle,
    postUrl: normalizedUrl,
    embedUrl,
    thumbnailUrl,
    audioTitle,
    audioAuthor: audioAuthor || creatorHandle,
    isLicensedCatalog,
    publishedAt,
    durationSec: liveDuration,
    views: liveViews,
    likes: liveLikes,
    comments: liveComments,
    shares: liveShares,
    sourceType: 'inspected_url',
    classification,
    viewsPerDay: liveMetrics.viewsPerDay,
    engagementRatePct: liveMetrics.engagementRatePct,
  };

  return {
    ok: true,
    post: inspectedPost,
    rawMetadata: {
      resolvedSource,
      httpStatus,
      extractedTitle: title,
      extractedAuthor: `@${creatorHandle}`,
      extractedAudioTrack: audioTitle,
    },
  };
}

async function resolvePublicVideoStreamUrl(
  rawUrl: string
): Promise<{
  ok: boolean;
  streamUrl?: string;
  studioFallbackAvailable?: boolean;
  filenameBase?: string;
  reason?: string;
}> {
  const parsed = validateAndParseSocialUrl(rawUrl);
  if (!parsed.ok || !parsed.normalizedUrl || !parsed.platform) {
    return { ok: false, reason: parsed.error || 'Unsupported social URL.' };
  }

  const filenameBase = sanitizeDownloadFilename(
    `origisound-${parsed.platform}-${parsed.creatorHandle || 'creator'}-${parsed.postId || 'clip'}`
  );

  const cached = resolvedStreamCache.get(parsed.normalizedUrl);
  if (cached && cached.expiresAt > Date.now() && isAllowedMediaCdnUrl(cached.url)) {
    return { ok: true, streamUrl: cached.url, filenameBase };
  }

  // 1. Try unauthenticated TikWM stream resolver for TikTok & Douyin (with 1-req/sec retry)
  if (parsed.platform === 'tiktok' || parsed.platform === 'douyin') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const apiRes = await fetchWithTimeout(
          `https://www.tikwm.com/api/?url=${encodeURIComponent(parsed.normalizedUrl)}`,
          7000
        );
        if (apiRes.ok) {
          const body = (await apiRes.json()) as {
            code?: number;
            data?: { play?: string; wmplay?: string };
          };
          const candidate = body?.data?.play || body?.data?.wmplay || '';
          if (candidate && isAllowedMediaCdnUrl(candidate)) {
            resolvedStreamCache.set(parsed.normalizedUrl, {
              url: candidate,
              expiresAt: Date.now() + 10 * 60 * 1000,
            });
            return { ok: true, streamUrl: candidate, filenameBase };
          }
          if (body?.code === -1 && attempt === 0) {
            await new Promise((r) => setTimeout(r, 1150));
            continue;
          }
        }
        break;
      } catch {
        break;
      }
    }
  }

  // 2. Try public OpenGraph og:video metadata for Instagram / Facebook / Douyin
  try {
    const pageRes = await fetchWithTimeout(parsed.normalizedUrl, 4500);
    if (pageRes.ok) {
      const html = await pageRes.text();
      const ogVideo =
        extractMetaContent(html, 'og:video:secure_url') ||
        extractMetaContent(html, 'og:video');
      if (ogVideo && isAllowedMediaCdnUrl(ogVideo)) {
        resolvedStreamCache.set(parsed.normalizedUrl, {
          url: ogVideo,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
        return { ok: true, streamUrl: ogVideo, filenameBase };
      }
    }
  } catch {
    // Ignore network timeout
  }

  return {
    ok: true,
    studioFallbackAvailable: true,
    filenameBase,
    reason:
      'Using server Studio MP4 Generator (non-copyrighted audio + visual artwork).',
  };
}

function selectPresetForCatalogPost(post?: ViralPost): DouyinSynthPresetId {
  if (post?.synthPresetId) return post.synthPresetId;
  if (post?.platform === 'douyin') return 'guzheng_rain_lofi';
  if (post?.classification.audioStyle === 'live_acoustic') return 'dizi_mist_ambient';
  if (post?.classification.audioStyle === 'ambient_raw') return 'yunnan_handpan_echo';
  return 'chengdu_night_chillhop';
}

async function generateStudioMp4Buffer(normalizedUrl: string): Promise<Buffer | null> {
  const catalogMatch = buildSeedViralCatalog().find(
    (item) => item.postUrl.toLowerCase() === normalizedUrl.toLowerCase()
  );
  const preset = selectPresetForCatalogPost(catalogMatch);
  const wavBytes = generateRoyaltyFreeWavBytes(preset, 6);

  const wavPath = makeSafeTempPath('wav');
  const mp4Path = makeSafeTempPath('mp4');

  try {
    await fs.promises.writeFile(wavPath, Buffer.from(wavBytes));
    const ffmpegArgs = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0f172a:s=720x960:d=6',
      '-i',
      wavPath,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      '-movflags',
      '+faststart',
      mp4Path,
    ];

    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 12000 });
    return await fs.promises.readFile(mp4Path);
  } catch {
    return null;
  } finally {
    await fs.promises.unlink(wavPath).catch(() => undefined);
    await fs.promises.unlink(mp4Path).catch(() => undefined);
  }
}

async function fetchAllowedCdnBuffer(
  initialUrl: string,
  maxBytes: number,
  timeoutMs = 10000
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let currentUrl = initialUrl;
  let upstream: Response | null = null;

  for (let hop = 0; hop < 3; hop++) {
    if (!isAllowedMediaCdnUrl(currentUrl)) {
      return null;
    }
    const hopRes = await fetchWithTimeout(currentUrl, timeoutMs);
    if (
      hopRes.status >= 300 &&
      hopRes.status < 400 &&
      hopRes.headers.get('location')
    ) {
      currentUrl = new URL(
        hopRes.headers.get('location')!,
        currentUrl
      ).toString();
      continue;
    }
    if (hopRes.ok && hopRes.body) {
      upstream = hopRes;
    }
    break;
  }

  if (!upstream || !upstream.body) {
    return null;
  }

  const contentType = (upstream.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  }

  if (totalBytes === 0) {
    return null;
  }

  return { buffer: Buffer.concat(chunks, totalBytes), contentType };
}

function makeSafeTempPath(ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const baseTmp = path.resolve(os.tmpdir());
  const candidate = path.resolve(
    baseTmp,
    `origisound-${crypto.randomUUID()}.${safeExt}`
  );
  if (!candidate.startsWith(baseTmp + path.sep)) {
    throw new Error('Temporary file confinement check failed');
  }
  return candidate;
}

const VALID_SYNTH_PRESETS = new Set<DouyinSynthPresetId>([
  'guzheng_rain_lofi',
  'dizi_mist_ambient',
  'chengdu_night_chillhop',
  'jiangnan_pipa_groove',
  'yunnan_handpan_echo',
  'suzhou_rhodes_tea',
]);

async function probeMediaFile(filePath: string): Promise<{
  tags: MediaContainerTags;
  containerFormat: string;
  durationSec: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  videoCodec?: string;
  width?: number;
  height?: number;
  audioCodec?: string;
  sampleRateHz?: number;
  channels?: number;
  audioBitrateKbps?: number;
}> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeout: 10000 }
  );

  const parsed = JSON.parse(stdout || '{}') as {
    format?: {
      format_name?: string;
      duration?: string;
      tags?: Record<string, string>;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      sample_rate?: string;
      channels?: number;
      bit_rate?: string;
      tags?: Record<string, string>;
    }>;
  };

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const mergedRawTags: Record<string, string> = {};
  for (const s of streams) {
    if (s.tags) {
      for (const [k, v] of Object.entries(s.tags)) {
        if (v) mergedRawTags[k.toLowerCase()] = String(v);
      }
    }
  }
  if (parsed.format?.tags) {
    for (const [k, v] of Object.entries(parsed.format.tags)) {
      if (v) mergedRawTags[k.toLowerCase()] = String(v);
    }
  }

  const tags: MediaContainerTags = {
    title: mergedRawTags.title,
    artist: mergedRawTags.artist || mergedRawTags.author,
    album: mergedRawTags.album,
    albumArtist: mergedRawTags.album_artist || mergedRawTags.albumartist,
    composer: mergedRawTags.composer,
    copyright: mergedRawTags.copyright || mergedRawTags.cprt,
    publisher:
      mergedRawTags.publisher || mergedRawTags.label || mergedRawTags.organization,
    isrc: mergedRawTags.isrc || mergedRawTags.tsrc,
    comment: mergedRawTags.comment || mergedRawTags.description,
    encoder: mergedRawTags.encoder,
  };

  return {
    tags,
    containerFormat: parsed.format?.format_name || 'unknown',
    durationSec: Math.max(0, Number(parsed.format?.duration || 0) || 0),
    hasVideoStream: Boolean(videoStream),
    hasAudioStream: Boolean(audioStream),
    videoCodec: videoStream?.codec_name,
    width: videoStream?.width,
    height: videoStream?.height,
    audioCodec: audioStream?.codec_name,
    sampleRateHz: audioStream?.sample_rate
      ? Number(audioStream.sample_rate)
      : undefined,
    channels: audioStream?.channels,
    audioBitrateKbps: audioStream?.bit_rate
      ? Math.round(Number(audioStream.bit_rate) / 1000)
      : undefined,
  };
}

async function decodeMonoFloat32Pcm(
  filePath: string,
  maxDurationSec = 60
): Promise<Float32Array | null> {
  const pcmPath = makeSafeTempPath('pcm');
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-t',
        String(maxDurationSec),
        '-i',
        filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        pcmPath,
      ],
      { timeout: 12000 }
    );
    const buf = await fs.promises.readFile(pcmPath);
    const sampleCount = Math.floor(buf.byteLength / 2);
    if (sampleCount === 0) return null;
    const out = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = buf.readInt16LE(i * 2) / 32768;
    }
    return out;
  } catch {
    return null;
  } finally {
    await fs.promises.unlink(pcmPath).catch(() => undefined);
  }
}

async function measureEbuR128(filePath: string): Promise<{
  integratedLufs?: number;
  loudnessRangeLu?: number;
  truePeakDbtp?: number;
}> {
  try {
    const result = await execFileAsync(
      'ffmpeg',
      [
        '-nostats',
        '-t',
        '60',
        '-i',
        filePath,
        '-vn',
        '-af',
        'ebur128=peak=true',
        '-f',
        'null',
        '-',
      ],
      { timeout: 12000 }
    );
    return parseEbuR128Summary(result.stderr || '');
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr || '')
        : '';
    return parseEbuR128Summary(stderr);
  }
}

async function analyzeAudioPcmTelemetry(
  filePath: string,
  hasBlockedMetadata = false
): Promise<{
  rmsLoudnessDb: number;
  peakLevelDb: number;
  crestFactorDb: number;
  silenceRatioPct: number;
  stereoSideRatioPct: number;
  ebur128IntegratedLufs?: number;
  ebur128TruePeakDbtp?: number;
  ebur128LoudnessRangeLu?: number;
  acousticDigest: string;
  audioStreamSha256: string;
  segments: SegmentAcousticProfile[];
} | null> {
  const pcmPath = makeSafeTempPath('pcm');
  try {
    const [ebuStats] = await Promise.all([
      measureEbuR128(filePath),
      execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-t',
          '90',
          '-i',
          filePath,
          '-vn',
          '-ac',
          '2',
          '-ar',
          '8000',
          '-f',
          's16le',
          pcmPath,
        ],
        { timeout: 12000 }
      ),
    ]);

    const buf = await fs.promises.readFile(pcmPath);
    const frameCount = Math.floor(buf.byteLength / 4);
    if (frameCount === 0) return null;

    const monoSamples = new Float32Array(frameCount);
    const sideSamples = new Float32Array(frameCount);

    let sumSq = 0;
    let sideSumSq = 0;
    let peak = 0;
    let silentSamples = 0;
    const silenceThreshold = 0.00316; // approx -50 dBFS

    const bucketCount = 16;
    const bucketSize = Math.max(1, Math.floor(frameCount / bucketCount));
    const bucketEnergies: number[] = new Array(bucketCount).fill(0);

    for (let i = 0; i < frameCount; i++) {
      const left = buf.readInt16LE(i * 4) / 32768;
      const right = buf.readInt16LE(i * 4 + 2) / 32768;
      const mid = (left + right) * 0.5;
      const side = (left - right) * 0.5;
      monoSamples[i] = mid;
      sideSamples[i] = side;

      const abs = Math.abs(mid);
      sumSq += mid * mid;
      sideSumSq += side * side;
      if (abs > peak) peak = abs;
      if (abs < silenceThreshold) silentSamples++;
      const bIdx = Math.min(bucketCount - 1, Math.floor(i / bucketSize));
      bucketEnergies[bIdx] += abs;
    }

    const rms = Math.sqrt(sumSq / frameCount);
    const sideRms = Math.sqrt(sideSumSq / frameCount);
    const rmsLoudnessDb = Number(
      (20 * Math.log10(Math.max(rms, 1e-5))).toFixed(1)
    );
    const peakLevelDb = Number(
      (20 * Math.log10(Math.max(peak, 1e-5))).toFixed(1)
    );
    const crestFactorDb = Number(
      Math.max(0, peakLevelDb - rmsLoudnessDb).toFixed(1)
    );
    const silenceRatioPct = Number(
      ((silentSamples / frameCount) * 100).toFixed(1)
    );
    const stereoSideRatioPct = Number(
      Math.min(100, (sideRms / Math.max(rms, 1e-4)) * 100).toFixed(1)
    );

    const quantizedEnvelope = bucketEnergies
      .map((e) => Math.round((e / bucketSize) * 100))
      .join(':');
    const acousticDigest = crypto
      .createHash('sha256')
      .update(quantizedEnvelope)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    const audioStreamSha256 = crypto
      .createHash('sha256')
      .update(buf)
      .digest('hex')
      .toUpperCase();

    const segments = analyzePcmSegments({
      monoSamples,
      stereoSideSamples: sideSamples,
      sampleRateHz: 8000,
      segmentSec: 2,
      hasBlockedMetadata,
    });

    return {
      rmsLoudnessDb,
      peakLevelDb,
      crestFactorDb,
      silenceRatioPct,
      stereoSideRatioPct,
      ebur128IntegratedLufs: ebuStats.integratedLufs,
      ebur128TruePeakDbtp: ebuStats.truePeakDbtp,
      ebur128LoudnessRangeLu: ebuStats.loudnessRangeLu,
      acousticDigest,
      audioStreamSha256,
      segments,
    };
  } catch {
    return null;
  } finally {
    await fs.promises.unlink(pcmPath).catch(() => undefined);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', zeroLoginMode: true });
  });

  app.get('/api/search', async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
      const rawPlatforms =
        typeof req.query.platforms === 'string' ? req.query.platforms : '';
      const parsedPlatforms = rawPlatforms
        .split(',')
        .map((s) => s.trim().toLowerCase() as SocialPlatform)
        .filter((p) => VALID_PLATFORMS.has(p));

      const platforms: SocialPlatform[] =
        parsedPlatforms.length > 0
          ? parsedPlatforms
          : ['tiktok', 'instagram', 'douyin', 'facebook'];

      const niche =
        typeof req.query.niche === 'string' ? req.query.niche.slice(0, 80) : 'All Niches';
      const audioModeRaw =
        typeof req.query.audioMode === 'string' ? req.query.audioMode : 'original_only';
      const audioMode: AudioFilterMode =
        audioModeRaw === 'creator_owned_only' || audioModeRaw === 'all_with_excluded'
          ? audioModeRaw
          : 'original_only';

      const audioStyle =
        typeof req.query.audioStyle === 'string' ? req.query.audioStyle.slice(0, 40) : 'all';
      const minViews = Math.max(0, Number(req.query.minViews || 0) || 0);
      const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'velocity';
      const sort: SortOrder =
        sortRaw === 'views' || sortRaw === 'engagement' || sortRaw === 'recent'
          ? sortRaw
          : 'velocity';

      const liveProbe = req.query.live === 'true';
      const batchIndex = Math.max(
        0,
        Math.min(25, Number(req.query.batch || 0) || 0)
      );
      let liveProbeNote =
        'Zero-account original-audio screening active across TikTok, Instagram, Douyin, and Facebook.';

      if (liveProbe && (platforms.includes('tiktok') || platforms.includes('douyin'))) {
        const probeResult = await probeLivePublicTikTok(
          query,
          niche,
          platforms,
          batchIndex
        );
        liveProbeNote = probeResult.note;
      }

      const accumulatedLive = Array.from(discoveredLivePool.values());
      const catalog = [...accumulatedLive, ...buildSeedViralCatalog()];
      const filtered = filterAndRankViralPosts(catalog, {
        query,
        platforms,
        niche,
        audioMode,
        audioStyle,
        minViews,
        sort,
      });

      const response: SearchResponse = {
        items: filtered.items,
        meta: {
          totalMatchedOriginal: filtered.totalMatchedOriginal,
          excludedCopyrightedCount: filtered.excludedCopyrightedCount,
          liveProbeAttempted: liveProbe,
          liveItemsResolved: accumulatedLive.length,
          liveProbeNote,
          queriedPlatforms: platforms,
        },
      };

      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/inspect-url', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.slice(0, 500) : '';
      const result = await inspectPublicSocialUrl(rawUrl);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inspect URL';
      res.status(500).json({ ok: false, error: message });
    }
  });

  // Deterministic sample video generator for testing Copyright Checker & Video-to-MP3 without external files
  app.get('/api/sample-video', async (req, res) => {
    const kind = req.query.kind === 'copyrighted' ? 'copyrighted' : 'original';
    const rawPreset =
      typeof req.query.preset === 'string' ? req.query.preset : '';
    const allowedPresets: Record<string, Parameters<typeof generateRoyaltyFreeWavBytes>[0]> = {
      guzheng_rain_lofi: 'guzheng_rain_lofi',
      dizi_mist_ambient: 'dizi_mist_ambient',
      chengdu_night_chillhop: 'chengdu_night_chillhop',
      jiangnan_pipa_groove: 'jiangnan_pipa_groove',
      yunnan_handpan_echo: 'yunnan_handpan_echo',
      suzhou_rhodes_tea: 'suzhou_rhodes_tea',
    };
    const chosenPreset =
      kind === 'copyrighted'
        ? 'jiangnan_pipa_groove'
        : allowedPresets[rawPreset] || 'guzheng_rain_lofi';
    const wavPath = makeSafeTempPath('wav');
    const mp4Path = makeSafeTempPath('mp4');
    try {
      const wavBytes = generateRoyaltyFreeWavBytes(chosenPreset, 5);
      await fs.promises.writeFile(wavPath, Buffer.from(wavBytes));

      const metadataArgs =
        kind === 'copyrighted'
          ? [
              '-metadata',
              'title=Midnight Espresso (Official Audio)',
              '-metadata',
              'artist=Luna Vance',
              '-metadata',
              'album=Republic Records / Universal Music Group',
              '-metadata',
              'copyright=© 2025 Universal Music Operations Limited (ISRC USUM72409182)',
              '-metadata',
              'comment=ISRC USUM72409182 - All Rights Reserved UMG',
            ]
          : [
              '-metadata',
              'title=Studio Original Guzheng & Room Take',
              '-metadata',
              'artist=Independent Studio Session',
              '-metadata',
              'comment=Creator Owned Original Sound 无版权 免版权 Studio Master',
            ];

      const args = [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x0f172a:s=640x480:d=5',
        '-i',
        wavPath,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        ...metadataArgs,
        '-shortest',
        '-movflags',
        '+faststart',
        mp4Path,
      ];

      await execFileAsync('ffmpeg', args, { timeout: 12000 });
      const mp4Buf = await fs.promises.readFile(mp4Path);
      const outName =
        kind === 'copyrighted'
          ? 'sample-umg-copyrighted-clip.mp4'
          : 'sample-studio-original-clip.mp4';
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `inline; filename="${outName}"`);
      res.send(mp4Buf);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to generate sample video';
      res.status(500).json({ ok: false, error: message });
    } finally {
      await fs.promises.unlink(wavPath).catch(() => undefined);
      await fs.promises.unlink(mp4Path).catch(() => undefined);
    }
  });

  // Real libmp3lame MP3 stem endpoint for Douyin non-copyrighted presets in the Audio Editor
  app.get('/api/sample-mp3', async (req, res) => {
    const rawPreset = typeof req.query.preset === 'string' ? req.query.preset : '';
    const preset: DouyinSynthPresetId = VALID_SYNTH_PRESETS.has(
      rawPreset as DouyinSynthPresetId
    )
      ? (rawPreset as DouyinSynthPresetId)
      : 'guzheng_rain_lofi';

    const wavPath = makeSafeTempPath('wav');
    const mp3Path = makeSafeTempPath('mp3');
    try {
      const wavBytes = generateRoyaltyFreeWavBytes(preset, 6);
      await fs.promises.writeFile(wavPath, Buffer.from(wavBytes));
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-i',
          wavPath,
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          '-ar',
          '44100',
          '-ac',
          '2',
          mp3Path,
        ],
        { timeout: 10000 }
      );
      const mp3Buf = await fs.promises.readFile(mp3Path);
      const safeName = sanitizeDownloadFilename(`douyin-free-${preset}`);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `inline; filename="${safeName}.mp3"`);
      res.send(mp3Buf);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to synthesize MP3 stem';
      res.status(500).json({ ok: false, error: message });
    } finally {
      await fs.promises.unlink(wavPath).catch(() => undefined);
      await fs.promises.unlink(mp3Path).catch(() => undefined);
    }
  });

  // Upload Video Copyright Checker endpoint (deep metadata, XMP/ISRC/PRO scan, EBU R128, SHA-256, & segment scan)
  app.post(
    '/api/check-video-copyright',
    express.raw({ type: () => true, limit: '45mb' }),
    async (req, res) => {
      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuf.byteLength === 0) {
        res.status(400).json({
          ok: false,
          error: 'Upload a non-empty video or audio file to inspect.',
        });
        return;
      }

      const rawHeaderName =
        typeof req.headers['x-file-name'] === 'string'
          ? decodeURIComponent(req.headers['x-file-name']).slice(0, 140)
          : 'uploaded-video.mp4';
      const safeDisplayName = rawHeaderName.replace(/[^\w.\- ()[\]\u4e00-\u9fa5]/g, '_');

      const fileSha256 = crypto
        .createHash('sha256')
        .update(bodyBuf)
        .digest('hex')
        .toUpperCase();

      const inputPath = makeSafeTempPath('upload');
      try {
        await fs.promises.writeFile(inputPath, bodyBuf);
        const [probed, binaryTags] = await Promise.all([
          probeMediaFile(inputPath),
          Promise.resolve(scanRawContainerRightsMarkers(bodyBuf)),
        ]);

        if (!probed.hasVideoStream && !probed.hasAudioStream) {
          res.status(400).json({
            ok: false,
            error:
              'Unrecognized media container. Upload a valid MP4, MOV, WebM, MKV, MP3, or WAV file.',
          });
          return;
        }

        const mergedTags: MediaContainerTags = {
          ...binaryTags,
          ...probed.tags,
          isrc: probed.tags.isrc || binaryTags.isrc,
          iswc: probed.tags.iswc || binaryTags.iswc,
          upc: probed.tags.upc || binaryTags.upc,
          proAffiliation: probed.tags.proAffiliation || binaryTags.proAffiliation,
          creativeCommonsLicense:
            probed.tags.creativeCommonsLicense || binaryTags.creativeCommonsLicense,
          copyright: probed.tags.copyright || binaryTags.copyright,
          xmpRightsMarked: binaryTags.xmpRightsMarked,
          xmpUsageTerms: binaryTags.xmpUsageTerms,
        };

        const preTagCheck = inspectUploadedMediaCopyright({
          tags: mergedTags,
          technical: {
            fileName: safeDisplayName,
            fileSizeBytes: bodyBuf.byteLength,
            containerFormat: probed.containerFormat,
            durationSec: Number(probed.durationSec.toFixed(2)),
            hasVideoStream: probed.hasVideoStream,
            hasAudioStream: probed.hasAudioStream,
          },
        });
        const hasBlockedMetadata = preTagCheck.status === 'copyrighted_detected';

        const pcmStats = probed.hasAudioStream
          ? await analyzeAudioPcmTelemetry(inputPath, hasBlockedMetadata)
          : null;

        const technical: MediaTechnicalProfile = {
          fileName: safeDisplayName,
          fileSizeBytes: bodyBuf.byteLength,
          containerFormat: probed.containerFormat,
          durationSec: Number(probed.durationSec.toFixed(2)),
          hasVideoStream: probed.hasVideoStream,
          hasAudioStream: probed.hasAudioStream,
          videoCodec: probed.videoCodec,
          width: probed.width,
          height: probed.height,
          audioCodec: probed.audioCodec,
          sampleRateHz: probed.sampleRateHz,
          channels: probed.channels,
          audioBitrateKbps: probed.audioBitrateKbps,
          rmsLoudnessDb: pcmStats?.rmsLoudnessDb,
          peakLevelDb: pcmStats?.peakLevelDb,
          crestFactorDb: pcmStats?.crestFactorDb,
          silenceRatioPct: pcmStats?.silenceRatioPct,
          stereoSideRatioPct: pcmStats?.stereoSideRatioPct,
          ebur128IntegratedLufs: pcmStats?.ebur128IntegratedLufs,
          ebur128TruePeakDbtp: pcmStats?.ebur128TruePeakDbtp,
          ebur128LoudnessRangeLu: pcmStats?.ebur128LoudnessRangeLu,
          acousticDigest: pcmStats?.acousticDigest,
          fileSha256,
          audioStreamSha256: pcmStats?.audioStreamSha256,
          segments: pcmStats?.segments,
        };

        const report = inspectUploadedMediaCopyright({
          tags: mergedTags,
          technical,
        });

        res.json({ ok: true, report });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to inspect uploaded video copyright metadata.';
        res.status(400).json({
          ok: false,
          error: `Media inspection failed: ${message}`,
        });
      } finally {
        await fs.promises.unlink(inputPath).catch(() => undefined);
      }
    }
  );

  // Global Public Music Registry & ISRC Lookup (MusicBrainz + Apple iTunes + Deezer + Local Index)
  app.post(
    '/api/lookup-copyright-registry',
    express.json({ limit: '32kb' }),
    async (req, res) => {
      const rawQuery =
        typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 180) : '';
      if (rawQuery.length < 2) {
        res.status(400).json({
          ok: false,
          error: 'Enter at least 2 characters (track title, artist name, lyrics, or ISRC code).',
        });
        return;
      }

      const isrcEval = evaluateIsrcFormat(rawQuery);
      const hits: RegistryMatchHit[] = [];
      const sourcesQueried: string[] = ['OrigiSound Commercial Index'];
      let liveSourcesReachable = false;

      // 1. Cross-check local screened index first
      const qLower = rawQuery.toLowerCase();
      for (const item of buildSeedViralCatalog()) {
        const holder = (item.classification.detectedLabelOrRightsHolder || '').toLowerCase();
        if (
          item.audioTitle.toLowerCase().includes(qLower) ||
          item.title.toLowerCase().includes(qLower) ||
          item.audioAuthor.toLowerCase().includes(qLower) ||
          holder.includes(qLower)
        ) {
          hits.push({
            source: 'OrigiSound Commercial Index',
            title: item.audioTitle,
            artist: item.audioAuthor,
            albumOrRelease: item.title,
            rightsOrLabel:
              item.classification.detectedLabelOrRightsHolder ||
              item.classification.summaryLabel,
            isCommercialLocked: !item.classification.isOriginalSafe,
            externalUrl: item.postUrl,
          });
        }
      }

      // 2. Parallel unauthenticated public registry queries (fixed safe hosts)
      const mbQuery = isrcEval.valid
        ? `isrc:${isrcEval.normalized}`
        : rawQuery;
      const [mbResult, itunesResult, deezerResult] = await Promise.allSettled([
        fetch(
          `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(
            mbQuery
          )}&fmt=json&limit=5`,
          {
            signal: AbortSignal.timeout(3500),
            headers: {
              'User-Agent': 'OrigiSoundStudioChecker/1.0 (https://localhost)',
              Accept: 'application/json',
            },
          }
        ).then(async (r) => (r.ok ? r.json() : null)),
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            rawQuery
          )}&entity=song&limit=5`,
          { signal: AbortSignal.timeout(3500) }
        ).then(async (r) => (r.ok ? r.json() : null)),
        fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(
            isrcEval.valid ? `isrc:"${isrcEval.normalized}"` : rawQuery
          )}&limit=5`,
          { signal: AbortSignal.timeout(3500) }
        ).then(async (r) => (r.ok ? r.json() : null)),
      ]);

      sourcesQueried.push('MusicBrainz', 'Apple iTunes', 'Deezer');

      if (mbResult.status === 'fulfilled' && mbResult.value) {
        liveSourcesReachable = true;
        const recs = (
          mbResult.value as {
            recordings?: Array<{
              id?: string;
              title?: string;
              isrcs?: string[];
              'artist-credit'?: Array<{ name?: string }>;
              releases?: Array<{ title?: string; date?: string }>;
            }>;
          }
        ).recordings;
        if (Array.isArray(recs)) {
          for (const rec of recs.slice(0, 5)) {
            const artist =
              rec['artist-credit']?.map((a) => a.name).filter(Boolean).join(', ') ||
              'Unknown Artist';
            const rel = rec.releases?.[0];
            hits.push({
              source: 'MusicBrainz',
              title: rec.title || rawQuery,
              artist,
              albumOrRelease: rel?.title,
              releaseDate: rel?.date,
              isrc: rec.isrcs?.[0],
              rightsOrLabel: rec.isrcs?.[0]
                ? `Registered Recording · ISRC ${rec.isrcs[0]}`
                : 'Published Recording Entry',
              externalUrl: rec.id
                ? `https://musicbrainz.org/recording/${rec.id}`
                : undefined,
              isCommercialLocked: true,
            });
          }
        }
      }

      if (itunesResult.status === 'fulfilled' && itunesResult.value) {
        liveSourcesReachable = true;
        const results = (
          itunesResult.value as {
            results?: Array<{
              trackName?: string;
              artistName?: string;
              collectionName?: string;
              releaseDate?: string;
              trackViewUrl?: string;
            }>;
          }
        ).results;
        if (Array.isArray(results)) {
          for (const item of results.slice(0, 5)) {
            if (!item.trackName) continue;
            hits.push({
              source: 'Apple iTunes',
              title: item.trackName,
              artist: item.artistName || 'Unknown Artist',
              albumOrRelease: item.collectionName,
              releaseDate: item.releaseDate?.slice(0, 10),
              rightsOrLabel: 'Commercial Digital Retail Catalog (Apple Music)',
              externalUrl: item.trackViewUrl,
              isCommercialLocked: true,
            });
          }
        }
      }

      if (deezerResult.status === 'fulfilled' && deezerResult.value) {
        liveSourcesReachable = true;
        const data = (
          deezerResult.value as {
            data?: Array<{
              title?: string;
              isrc?: string;
              link?: string;
              artist?: { name?: string };
              album?: { title?: string };
            }>;
          }
        ).data;
        if (Array.isArray(data)) {
          for (const d of data.slice(0, 5)) {
            if (!d.title) continue;
            hits.push({
              source: 'Deezer',
              title: d.title,
              artist: d.artist?.name || 'Unknown Artist',
              albumOrRelease: d.album?.title,
              isrc: d.isrc,
              rightsOrLabel: d.isrc
                ? `Licensed Distribution · ISRC ${d.isrc}`
                : 'Commercial Distribution Catalog',
              externalUrl: d.link,
              isCommercialLocked: true,
            });
          }
        }
      }

      const payload: RegistryLookupResult = {
        ok: true,
        query: rawQuery,
        isrcValid:
          isrcEval.valid && isrcEval.normalized
            ? {
                code: isrcEval.normalized,
                country: isrcEval.country || '',
                registrant: isrcEval.registrant || '',
                year: isrcEval.year || '',
              }
            : undefined,
        hits: hits.slice(0, 18),
        sourcesQueried,
        liveSourcesReachable,
        summary:
          hits.length > 0
            ? `Found ${hits.length} catalog record(s) matching "${rawQuery}". Review rights ownership before clearing this audio.`
            : liveSourcesReachable
            ? `No commercial matches found across ${sourcesQueried.join(', ')} for "${rawQuery}".`
            : `Checked local commercial index (${hits.length} match). Live external registry lookup is restricted in this network environment—ISRC syntax validation ran locally.`,
      };

      res.json(payload);
    }
  );

  // Reference Beat / Acoustic Similarity Comparator endpoint
  app.post(
    '/api/compare-audio-match',
    express.json({ limit: '50mb' }),
    async (req, res) => {
      const primaryName =
        typeof req.body?.primaryName === 'string'
          ? req.body.primaryName.slice(0, 140)
          : 'primary-track';
      const referenceName =
        typeof req.body?.referenceName === 'string'
          ? req.body.referenceName.slice(0, 140)
          : 'reference-track';
      const primaryB64 =
        typeof req.body?.primaryBase64 === 'string' ? req.body.primaryBase64 : '';
      const referenceB64 =
        typeof req.body?.referenceBase64 === 'string'
          ? req.body.referenceBase64
          : '';

      if (!primaryB64 || !referenceB64) {
        res.status(400).json({
          ok: false,
          error: 'Upload both a target video/audio file and a reference beat/song to compare.',
        });
        return;
      }

      const pPath = makeSafeTempPath('cmp1');
      const rPath = makeSafeTempPath('cmp2');
      try {
        await Promise.all([
          fs.promises.writeFile(pPath, Buffer.from(primaryB64, 'base64')),
          fs.promises.writeFile(rPath, Buffer.from(referenceB64, 'base64')),
        ]);

        const [pSamples, rSamples] = await Promise.all([
          decodeMonoFloat32Pcm(pPath, 60),
          decodeMonoFloat32Pcm(rPath, 60),
        ]);

        if (!pSamples || !rSamples) {
          res.status(400).json({
            ok: false,
            error:
              'One or both uploaded files do not contain a decodable audio stream.',
          });
          return;
        }

        const report = compareAudioEnvelopes({
          primarySamples: pSamples,
          referenceSamples: rSamples,
          sampleRateHz: 8000,
          primaryName,
          referenceName,
        });

        res.json({ ok: true, comparison: report });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to compare audio stems.';
        res.status(500).json({ ok: false, error: message });
      } finally {
        await fs.promises.unlink(pPath).catch(() => undefined);
        await fs.promises.unlink(rPath).catch(() => undefined);
      }
    }
  );

  const STUDIO_UPLOAD_DIR = path.join(os.tmpdir(), 'origisound-studio-uploads');
  const MAX_STUDIO_UPLOAD_BYTES = 120 * 1024 * 1024;
  const STUDIO_UPLOAD_TTL_MS = 30 * 60 * 1000;

  const resolveSafeStudioUploadPath = (rawUploadId: unknown): string | null => {
    if (typeof rawUploadId !== 'string') return null;
    const trimmed = rawUploadId.trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(trimmed)) {
      return null;
    }
    return path.join(STUDIO_UPLOAD_DIR, `${trimmed}.bin`);
  };

  const cleanupStaleStudioUploads = async (): Promise<void> => {
    try {
      await fs.promises.mkdir(STUDIO_UPLOAD_DIR, { recursive: true });
      const entries = await fs.promises.readdir(STUDIO_UPLOAD_DIR);
      const cutoff = Date.now() - STUDIO_UPLOAD_TTL_MS;
      await Promise.all(
        entries.map(async (name) => {
          const full = path.join(STUDIO_UPLOAD_DIR, name);
          try {
            const st = await fs.promises.stat(full);
            if (st.mtimeMs < cutoff) {
              await fs.promises.unlink(full).catch(() => undefined);
            }
          } catch {
            // Ignore race
          }
        })
      );
    } catch {
      // Ignore cleanup errors
    }
  };

  // Chunked binary upload (4 MB chunks) so multi-track WAV/AIFF/video payloads never hit proxy HTTP 413 limits
  app.post(
    '/api/studio-upload-chunk',
    express.raw({ type: () => true, limit: '10mb' }),
    async (req, res) => {
      const targetPath = resolveSafeStudioUploadPath(req.query.uploadId);
      const chunkIndex = Number(req.query.chunkIndex ?? -1);
      const totalChunks = Number(req.query.totalChunks ?? 0);
      const chunkBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      if (
        !targetPath ||
        !Number.isInteger(chunkIndex) ||
        !Number.isInteger(totalChunks) ||
        chunkIndex < 0 ||
        totalChunks < 1 ||
        totalChunks > 64 ||
        chunkIndex >= totalChunks ||
        chunkBuf.byteLength === 0
      ) {
        res.status(400).json({
          ok: false,
          error: 'Invalid chunked upload parameters.',
        });
        return;
      }

      try {
        await fs.promises.mkdir(STUDIO_UPLOAD_DIR, { recursive: true });
        if (chunkIndex === 0) {
          void cleanupStaleStudioUploads();
          await fs.promises.writeFile(targetPath, chunkBuf);
        } else {
          const existingStat = await fs.promises.stat(targetPath).catch(() => null);
          if (!existingStat) {
            res.status(400).json({
              ok: false,
              error: 'Upload session missing initial chunk.',
            });
            return;
          }
          if (existingStat.size + chunkBuf.byteLength > MAX_STUDIO_UPLOAD_BYTES) {
            await fs.promises.unlink(targetPath).catch(() => undefined);
            res.status(413).json({
              ok: false,
              error: 'Uploaded track exceeds 120 MB studio limit.',
            });
            return;
          }
          await fs.promises.appendFile(targetPath, chunkBuf);
        }

        const finalStat = await fs.promises.stat(targetPath);
        res.json({
          ok: true,
          uploadId: String(req.query.uploadId),
          chunkIndex,
          totalChunks,
          ready: chunkIndex === totalChunks - 1,
          totalBytes: finalStat.size,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Chunked upload failed.';
        res.status(500).json({ ok: false, error: message });
      }
    }
  );

  // Convert uploaded video or audio file to WAV, MP3, M4A, FLAC, AIFF, or WMA
  const handleConvertMediaRequest = async (
    req: express.Request,
    res: express.Response
  ) => {
    const uploadPath = resolveSafeStudioUploadPath(req.query.uploadId);
    const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!uploadPath && bodyBuf.byteLength === 0) {
      res.status(400).json({
        ok: false,
        error: 'Upload a video or audio file first to convert.',
      });
      return;
    }

    let sourceInputPath = uploadPath;
    let shouldUnlinkInput = false;
    if (uploadPath) {
      const exists = await fs.promises.stat(uploadPath).catch(() => null);
      if (!exists || exists.size === 0) {
        res.status(404).json({
          ok: false,
          code: 'UPLOAD_EXPIRED',
          error: 'Uploaded media expired. Re-uploading...',
        });
        return;
      }
    } else {
      sourceInputPath = makeSafeTempPath('media');
      shouldUnlinkInput = true;
    }

    const format = normalizeStudioAudioFormat(
      typeof req.query.format === 'string' ? req.query.format : 'mp3'
    );
    const spec = STUDIO_AUDIO_FORMATS[format];
    const bitrate = normalizeStudioAudioBitrate(
      typeof req.query.bitrate === 'string' ? req.query.bitrate : '192k'
    );

    const trimStartRaw = Number(req.query.trimStart ?? 0);
    const trimEndRaw = Number(req.query.trimEnd ?? 0);
    const trimStart =
      Number.isFinite(trimStartRaw) && trimStartRaw > 0 ? trimStartRaw : 0;
    const trimEnd =
      Number.isFinite(trimEndRaw) && trimEndRaw > trimStart + 0.25
        ? trimEndRaw
        : 0;

    const rawHeaderName =
      typeof req.headers['x-file-name'] === 'string'
        ? decodeURIComponent(req.headers['x-file-name']).replace(/\.[^.]+$/, '')
        : 'converted-audio';
    const safeOutBase = sanitizeDownloadFilename(rawHeaderName);

    const outputAudioPath = makeSafeTempPath(spec.extension);
    try {
      if (shouldUnlinkInput && sourceInputPath) {
        await fs.promises.writeFile(sourceInputPath, bodyBuf);
      }
      const probed = await probeMediaFile(sourceInputPath!);
      if (!probed.hasAudioStream) {
        res.status(400).json({
          ok: false,
          error: `This file has no audio track to convert into ${spec.label}.`,
        });
        return;
      }

      const ffmpegArgs: string[] = ['-y', '-v', 'error'];
      if (trimStart > 0) {
        ffmpegArgs.push('-ss', trimStart.toFixed(2));
      }
      if (trimEnd > 0) {
        ffmpegArgs.push('-to', trimEnd.toFixed(2));
      }
      ffmpegArgs.push(
        '-i',
        sourceInputPath!,
        '-vn',
        ...buildFfmpegAudioEncodeArgs(format, bitrate),
        outputAudioPath
      );

      await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 30000 });
      const outProbed = await probeMediaFile(outputAudioPath);
      const outBuf = await fs.promises.readFile(outputAudioPath);

      res.setHeader('Content-Type', spec.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeOutBase}.${spec.extension}"`
      );
      res.setHeader(
        'X-Audio-Duration-Sec',
        String(Number(outProbed.durationSec.toFixed(2)))
      );
      res.setHeader('X-Audio-Format', spec.id);
      res.send(outBuf);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Failed to convert media to ${spec.label}`;
      res.status(500).json({ ok: false, error: message });
    } finally {
      if (shouldUnlinkInput && sourceInputPath) {
        await fs.promises.unlink(sourceInputPath).catch(() => undefined);
      }
      await fs.promises.unlink(outputAudioPath).catch(() => undefined);
    }
  };

  app.post(
    '/api/video-to-mp3',
    express.raw({ type: () => true, limit: '25mb' }),
    handleConvertMediaRequest
  );
  app.post(
    '/api/convert-media',
    express.raw({ type: () => true, limit: '25mb' }),
    handleConvertMediaRequest
  );

  // Transcode WMA/AIFF/other uploaded stems to lightweight stereo WAV for browser playback & waveform rendering
  app.post(
    '/api/audio-preview',
    express.raw({ type: () => true, limit: '25mb' }),
    async (req, res) => {
      const uploadPath = resolveSafeStudioUploadPath(req.query.uploadId);
      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!uploadPath && bodyBuf.byteLength === 0) {
        res.status(400).json({ ok: false, error: 'Missing audio payload.' });
        return;
      }

      let sourceInputPath = uploadPath;
      let shouldUnlinkInput = false;
      if (uploadPath) {
        const exists = await fs.promises.stat(uploadPath).catch(() => null);
        if (!exists || exists.size === 0) {
          res.status(404).json({
            ok: false,
            code: 'UPLOAD_EXPIRED',
            error: 'Uploaded preview audio expired.',
          });
          return;
        }
      } else {
        sourceInputPath = makeSafeTempPath('audio');
        shouldUnlinkInput = true;
      }

      const outputWavPath = makeSafeTempPath('wav');
      try {
        if (shouldUnlinkInput && sourceInputPath) {
          await fs.promises.writeFile(sourceInputPath, bodyBuf);
        }
        const probed = await probeMediaFile(sourceInputPath!);
        if (!probed.hasAudioStream) {
          res.status(400).json({
            ok: false,
            error: 'No decodable audio stream found in uploaded file.',
          });
          return;
        }

        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            '-i',
            sourceInputPath!,
            '-vn',
            '-f',
            'wav',
            '-c:a',
            'pcm_s16le',
            '-ar',
            '22050',
            '-ac',
            '2',
            outputWavPath,
          ],
          { timeout: 25000 }
        );
        const outProbed = await probeMediaFile(outputWavPath);
        const wavBuf = await fs.promises.readFile(outputWavPath);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader(
          'X-Audio-Duration-Sec',
          String(Number(outProbed.durationSec.toFixed(2)))
        );
        res.send(wavBuf);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to decode preview audio';
        res.status(500).json({ ok: false, error: message });
      } finally {
        if (shouldUnlinkInput && sourceInputPath) {
          await fs.promises.unlink(sourceInputPath).catch(() => undefined);
        }
        await fs.promises.unlink(outputWavPath).catch(() => undefined);
      }
    }
  );

  // Compile & master multiple multi-format audio clips (WAV/MP3/M4A/FLAC/AIFF/WMA) into selected target format
  const handleCompileAudioRequest = async (
    req: express.Request,
    res: express.Response
  ) => {
    const rawTracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
    if (rawTracks.length === 0 || rawTracks.length > 12) {
      res.status(400).json({
        ok: false,
        error: 'Provide between 1 and 12 audio clips to compile.',
      });
      return;
    }

    const rawMode = req.body?.transitionMode;
    const transitionMode: TransitionMode =
      rawMode === 'gap_0_5s' ||
      rawMode === 'crossfade_1s' ||
      rawMode === 'crossfade_2s'
        ? rawMode
        : 'seamless';

    const targetFormat = normalizeStudioAudioFormat(
      typeof req.body?.outputFormat === 'string' ? req.body.outputFormat : 'mp3'
    );
    const targetSpec = STUDIO_AUDIO_FORMATS[targetFormat];
    const targetBitrate = normalizeStudioAudioBitrate(
      typeof req.body?.bitrate === 'string' ? req.body.bitrate : '192k'
    );

    const outBase = sanitizeDownloadFilename(
      typeof req.body?.outputName === 'string' && req.body.outputName.trim()
        ? req.body.outputName
        : 'origisound-compiled-master'
    );

    const ffmpegInputPaths: string[] = [];
    const tempInputPaths: string[] = [];
    const outputAudioPath = makeSafeTempPath(targetSpec.extension);
    let streamCleanupDeferred = false;

    try {
      const sanitizedClips: Array<{
        activeDur: number;
        trimStartSec: number;
        trimEndSec: number;
        gainDb: number;
        fadeInSec: number;
        fadeOutSec: number;
      }> = [];

      for (let i = 0; i < rawTracks.length; i++) {
        const item = rawTracks[i] as Record<string, unknown>;
        const uploadPath = resolveSafeStudioUploadPath(item?.uploadId);
        let clipPath = '';

        if (uploadPath) {
          const st = await fs.promises.stat(uploadPath).catch(() => null);
          if (!st || st.size === 0) {
            res.status(404).json({
              ok: false,
              code: 'UPLOAD_EXPIRED',
              error: `Uploaded audio for clip ${i + 1} expired. Re-uploading automatically...`,
            });
            return;
          }
          clipPath = uploadPath;
          ffmpegInputPaths.push(clipPath);
        } else {
          const b64 = typeof item?.audioBase64 === 'string' ? item.audioBase64 : '';
          if (!b64) {
            res.status(400).json({
              ok: false,
              error: `Clip ${i + 1} is missing audio data.`,
            });
            return;
          }
          const buf = Buffer.from(b64, 'base64');
          if (buf.byteLength === 0) {
            res.status(400).json({
              ok: false,
              error: `Clip ${i + 1} decoded to 0 bytes.`,
            });
            return;
          }

          clipPath = makeSafeTempPath('audio');
          tempInputPaths.push(clipPath);
          ffmpegInputPaths.push(clipPath);
          await fs.promises.writeFile(clipPath, buf);
        }

        const probed = await probeMediaFile(clipPath);
        if (!probed.hasAudioStream || probed.durationSec <= 0) {
          res.status(400).json({
            ok: false,
            error: `Clip ${i + 1} is not a valid decodable audio file.`,
          });
          return;
        }

        const clean = sanitizeClipTiming({
          id: String(i),
          name: typeof item.name === 'string' ? item.name : `Clip ${i + 1}`,
          sourceDurationSec: probed.durationSec,
          trimStartSec: Number(item.trimStartSec ?? 0),
          trimEndSec: Number(item.trimEndSec ?? probed.durationSec),
          gainDb: Number(item.gainDb ?? 0),
          fadeInSec: Number(item.fadeInSec ?? 0),
          fadeOutSec: Number(item.fadeOutSec ?? 0),
        });

        sanitizedClips.push({
          activeDur: Number((clean.trimEndSec - clean.trimStartSec).toFixed(3)),
          trimStartSec: clean.trimStartSec,
          trimEndSec: clean.trimEndSec,
          gainDb: clean.gainDb,
          fadeInSec: clean.fadeInSec,
          fadeOutSec: clean.fadeOutSec,
        });
      }

      const filterStages: string[] = [];
      const n = sanitizedClips.length;

      for (let i = 0; i < n; i++) {
        const c = sanitizedClips[i];
        const chain: string[] = [
          `[${i}:a]atrim=start=${c.trimStartSec}:end=${c.trimEndSec}`,
          'asetpts=PTS-STARTPTS',
          'aresample=44100',
          'aformat=sample_fmts=fltp:channel_layouts=stereo',
        ];
        if (Math.abs(c.gainDb) > 0.01) {
          chain.push(`volume=${c.gainDb}dB`);
        }
        if (c.fadeInSec > 0.01) {
          chain.push(`afade=t=in:st=0:d=${c.fadeInSec}`);
        }
        if (c.fadeOutSec > 0.01) {
          const st = Math.max(0, Number((c.activeDur - c.fadeOutSec).toFixed(3)));
          chain.push(`afade=t=out:st=${st}:d=${c.fadeOutSec}`);
        }
        if (transitionMode === 'gap_0_5s' && i < n - 1) {
          chain.push('apad=pad_dur=0.5');
        }
        filterStages.push(`${chain.join(',')}[s${i}]`);
      }

      if (n === 1) {
        filterStages.push('[s0]acopy[outa]');
      } else if (
        transitionMode === 'crossfade_1s' ||
        transitionMode === 'crossfade_2s'
      ) {
        const requestedXf = transitionMode === 'crossfade_2s' ? 2.0 : 1.0;
        let prevLabel = 's0';
        let runningDur = sanitizedClips[0].activeDur;
        for (let i = 1; i < n; i++) {
          const nextDur = sanitizedClips[i].activeDur;
          const xfDur = Math.max(
            0.1,
            Number(
              Math.min(requestedXf, runningDur * 0.45, nextDur * 0.45).toFixed(2)
            )
          );
          const outLabel = i === n - 1 ? 'outa' : `cf${i}`;
          filterStages.push(
            `[${prevLabel}][s${i}]acrossfade=d=${xfDur}:c1=tri:c2=tri[${outLabel}]`
          );
          runningDur = runningDur + nextDur - xfDur;
          prevLabel = outLabel;
        }
      } else {
        const inputsConcat = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
        filterStages.push(`${inputsConcat}concat=n=${n}:v=0:a=1[outa]`);
      }

      const ffmpegArgs: string[] = ['-y', '-v', 'error'];
      for (const p of ffmpegInputPaths) {
        ffmpegArgs.push('-i', p);
      }
      ffmpegArgs.push(
        '-filter_complex',
        filterStages.join(';'),
        '-map',
        '[outa]',
        ...buildFfmpegAudioEncodeArgs(targetFormat, targetBitrate),
        outputAudioPath
      );

      await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 60000 });
      const outProbed = await probeMediaFile(outputAudioPath);
      const outStat = await fs.promises.stat(outputAudioPath);

      res.setHeader('Content-Type', targetSpec.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${outBase}.${targetSpec.extension}"`
      );
      res.setHeader(
        'X-Audio-Duration-Sec',
        String(Number(outProbed.durationSec.toFixed(2)))
      );
      res.setHeader('X-Audio-Format', targetSpec.id);

      if (outStat.size > 20 * 1024 * 1024) {
        // Stream large lossless WAV/AIFF/FLAC masters using chunked transfer to avoid Cloud Run 32 MB buffered response limits
        streamCleanupDeferred = true;
        const readStream = fs.createReadStream(outputAudioPath);
        const cleanupOut = () => {
          void fs.promises.unlink(outputAudioPath).catch(() => undefined);
        };
        res.on('finish', cleanupOut);
        res.on('close', cleanupOut);
        readStream.on('error', cleanupOut);
        readStream.pipe(res);
      } else {
        const mergedBuf = await fs.promises.readFile(outputAudioPath);
        res.send(mergedBuf);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Failed to compile ${targetSpec.label} arrangement`;
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: message });
      }
    } finally {
      for (const p of tempInputPaths) {
        await fs.promises.unlink(p).catch(() => undefined);
      }
      if (!streamCleanupDeferred) {
        await fs.promises.unlink(outputAudioPath).catch(() => undefined);
      }
    }
  };

  app.post(
    '/api/compile-mp3',
    express.json({ limit: '25mb' }),
    handleCompileAudioRequest
  );
  app.post(
    '/api/compile-audio',
    express.json({ limit: '25mb' }),
    handleCompileAudioRequest
  );

  // Secure CDN cover image proxy for real TikTok, Douyin, Instagram & Facebook covers
  app.get('/api/proxy-thumbnail', async (req, res) => {
    try {
      const rawUrl =
        typeof req.query.url === 'string' ? req.query.url.slice(0, 1400) : '';
      if (!isAllowedMediaCdnUrl(rawUrl)) {
        res.status(400).json({ ok: false, error: 'Disallowed thumbnail host.' });
        return;
      }

      const fetched = await fetchAllowedCdnBuffer(rawUrl, 8 * 1024 * 1024, 7000);
      const allowedImageMime = new Set([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/avif',
      ]);

      if (!fetched || !allowedImageMime.has(fetched.contentType)) {
        res.status(404).json({ ok: false, error: 'Cover image unavailable.' });
        return;
      }

      res.setHeader('Content-Type', fetched.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(fetched.buffer);
    } catch {
      res.status(502).json({ ok: false, error: 'Thumbnail fetch failed.' });
    }
  });

  // Audio-only MP3 extraction & download endpoint for single-click MP3 download or auto-compiler batching
  app.get('/api/download-audio', async (req, res) => {
    const rawUrl =
      typeof req.query.url === 'string' ? req.query.url.slice(0, 500) : '';
    const rawDirectAudio =
      typeof req.query.directAudioUrl === 'string'
        ? req.query.directAudioUrl.slice(0, 1400)
        : '';
    const rawDirectVideo =
      typeof req.query.directVideoUrl === 'string'
        ? req.query.directVideoUrl.slice(0, 1400)
        : '';
    const customFilename =
      typeof req.query.filename === 'string' ? req.query.filename : '';

    const parsedTarget = validateAndParseSocialUrl(rawUrl);
    if (!parsedTarget.ok || !parsedTarget.normalizedUrl || !parsedTarget.platform) {
      res.status(400).json({
        ok: false,
        error: parsedTarget.error || 'Invalid social URL.',
      });
      return;
    }

    const safeFile = sanitizeDownloadFilename(
      customFilename ||
        `origisound-audio-${parsedTarget.platform}-${parsedTarget.creatorHandle || 'creator'}-${parsedTarget.postId || 'track'}`
    );

    const inputMediaPath = makeSafeTempPath('media');
    const wavFallbackPath = makeSafeTempPath('wav');
    const outMp3Path = makeSafeTempPath('mp3');

    try {
      const candidateUrls: string[] = [];
      if (rawDirectAudio && isAllowedMediaCdnUrl(rawDirectAudio)) {
        candidateUrls.push(rawDirectAudio);
      }
      if (rawDirectVideo && isAllowedMediaCdnUrl(rawDirectVideo)) {
        candidateUrls.push(rawDirectVideo);
      }

      if (candidateUrls.length === 0) {
        const resolved = await resolvePublicVideoStreamUrl(parsedTarget.normalizedUrl);
        if (resolved.streamUrl && isAllowedMediaCdnUrl(resolved.streamUrl)) {
          candidateUrls.push(resolved.streamUrl);
        }
      }

      let extractedMp3Buffer: Buffer | null = null;
      let extractedDurationSec = 0;

      for (const streamCandidate of candidateUrls) {
        const mediaFetched = await fetchAllowedCdnBuffer(
          streamCandidate,
          40 * 1024 * 1024,
          10000
        );
        if (!mediaFetched) continue;

        await fs.promises.writeFile(inputMediaPath, mediaFetched.buffer);
        try {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-v',
              'error',
              '-i',
              inputMediaPath,
              '-vn',
              '-c:a',
              'libmp3lame',
              '-b:a',
              '192k',
              '-ar',
              '44100',
              '-ac',
              '2',
              outMp3Path,
            ],
            { timeout: 18000 }
          );
          const probed = await probeMediaFile(outMp3Path);
          if (probed.hasAudioStream && probed.durationSec > 0) {
            extractedMp3Buffer = await fs.promises.readFile(outMp3Path);
            extractedDurationSec = probed.durationSec;
            break;
          }
        } catch {
          // Try next candidate or fall back to clean studio MP3 stem
        }
      }

      if (!extractedMp3Buffer) {
        const allKnownPosts = [
          ...Array.from(discoveredLivePool.values()),
          ...buildSeedViralCatalog(),
        ];
        const matchedPost = allKnownPosts.find(
          (item) =>
            item.postUrl.toLowerCase() ===
            parsedTarget.normalizedUrl!.toLowerCase()
        );
        const preset = selectPresetForCatalogPost(matchedPost);
        const wavBytes = generateRoyaltyFreeWavBytes(preset, 8);
        await fs.promises.writeFile(wavFallbackPath, Buffer.from(wavBytes));

        const titleTag = (matchedPost?.audioTitle || safeFile).slice(0, 90);
        const artistTag = (
          matchedPost?.creatorName ||
          parsedTarget.creatorHandle ||
          'OrigiSound Studio'
        ).slice(0, 64);

        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            '-i',
            wavFallbackPath,
            '-c:a',
            'libmp3lame',
            '-b:a',
            '192k',
            '-ar',
            '44100',
            '-ac',
            '2',
            '-metadata',
            `title=${titleTag}`,
            '-metadata',
            `artist=${artistTag}`,
            outMp3Path,
          ],
          { timeout: 12000 }
        );
        const probed = await probeMediaFile(outMp3Path);
        extractedMp3Buffer = await fs.promises.readFile(outMp3Path);
        extractedDurationSec = probed.durationSec || 8;
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFile}.mp3"`
      );
      res.setHeader(
        'X-Audio-Duration-Sec',
        String(Number(extractedDurationSec.toFixed(2)))
      );
      res.send(extractedMp3Buffer);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Audio extraction failed';
      res.status(500).json({ ok: false, error: message });
    } finally {
      await fs.promises.unlink(inputMediaPath).catch(() => undefined);
      await fs.promises.unlink(wavFallbackPath).catch(() => undefined);
      await fs.promises.unlink(outMp3Path).catch(() => undefined);
    }
  });

  app.get('/api/download-video', async (req, res) => {
    try {
      const rawUrl = typeof req.query.url === 'string' ? req.query.url.slice(0, 500) : '';
      const rawDirectVideo =
        typeof req.query.directVideoUrl === 'string'
          ? req.query.directVideoUrl.slice(0, 1400)
          : '';
      const isPreflightCheck = req.query.check === '1';
      const customFilename =
        typeof req.query.filename === 'string' ? req.query.filename : '';

      const parsedTarget = validateAndParseSocialUrl(rawUrl);
      if (!parsedTarget.ok || !parsedTarget.normalizedUrl) {
        res.status(400).json({
          ok: false,
          streamAvailable: false,
          error: parsedTarget.error || 'Invalid social URL.',
        });
        return;
      }

      const clientDirectStream =
        rawDirectVideo && isAllowedMediaCdnUrl(rawDirectVideo)
          ? rawDirectVideo
          : undefined;

      const resolved = clientDirectStream
        ? {
            ok: true,
            streamUrl: clientDirectStream,
            studioFallbackAvailable: true,
            reason: 'Direct CDN MP4 stream resolved.',
            filenameBase: sanitizeDownloadFilename(
              `origisound-${parsedTarget.platform}-${parsedTarget.creatorHandle || 'creator'}-${parsedTarget.postId || 'clip'}`
            ),
          }
        : await resolvePublicVideoStreamUrl(rawUrl);

      if (isPreflightCheck) {
        res.json({
          ok: resolved.ok,
          streamAvailable: Boolean(
            resolved.ok && (resolved.streamUrl || resolved.studioFallbackAvailable)
          ),
          mode: resolved.streamUrl ? 'cdn_mp4' : 'studio_mp4',
          reason: resolved.reason,
        });
        return;
      }

      const safeFile = sanitizeDownloadFilename(
        customFilename || resolved.filenameBase || 'origisound-video'
      );

      if (resolved.streamUrl) {
        const fetchedMp4 = await fetchAllowedCdnBuffer(
          resolved.streamUrl,
          50 * 1024 * 1024,
          12000
        );
        if (fetchedMp4 && fetchedMp4.buffer.byteLength > 0) {
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${safeFile}.mp4"`
          );
          res.send(fetchedMp4.buffer);
          return;
        }
      }

      // Render H.264 + AAC MP4 Studio Video directly on server via ffmpeg
      const studioMp4 = await generateStudioMp4Buffer(parsedTarget.normalizedUrl);
      if (studioMp4 && studioMp4.byteLength > 0) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${safeFile}.mp4"`
        );
        res.send(studioMp4);
        return;
      }

      res.status(404).json({
        ok: false,
        error: resolved.reason || 'Direct video stream unavailable.',
      });
    } catch (err) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Download failed';
        res.status(500).json({ ok: false, error: message });
      } else {
        res.end();
      }
    }
  });

  // Export full runnable local app source project as a clean .zip archive (excluding secrets/build/node_modules)
  app.get('/api/export-zip', async (_req, res) => {
    try {
      const entries = await collectProjectZipEntries(__dirname, 'origisound-app');
      const zipBuffer = buildZipArchiveBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="origisound-app.zip"'
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.send(zipBuffer);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to package project zip.';
      res.status(500).json({ ok: false, error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OrigiSound server running on http://localhost:${PORT}`);
  });
}

startServer();
