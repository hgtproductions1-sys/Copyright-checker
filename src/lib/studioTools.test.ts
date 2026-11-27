import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCreativeCommonsText,
  evaluateIsrcFormat,
  inspectUploadedMediaCopyright,
  parseEbuR128Summary,
  scanRawContainerRightsMarkers,
} from './videoCopyrightInspector.ts';
import {
  analyzePcmSegments,
  compareAudioEnvelopes,
} from './audioSimilarity.ts';
import {
  computeTimelineLayout,
  computeTrimmerDragUpdate,
  dbToLinearGain,
  detectTrimmerHitTarget,
  formatPreciseTimecode,
  sanitizeClipTiming,
} from './audioTimelineMath.ts';

test('inspectUploadedMediaCopyright flags embedded UMG label and ISRC metadata', () => {
  const res = inspectUploadedMediaCopyright({
    tags: {
      title: 'Midnight Espresso (Official Audio)',
      artist: 'Luna Vance',
      publisher: 'Republic Records / Universal Music Group',
      isrc: 'USUM72409182',
      copyright: '© 2025 Universal Music Operations Limited',
    },
    technical: {
      fileName: 'clip_edit.mp4',
      fileSizeBytes: 2_400_000,
      containerFormat: 'mov,mp4,m4a',
      durationSec: 18.4,
      hasVideoStream: true,
      hasAudioStream: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRateHz: 44100,
      channels: 2,
      rmsLoudnessDb: -8.9,
      crestFactorDb: 6.1,
    },
  });

  assert.equal(res.status, 'copyrighted_detected');
  assert.equal(res.safeForStudioRegistration, false);
  assert.equal(res.detectedIsrc, 'USUM72409182');
  assert.ok(res.detectedRightsHolder?.includes('Universal Music'));
});

test('inspectUploadedMediaCopyright clears clean creator studio recordings and silent videos', () => {
  const cleanRes = inspectUploadedMediaCopyright({
    tags: {
      title: 'Studio Original Vocal Demo',
      comment: 'Creator owned original sound 无版权',
    },
    technical: {
      fileName: 'artist_demo.mp4',
      fileSizeBytes: 1_800_000,
      containerFormat: 'mov,mp4,m4a',
      durationSec: 12.0,
      hasVideoStream: true,
      hasAudioStream: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRateHz: 48000,
      channels: 2,
      rmsLoudnessDb: -16.4,
      crestFactorDb: 11.8,
    },
  });

  assert.equal(cleanRes.status, 'clear_original');
  assert.equal(cleanRes.safeForStudioRegistration, true);

  const silentRes = inspectUploadedMediaCopyright({
    tags: {},
    technical: {
      fileName: 'broll_no_audio.mp4',
      fileSizeBytes: 950_000,
      containerFormat: 'mp4',
      durationSec: 8.5,
      hasVideoStream: true,
      hasAudioStream: false,
    },
  });

  assert.equal(silentRes.status, 'clear_original');
  assert.equal(silentRes.safeForStudioRegistration, true);
});

test('computeTimelineLayout calculates sequential, gap, and crossfade MP3 compilation times accurately', () => {
  const clips = [
    {
      id: 'c1',
      name: 'Intro Guzheng.mp3',
      sourceDurationSec: 10,
      trimStartSec: 1,
      trimEndSec: 6, // 5.0s active
      gainDb: 0,
      fadeInSec: 0.5,
      fadeOutSec: 0.5,
    },
    {
      id: 'c2',
      name: 'Artist Vocal Hook.mp3',
      sourceDurationSec: 8,
      trimStartSec: 0,
      trimEndSec: 6, // 6.0s active
      gainDb: 1.5,
      fadeInSec: 0,
      fadeOutSec: 1.0,
    },
  ];

  const seamless = computeTimelineLayout(clips, 'seamless');
  assert.equal(seamless.totalDurationSec, 11);
  assert.equal(seamless.placedClips[0].timelineStartSec, 0);
  assert.equal(seamless.placedClips[0].timelineEndSec, 5);
  assert.equal(seamless.placedClips[1].timelineStartSec, 5);
  assert.equal(seamless.placedClips[1].timelineEndSec, 11);

  const gapped = computeTimelineLayout(clips, 'gap_0_5s');
  assert.equal(gapped.totalDurationSec, 11.5);
  assert.equal(gapped.placedClips[1].timelineStartSec, 5.5);

  const crossfaded = computeTimelineLayout(clips, 'crossfade_1s');
  assert.equal(crossfaded.totalDurationSec, 10);
  assert.equal(crossfaded.placedClips[1].timelineStartSec, 4);
});

test('sanitizeClipTiming clamps invalid trims, fades, and gain boundaries', () => {
  const clamped = sanitizeClipTiming({
    id: 'bad',
    name: 'test.mp3',
    sourceDurationSec: 6,
    trimStartSec: 5.95,
    trimEndSec: 2, // inverted
    gainDb: 99,
    fadeInSec: 20,
    fadeOutSec: -4,
  });

  assert.equal(clamped.trimStartSec, 5.75);
  assert.equal(clamped.trimEndSec, 6);
  assert.equal(clamped.gainDb, 12);
  assert.ok(clamped.fadeInSec <= 0.13);
  assert.equal(clamped.fadeOutSec, 0);
  assert.equal(formatPreciseTimecode(65.42), '01:05.4');
  assert.ok(Math.abs(dbToLinearGain(0) - 1) < 1e-6);
});

test('seedCatalog contains zero AI-generated stock thumbnail paths and CDN allowlist validates authentic media hosts', async () => {
  const { buildSeedViralCatalog } = await import('./seedCatalog.ts');
  const { isAllowedMediaCdnUrl } = await import('./urlSafety.ts');

  const catalog = buildSeedViralCatalog();
  assert.ok(catalog.length >= 78);
  const aiStockItems = catalog.filter((item) =>
    item.thumbnailUrl?.startsWith('/src/assets/images/')
  );
  assert.equal(
    aiStockItems.length,
    0,
    'Expected zero AI-generated stock image thumbnails on catalog items'
  );

  // Authentic platform cover & stream CDNs allowed
  assert.equal(
    isAllowedMediaCdnUrl('https://p16-sign-sg.tiktokcdn.com/obj/tos-alisg-p-0037/cover.jpeg'),
    true
  );
  assert.equal(
    isAllowedMediaCdnUrl('https://p3-pc-sign.douyinpic.com/tos-cn-i-0813/frame.webp'),
    true
  );
  assert.equal(
    isAllowedMediaCdnUrl('https://p9-sign.byteimg.com/tos-cn-p-0015/cover.jpg'),
    true
  );

  // Private, non-HTTPS, and arbitrary hosts rejected
  assert.equal(isAllowedMediaCdnUrl('http://p16-sign-sg.tiktokcdn.com/cover.jpg'), false);
  assert.equal(isAllowedMediaCdnUrl('https://127.0.0.1/internal.jpg'), false);
  assert.equal(isAllowedMediaCdnUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedMediaCdnUrl('https://evil.example.com/tiktokcdn.com/fake.jpg'), false);
});

test('collectProjectZipEntries and buildZipArchiveBuffer package runnable source files cleanly without secrets or AI stock images', async () => {
  const path = await import('path');
  const { buildZipArchiveBuffer, collectProjectZipEntries } = await import(
    './serverZipBuilder.ts'
  );

  const rootDir = path.resolve(process.cwd());
  const entries = await collectProjectZipEntries(rootDir, 'origisound-app');
  const names = entries.map((e) => e.archivePath);

  assert.ok(names.includes('origisound-app/package.json'));
  assert.ok(names.includes('origisound-app/server.ts'));
  assert.ok(names.includes('origisound-app/src/App.tsx'));
  assert.ok(!names.some((n) => n.endsWith('/.env') || n.includes('node_modules')));
  assert.ok(!names.some((n) => n.includes('src/assets/images/')));

  const zipBuf = buildZipArchiveBuffer(entries);
  // PK local header at byte 0 and End of Central Directory near end
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);
  assert.equal(zipBuf.readUInt32LE(zipBuf.length - 22), 0x06054b50);
});

test('detectTrimmerHitTarget identifies start handle, end handle, window body, and outer jump zones', () => {
  assert.deepEqual(
    detectTrimmerHitTarget({ pointerRatio: 0.21, startRatio: 0.2, endRatio: 0.8 }),
    { target: 'start', jumpImmediately: false }
  );
  assert.deepEqual(
    detectTrimmerHitTarget({ pointerRatio: 0.79, startRatio: 0.2, endRatio: 0.8 }),
    { target: 'end', jumpImmediately: false }
  );
  assert.deepEqual(
    detectTrimmerHitTarget({ pointerRatio: 0.5, startRatio: 0.2, endRatio: 0.8 }),
    { target: 'window', jumpImmediately: false }
  );
  assert.deepEqual(
    detectTrimmerHitTarget({ pointerRatio: 0.05, startRatio: 0.2, endRatio: 0.8 }),
    { target: 'start', jumpImmediately: true }
  );
  assert.deepEqual(
    detectTrimmerHitTarget({ pointerRatio: 0.94, startRatio: 0.2, endRatio: 0.8 }),
    { target: 'end', jumpImmediately: true }
  );
});

test('computeTrimmerDragUpdate clamps start/end boundaries, respects 0.25s min length, and slides fixed window cleanly', () => {
  // Drag start forward cleanly
  const dragStart = computeTrimmerDragUpdate({
    sourceDurationSec: 10,
    trimStartSec: 1,
    trimEndSec: 8,
    target: 'start',
    pointerSec: 3.43,
  });
  assert.equal(dragStart.trimStartSec, 3.45);
  assert.equal(dragStart.trimEndSec, 8);

  // Drag start past trimEndSec preserves 0.25s minimum active window
  const clampedStart = computeTrimmerDragUpdate({
    sourceDurationSec: 10,
    trimStartSec: 1,
    trimEndSec: 5,
    target: 'start',
    pointerSec: 9,
  });
  assert.equal(clampedStart.trimStartSec, 4.75);
  assert.equal(clampedStart.trimEndSec, 5);

  // Drag end before trimStartSec preserves 0.25s minimum active window
  const clampedEnd = computeTrimmerDragUpdate({
    sourceDurationSec: 10,
    trimStartSec: 4,
    trimEndSec: 8,
    target: 'end',
    pointerSec: 1,
  });
  assert.equal(clampedEnd.trimStartSec, 4);
  assert.equal(clampedEnd.trimEndSec, 4.25);

  // Slide window preserves duration and clamps at right edge
  const slideRight = computeTrimmerDragUpdate({
    sourceDurationSec: 10,
    trimStartSec: 2,
    trimEndSec: 5,
    target: 'window',
    pointerSec: 12,
    grabOffsetSec: 1.5,
    initialWindowSpanSec: 3,
  });
  assert.equal(slideRight.trimStartSec, 7);
  assert.equal(slideRight.trimEndSec, 10);
});

test('copyright deep identifier helpers parse ISRC, XMP rights flags, PRO societies, Creative Commons, and EBU R128 summary', () => {
  const isrc = evaluateIsrcFormat('us-um7-24-09182');
  assert.equal(isrc.valid, true);
  assert.equal(isrc.country, 'US');
  assert.equal(isrc.year, '2024');
  assert.equal(evaluateIsrcFormat('invalid').valid, false);

  const ccNc = evaluateCreativeCommonsText('https://creativecommons.org/licenses/by-nc/4.0/');
  assert.ok(ccNc);
  assert.equal(ccNc.code, 'CC-BY-NC');
  assert.equal(ccNc.commercialUseAllowed, false);

  const cc0 = evaluateCreativeCommonsText('Released under CC0 1.0 Public Domain');
  assert.ok(cc0);
  assert.equal(cc0.commercialUseAllowed, true);
  assert.equal(cc0.attributionRequired, false);

  const ebu = parseEbuR128Summary(`
    [Parsed_ebur128_0 @ 0x1] Summary:
      Integrated loudness:
        I:         -11.4 LUFS
        Threshold: -21.5 LUFS
      Loudness range:
        LRA:         6.2 LU
      True peak:
        Peak:       -0.2 dBFS
  `);
  assert.equal(ebu.integratedLufs, -11.4);
  assert.equal(ebu.loudnessRangeLu, 6.2);
  assert.equal(ebu.truePeakDbtp, -0.2);

  const rawXml = Buffer.from(
    'ftypmp42<xmpRights:Marked>true</xmpRights:Marked><dc:rights><rdf:li>ASCAP Registered Work T-123.456.789-0 UPC: 196589123456</rdf:li></dc:rights>',
    'latin1'
  );
  const binTags = scanRawContainerRightsMarkers(rawXml);
  assert.equal(binTags.xmpRightsMarked, 'true');
  assert.equal(binTags.proAffiliation, 'ASCAP');
  assert.equal(binTags.iswc, 'T-123.456.789-0');
  assert.equal(binTags.upc, '196589123456');

  const blockedReport = inspectUploadedMediaCopyright({
    tags: binTags,
    technical: {
      fileName: 'xmp_protected.mp4',
      fileSizeBytes: 1024_000,
      containerFormat: 'mp4',
      durationSec: 12,
      hasVideoStream: true,
      hasAudioStream: true,
      fileSha256: 'ABCDEF123456',
    },
  });
  assert.equal(blockedReport.status, 'copyrighted_detected');
  assert.equal(blockedReport.detectedProSociety, 'ASCAP');
  assert.equal(blockedReport.detectedIswc, 'T-123.456.789-0');
});

test('analyzePcmSegments flags localized commercial mastering window and compareAudioEnvelopes distinguishes matching vs distinct waveforms', () => {
  const sr = 8000;
  // 4 seconds: first 2s gentle quiet speech-like dynamic wave, next 2s dense brickwall square wave
  const samples = new Float32Array(sr * 4);
  for (let i = 0; i < sr * 2; i++) {
    samples[i] = 0.08 * Math.sin((2 * Math.PI * 220 * i) / sr) * Math.abs(Math.sin((2 * Math.PI * 2 * i) / sr));
  }
  for (let i = sr * 2; i < sr * 4; i++) {
    samples[i] = i % 20 < 10 ? 0.85 : -0.85; // dense brickwall low crest factor
  }

  const segs = analyzePcmSegments({
    monoSamples: samples,
    sampleRateHz: sr,
    segmentSec: 2,
  });
  assert.equal(segs.length, 2);
  assert.equal(segs[0].riskLevel, 'clear');
  assert.equal(segs[1].riskLevel, 'flagged');

  // Matching waveform vs contrasted waveform
  const a = new Float32Array(sr * 4);
  const bSame = new Float32Array(sr * 4);
  const cDiff = new Float32Array(sr * 4);
  for (let i = 0; i < sr * 4; i++) {
    const envA = Math.exp(-Math.pow((i / sr - 1.5) / 0.6, 2));
    a[i] = envA * 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    bSame[i] = envA * 0.45 * Math.sin((2 * Math.PI * 440 * i) / sr);

    const envC = Math.exp(-Math.pow((i / sr - 3.3) / 0.4, 2));
    cDiff[i] = envC * 0.4 * Math.sin((2 * Math.PI * (120 + (i % 700)) * i) / sr);
  }

  const sameResult = compareAudioEnvelopes({
    primarySamples: a,
    referenceSamples: bSame,
    sampleRateHz: sr,
    primaryName: 'take.mp4',
    referenceName: 'beat.mp3',
  });
  assert.equal(sameResult.verdict, 'high_match');
  assert.ok(sameResult.overallSimilarityPct >= 80);

  const diffResult = compareAudioEnvelopes({
    primarySamples: a,
    referenceSamples: cDiff,
    sampleRateHz: sr,
    primaryName: 'take.mp4',
    referenceName: 'other.mp3',
  });
  assert.notEqual(diffResult.verdict, 'high_match');
});

test('deriveMp3TrackName and summarizeBatchVideoQueue handle multi-video batch state accurately', async () => {
  const { deriveMp3TrackName, summarizeBatchVideoQueue } = await import(
    './audioTimelineMath'
  );
  assert.equal(deriveMp3TrackName('street_session.mp4'), 'street_session.mp3');
  assert.equal(deriveMp3TrackName('hook.take.01.MOV'), 'hook.take.01.mp3');
  assert.equal(deriveMp3TrackName('   '), 'converted-video.mp3');

  const summary = summarizeBatchVideoQueue([
    { status: 'queued' },
    { status: 'queued' },
    { status: 'converting' },
    { status: 'converted' },
    { status: 'error' },
  ]);
  assert.deepEqual(summary, {
    total: 5,
    queued: 2,
    converting: 1,
    converted: 1,
    error: 1,
  });
});

test('generateRandomSongSlug generates valid MP3-safe filenames and avoids immediate repeats', async () => {
  const { generateRandomSongSlug } = await import('./audioTimelineMath');
  const first = generateRandomSongSlug();
  assert.match(first, /^[a-z0-9]+(?:-[a-z0-9]+){1,3}$/);
  assert.ok(!first.endsWith('.mp3'));

  const second = generateRandomSongSlug(first);
  assert.match(second, /^[a-z0-9]+(?:-[a-z0-9]+){1,3}$/);
  assert.notEqual(second, first);
});

test('audioFormats supports WAV, MP3, M4A, FLAC, AIFF, and WMA with accurate FFmpeg encode specs', async () => {
  const {
    STUDIO_AUDIO_FORMAT_ORDER,
    STUDIO_AUDIO_FORMATS,
    buildFfmpegAudioEncodeArgs,
    formatOutputTrackFilename,
    normalizeStudioAudioFormat,
  } = await import('./audioFormats');

  assert.deepEqual([...STUDIO_AUDIO_FORMAT_ORDER], [
    'mp3',
    'wav',
    'm4a',
    'flac',
    'aiff',
    'wma',
  ]);
  assert.equal(normalizeStudioAudioFormat('.AIF'), 'aiff');
  assert.equal(normalizeStudioAudioFormat('flac'), 'flac');
  assert.equal(normalizeStudioAudioFormat('wma'), 'wma');
  assert.equal(normalizeStudioAudioFormat('unknown'), 'mp3');

  assert.equal(STUDIO_AUDIO_FORMATS.wav.lossless, true);
  assert.equal(STUDIO_AUDIO_FORMATS.flac.lossless, true);
  assert.equal(STUDIO_AUDIO_FORMATS.aiff.lossless, true);
  assert.equal(STUDIO_AUDIO_FORMATS.mp3.lossless, false);

  const wavArgs = buildFfmpegAudioEncodeArgs('wav', '320k');
  assert.ok(wavArgs.includes('pcm_s16le'));
  assert.ok(!wavArgs.includes('-b:a'));

  const wmaArgs = buildFfmpegAudioEncodeArgs('wma', '192k');
  assert.ok(wmaArgs.includes('asf'));
  assert.ok(wmaArgs.includes('wmav2'));
  assert.ok(wmaArgs.includes('192k'));

  const m4aArgs = buildFfmpegAudioEncodeArgs('m4a', '320k');
  assert.ok(m4aArgs.includes('ipod'));
  assert.ok(m4aArgs.includes('aac'));
  assert.ok(m4aArgs.includes('+faststart'));

  assert.equal(formatOutputTrackFilename('wild-dusk-v2.mp3', 'flac'), 'wild-dusk-v2.flac');
  assert.equal(formatOutputTrackFilename('master-take', 'aiff'), 'master-take.aiff');
});

test('coverArtGenerator pure utilities enforce 3000x3000 dimensions and clean title/filename formatting', async () => {
  const {
    COVER_ART_DIMENSION_PX,
    COVER_ART_STYLES,
    buildCoverArtFilename,
    formatCoverDisplayTitle,
    pickNextCoverStyle,
  } = await import('./coverArtGenerator');

  assert.equal(COVER_ART_DIMENSION_PX, 3000);
  assert.ok(COVER_ART_STYLES.length >= 5);
  assert.equal(formatCoverDisplayTitle('wild-dusk-v2'), 'Wild Dusk V2');
  assert.equal(buildCoverArtFilename('Wild Dusk V2'), 'wild-dusk-v2-cover-3000x3000.jpg');
  const nextStyle = pickNextCoverStyle(COVER_ART_STYLES[0].id);
  assert.notEqual(nextStyle.id, COVER_ART_STYLES[0].id);
});

test('chunkedStudioUpload planChunkSlices splits large audio buffers into bounded chunks under proxy limits', async () => {
  const { STUDIO_CHUNK_SIZE_BYTES, planChunkSlices } = await import('./chunkedStudioUpload');

  assert.equal(STUDIO_CHUNK_SIZE_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(planChunkSlices(0), []);

  const small = planChunkSlices(120_000);
  assert.equal(small.length, 1);
  assert.deepEqual(small[0], { chunkIndex: 0, start: 0, end: 120_000 });

  const tenMb = 10 * 1024 * 1024;
  const multi = planChunkSlices(tenMb);
  assert.equal(multi.length, 3);
  assert.deepEqual(multi[0], { chunkIndex: 0, start: 0, end: 4 * 1024 * 1024 });
  assert.deepEqual(multi[1], { chunkIndex: 1, start: 4 * 1024 * 1024, end: 8 * 1024 * 1024 });
  assert.deepEqual(multi[2], { chunkIndex: 2, start: 8 * 1024 * 1024, end: tenMb });
});



