import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudioRights, computeViralityMetrics } from './audioClassifier';
import {
  isAllowedMediaCdnUrl,
  sanitizeDownloadFilename,
  validateAndParseSocialUrl,
} from './urlSafety';
import { buildZeroLoginQueries } from './queryBuilder';
import { buildSeedViralCatalog } from './seedCatalog';
import { filterAndRankViralPosts } from './searchEngine';
import { generateRoyaltyFreeWavBytes } from './royaltyFreeSynth';

test('classifyAudioRights identifies creator-owned original sound across TikTok, Instagram, Douyin, and Facebook', () => {
  const tiktok = classifyAudioRights({
    platform: 'tiktok',
    creatorHandle: 'kojitimber',
    audioTitle: 'original sound - kojitimber',
    audioAuthor: 'kojitimber',
    caption: 'unedited shop mic only. 0.04mm shavings #originalsound #rawaudio',
  });
  assert.equal(tiktok.status, 'verified_original');
  assert.equal(tiktok.isOriginalSafe, true);
  assert.equal(tiktok.isCreatorOwned, true);
  assert.equal(tiktok.audioStyle, 'ambient_raw');

  const douyin = classifyAudioRights({
    platform: 'douyin',
    creatorHandle: 'laochen_wok',
    creatorName: '老陈夜市铁锅',
    audioTitle: '@老陈夜市铁锅 创作的原声',
    audioAuthor: 'laochen_wok',
    caption: '夜市猛火炒面全程无BGM #原声 #沉浸式',
  });
  assert.equal(douyin.status, 'verified_original');
  assert.equal(douyin.isOriginalSafe, true);
  assert.equal(douyin.audioStyle, 'ambient_raw');

  const douyinFreeBgm = classifyAudioRights({
    platform: 'douyin',
    creatorHandle: 'suhang_lofi',
    creatorName: '苏杭弦音独立制作',
    audioTitle: '@苏杭弦音独立制作 创作的原声 (无版权可商用BGM)',
    audioAuthor: 'suhang_lofi',
    caption: '自编古筝五声Lo-Fi伴奏 #无版权音乐 #原创纯音乐',
  });
  assert.equal(douyinFreeBgm.status, 'verified_original');
  assert.equal(douyinFreeBgm.isOriginalSafe, true);
  assert.equal(douyinFreeBgm.audioStyle, 'royalty_free_music');
  assert.ok(
    douyinFreeBgm.signals.some((s) => s.code === 'ROYALTY_FREE_MUSIC_GRANT')
  );

  const spanish = classifyAudioRights({
    platform: 'facebook',
    creatorHandle: 'cocinadecomal',
    creatorName: 'Cocina De Comal',
    audioTitle: 'Sonido original - Cocina De Comal',
    audioAuthor: 'cocinadecomal',
    caption: 'asking commuters outside market',
  });
  assert.equal(spanish.status, 'verified_original');
  assert.equal(spanish.isOriginalSafe, true);
  assert.equal(spanish.audioStyle, 'street_interview');
});

test('classifyAudioRights distinguishes reused independent UGC original sound from record-label music', () => {
  const reused = classifyAudioRights({
    platform: 'tiktok',
    creatorHandle: 'studiogridline',
    audioTitle: 'original sound - nyc_apt_hunter',
    audioAuthor: 'nyc_apt_hunter',
  });
  assert.equal(reused.status, 'reused_original');
  assert.equal(reused.isOriginalSafe, true);
  assert.equal(reused.isCreatorOwned, false);
});

test('classifyAudioRights rejects commercial labels, licensed catalog IDs, and Artist - Track songs', () => {
  const umg = classifyAudioRights({
    platform: 'tiktok',
    creatorHandle: 'tokyobiteclips',
    audioTitle: 'Midnight Espresso (Official Audio) - UMG',
    audioAuthor: 'Luna Vance',
    isLicensedCatalog: true,
  });
  assert.equal(umg.status, 'copyrighted_commercial');
  assert.equal(umg.isOriginalSafe, false);
  assert.equal(umg.detectedLabelOrRightsHolder, 'Universal Music Group');

  const artistDashSong = classifyAudioRights({
    platform: 'instagram',
    creatorHandle: 'ironpulseclips',
    audioTitle: 'Kordhell - Overdrive',
    audioAuthor: 'Kordhell',
  });
  assert.equal(artistDashSong.status, 'copyrighted_commercial');
  assert.equal(artistDashSong.isOriginalSafe, false);
});

test('validateAndParseSocialUrl enforces allowlist and blocks SSRF private/loopback targets', () => {
  const validTt = validateAndParseSocialUrl(
    'https://www.tiktok.com/@scout2015/video/6718335390845095173'
  );
  assert.equal(validTt.ok, true);
  assert.equal(validTt.platform, 'tiktok');
  assert.equal(validTt.creatorHandle, 'scout2015');
  assert.equal(validTt.postId, '6718335390845095173');

  const validDy = validateAndParseSocialUrl(
    'https://www.douyin.com/video/7398120495821049123'
  );
  assert.equal(validDy.ok, true);
  assert.equal(validDy.platform, 'douyin');

  assert.equal(validateAndParseSocialUrl('').ok, false);
  assert.equal(validateAndParseSocialUrl('javascript:alert(1)').ok, false);
  assert.equal(validateAndParseSocialUrl('http://127.0.0.1:3000/api').ok, false);
  assert.equal(validateAndParseSocialUrl('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(validateAndParseSocialUrl('https://user:pass@www.tiktok.com/@a/video/1').ok, false);
  assert.equal(validateAndParseSocialUrl('https://example.com/video/123').ok, false);

  assert.equal(
    isAllowedMediaCdnUrl('https://v16m.tiktokcdn-us.com/video/tos/clip.mp4'),
    true
  );
  assert.equal(isAllowedMediaCdnUrl('http://v16m.tiktokcdn-us.com/clip.mp4'), false);
  assert.equal(isAllowedMediaCdnUrl('https://127.0.0.1/clip.mp4'), false);
  assert.equal(isAllowedMediaCdnUrl('https://evil.example.com/clip.mp4'), false);
  assert.equal(sanitizeDownloadFilename('../../bad\r\nname!'), 'bad-name');
});

test('filterAndRankViralPosts includes new Douyin non-copyrighted music and hides copyrighted tracks', () => {
  const catalog = buildSeedViralCatalog(1795669000000);
  const originalOnly = filterAndRankViralPosts(catalog, {
    audioMode: 'original_only',
    sort: 'velocity',
  });

  assert.equal(originalOnly.items.length, 70);
  assert.equal(originalOnly.excludedCopyrightedCount, 8);
  assert.equal(
    originalOnly.items.every((p) => p.classification.isOriginalSafe),
    true
  );

  const douyinFreeMusic = filterAndRankViralPosts(catalog, {
    platforms: ['douyin'],
    audioStyle: 'royalty_free_music',
  });
  assert.equal(douyinFreeMusic.items.length, 14);

  const withExcluded = filterAndRankViralPosts(catalog, {
    audioMode: 'all_with_excluded',
  });
  assert.equal(withExcluded.items.length, 78);
});

test('generateRoyaltyFreeWavBytes synthesizes valid 16-bit PCM RIFF WAVE audio', () => {
  const wav = generateRoyaltyFreeWavBytes('guzheng_rain_lofi', 2);
  const magic = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  const waveTag = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
  assert.equal(magic, 'RIFF');
  assert.equal(waveTag, 'WAVE');
  assert.equal(wav.byteLength, 44 + 22050 * 2 * 2);
});

test('buildZeroLoginQueries generates localized operators including Douyin royalty-free BGM mode', () => {
  const queries = buildZeroLoginQueries({
    keyword: 'guzheng',
    platforms: ['tiktok', 'instagram', 'douyin', 'facebook'],
    language: 'zh',
    excludeCommercialLabels: true,
    rawAmbientOnly: false,
    royaltyFreeMusicOnly: true,
  });
  assert.equal(queries.length, 4);
  const dyQuery = queries.find((q) => q.platform === 'douyin')?.queryText || '';
  assert.ok(dyQuery.includes('创作的原声'));
  assert.ok(dyQuery.includes('无版权音乐'));
});

test('computeViralityMetrics calculates daily velocity and engagement percentage accurately', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  const twoDaysAgo = '2026-11-23T12:00:00Z';
  const metrics = computeViralityMetrics({
    views: 1_000_000,
    likes: 80_000,
    comments: 5_000,
    shares: 15_000,
    publishedAt: twoDaysAgo,
    nowMs: now,
  });
  assert.equal(metrics.viewsPerDay, 500_000);
  assert.equal(metrics.engagementRatePct, 10);
});
