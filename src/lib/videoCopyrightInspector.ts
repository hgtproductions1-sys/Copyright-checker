import { buildSeedViralCatalog } from './seedCatalog.ts';
import type { SegmentAcousticProfile } from './audioSimilarity.ts';

export type UploadedCopyrightStatus =
  | 'clear_original'
  | 'potential_third_party'
  | 'copyrighted_detected';

export interface MediaContainerTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  composer?: string;
  copyright?: string;
  publisher?: string;
  isrc?: string;
  iswc?: string;
  upc?: string;
  proAffiliation?: string;
  creativeCommonsLicense?: string;
  xmpRightsMarked?: string;
  xmpUsageTerms?: string;
  comment?: string;
  encoder?: string;
}

export interface MediaTechnicalProfile {
  fileName: string;
  fileSizeBytes: number;
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
  rmsLoudnessDb?: number;
  peakLevelDb?: number;
  crestFactorDb?: number;
  silenceRatioPct?: number;
  stereoSideRatioPct?: number;
  ebur128IntegratedLufs?: number;
  ebur128TruePeakDbtp?: number;
  ebur128LoudnessRangeLu?: number;
  acousticDigest?: string;
  fileSha256?: string;
  audioStreamSha256?: string;
  segments?: SegmentAcousticProfile[];
}

export interface CopyrightCheckFinding {
  code: string;
  severity: 'clear' | 'warning' | 'blocked';
  title: string;
  detail: string;
}

export interface StudioClearanceCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'action_required' | 'blocked';
  detail: string;
}

export interface CreativeCommonsEvaluation {
  code: string;
  commercialUseAllowed: boolean;
  derivativesAllowed: boolean;
  attributionRequired: boolean;
}

export interface RegistryMatchHit {
  source: 'MusicBrainz' | 'Apple iTunes' | 'Deezer' | 'OrigiSound Commercial Index';
  title: string;
  artist: string;
  albumOrRelease?: string;
  isrc?: string;
  rightsOrLabel?: string;
  releaseDate?: string;
  externalUrl?: string;
  isCommercialLocked: boolean;
}

export interface RegistryLookupResult {
  ok: boolean;
  query: string;
  isrcValid?: { code: string; country: string; registrant: string; year: string };
  hits: RegistryMatchHit[];
  sourcesQueried: string[];
  liveSourcesReachable: boolean;
  summary: string;
}

export interface VideoCopyrightCheckResult {
  status: UploadedCopyrightStatus;
  verdictTitle: string;
  verdictSummary: string;
  safeForStudioRegistration: boolean;
  detectedRightsHolder?: string;
  detectedIsrc?: string;
  detectedIswc?: string;
  detectedUpc?: string;
  detectedProSociety?: string;
  creativeCommons?: CreativeCommonsEvaluation;
  matchedCatalogPostTitle?: string;
  flaggedSegmentCount: number;
  studioClearanceChecklist: StudioClearanceCheckItem[];
  tags: MediaContainerTags;
  technical: MediaTechnicalProfile;
  findings: CopyrightCheckFinding[];
}

const COMMERCIAL_RIGHTS_HOLDERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(universal music|umg|republic records|interscope|def jam|capitol records)\b/i, name: 'Universal Music Group (UMG)' },
  { pattern: /\b(sony music|columbia records|rca records|epic records|arista)\b/i, name: 'Sony Music Entertainment' },
  { pattern: /\b(warner music|wmg|atlantic records|elektra|parlophone)\b/i, name: 'Warner Music Group (WMG)' },
  { pattern: /(腾讯音乐|tme|qq音乐授权|酷狗版权|网易云音乐版权)/i, name: 'Mainland Commercial Music Catalog (TME / NetEase)' },
  { pattern: /\b(distrokid|tunecore|cd baby|awal|empire distribution|orchard|believe digital|onerpm|amuse|unitedmasters)\b/i, name: 'Commercial Digital Aggregator / Distributor' },
  { pattern: /\b(epidemic sound|artlist|audiojungle|lickd|musicbed|splice sounds)\b/i, name: 'Subscription Sync-License Catalog' },
  { pattern: /\b(provided to youtube by|licensed to youtube|rights manager protected|smg music)\b/i, name: 'Content ID / Rights Manager Claim' },
];

const PRO_SOCIETIES_REGEX =
  /\b(ASCAP|BMI|SESAC|GMR|PRS\s*FOR\s*MUSIC|MCPS|SOCAN|GEMA|JASRAC|MCSC|KOMCA|SACEM|APRA\s*AMCOS)\b/i;

const ISRC_REGEX = /\b([A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5})\b/i;
const ISWC_REGEX = /\b(T-?\d{3}\.?\d{3}\.?\d{3}-?\d)\b/i;
const UPC_REGEX = /\b(?:UPC|EAN|BARCODE)[:\s#-]*(\d{12,13})\b/i;

const COPYRIGHT_NOTICE_REGEX =
  /(?:©|\(c\)|\(p\)|℗|copyright\s+\d{4}|all rights reserved|phonographic copyright)/i;

const ROYALTY_FREE_GRANT_REGEX =
  /(无版权|免版权|免费商用|可商用|原创原声|创作的原声|cc0|creative commons|royalty[- ]free|no copyright|studio original)/i;

export function evaluateIsrcFormat(raw: string): {
  valid: boolean;
  normalized?: string;
  country?: string;
  registrant?: string;
  year?: string;
} {
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(clean)) {
    return { valid: false };
  }
  return {
    valid: true,
    normalized: clean,
    country: clean.slice(0, 2),
    registrant: clean.slice(2, 5),
    year: `20${clean.slice(5, 7)}`,
  };
}

export function evaluateCreativeCommonsText(
  text: string
): CreativeCommonsEvaluation | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  if (/\bcc0\b|creativecommons\.org\/publicdomain\/zero/i.test(lower)) {
    return {
      code: 'CC0-1.0 (Public Domain Dedication)',
      commercialUseAllowed: true,
      derivativesAllowed: true,
      attributionRequired: false,
    };
  }

  const ccUrlMatch = lower.match(
    /creativecommons\.org\/licenses\/(by(?:-[a-z]{2})*)/i
  );
  const ccShortMatch = lower.match(/\bcc[\s-]*(by(?:[\s-]*(?:nc|nd|sa))*)/i);
  const rawSlug = (ccUrlMatch?.[1] || ccShortMatch?.[1] || '')
    .replace(/\s+/g, '-')
    .toUpperCase();

  if (!rawSlug) return undefined;

  const hasNc = rawSlug.includes('NC');
  const hasNd = rawSlug.includes('ND');
  return {
    code: `CC-${rawSlug}`,
    commercialUseAllowed: !hasNc,
    derivativesAllowed: !hasNd,
    attributionRequired: true,
  };
}

export function parseEbuR128Summary(stderr: string): {
  integratedLufs?: number;
  loudnessRangeLu?: number;
  truePeakDbtp?: number;
} {
  if (!stderr) return {};
  const iMatch = stderr.match(/Summary:\s*[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i);
  const lraMatch = stderr.match(/LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/i);
  const peakMatch = stderr.match(/(?:True\s+peak|Peak):\s*(-?\d+(?:\.\d+)?)\s*dB(?:FS|TP)/i);

  return {
    integratedLufs: iMatch ? Number(iMatch[1]) : undefined,
    loudnessRangeLu: lraMatch ? Number(lraMatch[1]) : undefined,
    truePeakDbtp: peakMatch ? Number(peakMatch[1]) : undefined,
  };
}

export function scanRawContainerRightsMarkers(
  rawBytes: Uint8Array
): Partial<MediaContainerTags> {
  if (!rawBytes || rawBytes.byteLength === 0) return {};

  // Sample up to first 192KB + last 128KB (covers MP4 moov/udta/XMP & ID3v1/v2)
  const headSlice = rawBytes.subarray(0, Math.min(rawBytes.byteLength, 196_608));
  const tailStart = Math.max(0, rawBytes.byteLength - 131_072);
  const tailSlice =
    tailStart > headSlice.byteLength
      ? rawBytes.subarray(tailStart)
      : new Uint8Array(0);

  const decoder = new TextDecoder('latin1');
  const combinedText = `${decoder.decode(headSlice)}\n${decoder.decode(tailSlice)}`;

  const found: Partial<MediaContainerTags> = {};

  const isrcMatch = combinedText.match(ISRC_REGEX)?.[1];
  if (isrcMatch) found.isrc = isrcMatch.toUpperCase();

  const iswcMatch = combinedText.match(ISWC_REGEX)?.[1];
  if (iswcMatch) found.iswc = iswcMatch.toUpperCase();

  const upcMatch = combinedText.match(UPC_REGEX)?.[1];
  if (upcMatch) found.upc = upcMatch;

  const proMatch = combinedText.match(PRO_SOCIETIES_REGEX)?.[1];
  if (proMatch) found.proAffiliation = proMatch.toUpperCase();

  const xmpMarkedMatch = combinedText.match(
    /<xmpRights:Marked>\s*(true|false)\s*<\/xmpRights:Marked>/i
  );
  if (xmpMarkedMatch) {
    found.xmpRightsMarked = xmpMarkedMatch[1].toLowerCase();
  }

  const xmpTermsMatch = combinedText.match(
    /<xmpRights:UsageTerms[^>]*>[\s\S]{0,160}?<rdf:li[^>]*>([^<]{3,160})<\/rdf:li>/i
  );
  if (xmpTermsMatch) {
    found.xmpUsageTerms = xmpTermsMatch[1].trim();
  }

  const dcRightsMatch = combinedText.match(
    /<dc:rights[^>]*>[\s\S]{0,160}?<rdf:li[^>]*>([^<]{3,160})<\/rdf:li>/i
  );
  if (dcRightsMatch) {
    found.copyright = dcRightsMatch[1].trim();
  }

  const ccEval = evaluateCreativeCommonsText(combinedText);
  if (ccEval) {
    found.creativeCommonsLicense = ccEval.code;
  }

  return found;
}

export function inspectUploadedMediaCopyright(input: {
  tags: MediaContainerTags;
  technical: MediaTechnicalProfile;
}): VideoCopyrightCheckResult {
  const { tags, technical } = input;
  const findings: CopyrightCheckFinding[] = [];
  let detectedRightsHolder: string | undefined;
  let detectedIsrc: string | undefined;
  let detectedIswc: string | undefined;
  let detectedUpc: string | undefined;
  let detectedProSociety: string | undefined;
  let matchedCatalogPostTitle: string | undefined;

  const segments = technical.segments ?? [];
  const flaggedSegments = segments.filter((s) => s.riskLevel === 'flagged');
  const reviewSegments = segments.filter((s) => s.riskLevel === 'review');

  // 1. Check if video has no audio stream at all
  if (!technical.hasAudioStream) {
    findings.push({
      code: 'SILENT_VIDEO_TRACK',
      severity: 'clear',
      title: 'No embedded audio stream present',
      detail:
        'This video file contains visual frames only with no audio track, so it carries zero music or sound-recording copyright claims.',
    });
    return {
      status: 'clear_original',
      verdictTitle: 'No Existing Audio Copyright Detected (Silent Video)',
      verdictSummary:
        'Video has no audio track. Safe to pair with an original studio recording or Douyin non-copyrighted stem.',
      safeForStudioRegistration: true,
      flaggedSegmentCount: 0,
      studioClearanceChecklist: [
        {
          id: 'silent-audio',
          label: 'Audio Track Copyright Scan',
          status: 'pass',
          detail: 'Zero embedded audio streams detected.',
        },
        {
          id: 'visual-clearance',
          label: 'Video Footage & Performance Clearance',
          status: 'action_required',
          detail: 'Verify creator recorded the visual video clip natively.',
        },
        {
          id: 'sha256-custody',
          label: 'SHA-256 Chain of Custody Hash',
          status: technical.fileSha256 ? 'pass' : 'action_required',
          detail: technical.fileSha256
            ? `Locked ${technical.fileSha256.slice(0, 16)}...`
            : 'Computed during server scan.',
        },
      ],
      tags,
      technical,
      findings,
    };
  }

  const combinedTagText = [
    tags.title,
    tags.artist,
    tags.album,
    tags.albumArtist,
    tags.composer,
    tags.copyright,
    tags.publisher,
    tags.isrc,
    tags.iswc,
    tags.upc,
    tags.proAffiliation,
    tags.creativeCommonsLicense,
    tags.xmpUsageTerms,
    tags.comment,
    technical.fileName,
  ]
    .filter(Boolean)
    .join(' | ');

  // 2. Check ISRC, ISWC, and UPC commercial identifiers
  const isrcCandidate = tags.isrc || combinedTagText.match(ISRC_REGEX)?.[1];
  if (isrcCandidate) {
    detectedIsrc = isrcCandidate.toUpperCase();
    findings.push({
      code: 'EMBEDDED_ISRC_CODE',
      severity: 'blocked',
      title: `Registered ISRC Recording Code Found (${detectedIsrc})`,
      detail:
        'Container metadata embeds an International Standard Recording Code (ISRC), indicating an already-registered commercial master recording.',
    });
  }

  const iswcCandidate = tags.iswc || combinedTagText.match(ISWC_REGEX)?.[1];
  if (iswcCandidate) {
    detectedIswc = iswcCandidate.toUpperCase();
    findings.push({
      code: 'EMBEDDED_ISWC_CODE',
      severity: 'blocked',
      title: `Registered ISWC Composition Code Found (${detectedIswc})`,
      detail:
        'Container embeds an International Standard Musical Work Code (ISWC), indicating registered song publishing ownership.',
    });
  }

  const upcCandidate = tags.upc || combinedTagText.match(UPC_REGEX)?.[1];
  if (upcCandidate) {
    detectedUpc = upcCandidate;
    findings.push({
      code: 'EMBEDDED_UPC_CODE',
      severity: 'warning',
      title: `Commercial Release UPC/EAN Found (${detectedUpc})`,
      detail:
        'Container references a digital retail release barcode (UPC/EAN). Verify distributor ownership before registering.',
    });
  }

  // 3. Check PRO performing rights affiliation (ASCAP/BMI/SESAC/MCSC/PRS)
  const proCandidate =
    tags.proAffiliation || combinedTagText.match(PRO_SOCIETIES_REGEX)?.[1];
  if (proCandidate) {
    detectedProSociety = proCandidate.toUpperCase();
    findings.push({
      code: 'PRO_SOCIETY_TAG',
      severity: 'blocked',
      title: `Performing Rights Organization Detected (${detectedProSociety})`,
      detail: `Embedded metadata cites ${detectedProSociety}. Public performance & mechanical royalties are already claimed by a registered PRO member.`,
    });
  }

  // 4. Check XMP Rights Management flags
  if (tags.xmpRightsMarked === 'true') {
    findings.push({
      code: 'XMP_RIGHTS_LOCKED',
      severity: 'blocked',
      title: 'Adobe / ISO XMP Rights Protection Flag Active',
      detail: tags.xmpUsageTerms
        ? `Embedded XMP header marks file copyrighted with terms: "${tags.xmpUsageTerms}".`
        : 'Embedded <xmpRights:Marked>true</xmpRights:Marked> metadata declares rights reservation.',
    });
  }

  // 5. Check commercial record labels & distributors
  for (const holder of COMMERCIAL_RIGHTS_HOLDERS) {
    if (holder.pattern.test(combinedTagText)) {
      detectedRightsHolder = holder.name;
      findings.push({
        code: 'COMMERCIAL_LABEL_TAG',
        severity: 'blocked',
        title: `Commercial Rights-Holder Metadata (${holder.name})`,
        detail: `Embedded container tags reference ${holder.name}. Using or re-registering this audio without a master/sync license risks copyright strikes.`,
      });
      break;
    }
  }

  // 6. Check explicit © / ℗ copyright ownership notice
  if (
    tags.copyright &&
    COPYRIGHT_NOTICE_REGEX.test(tags.copyright) &&
    !ROYALTY_FREE_GRANT_REGEX.test(tags.copyright)
  ) {
    if (!detectedRightsHolder) {
      detectedRightsHolder = tags.copyright.trim();
    }
    findings.push({
      code: 'COPYRIGHT_TAG_PRESENT',
      severity: 'blocked',
      title: 'Embedded Copyright Ownership Notice',
      detail: `File container declares existing copyright ownership: "${tags.copyright.trim()}".`,
    });
  }

  // 7. Creative Commons SPDX evaluation (CC0 vs CC-BY-NC / CC-BY-ND)
  const creativeCommons = evaluateCreativeCommonsText(
    tags.creativeCommonsLicense || combinedTagText
  );
  if (creativeCommons) {
    if (!creativeCommons.commercialUseAllowed || !creativeCommons.derivativesAllowed) {
      findings.push({
        code: 'CREATIVE_COMMONS_RESTRICTED',
        severity: 'warning',
        title: `Restricted Creative Commons License (${creativeCommons.code})`,
        detail: `${creativeCommons.code} restricts ${
          !creativeCommons.commercialUseAllowed ? 'commercial monetization' : ''
        }${
          !creativeCommons.commercialUseAllowed && !creativeCommons.derivativesAllowed
            ? ' and '
            : ''
        }${
          !creativeCommons.derivativesAllowed
            ? 'derivative remixes / claiming new master copyright'
            : ''
        }.`,
      });
    } else {
      findings.push({
        code: 'CREATIVE_COMMONS_PERMISSIVE',
        severity: 'clear',
        title: `Permissive License Marker (${creativeCommons.code})`,
        detail: creativeCommons.attributionRequired
          ? `Allows commercial adaptation with creator attribution.`
          : 'Zero copyright restrictions (Public Domain Dedication).',
      });
    }
  }

  // 8. Cross-check against OrigiSound's known commercial / original index
  const catalog = buildSeedViralCatalog();
  const normalizedHaystack = combinedTagText.toLowerCase();
  for (const item of catalog) {
    const cleanAudioTitle = item.audioTitle.toLowerCase();
    if (
      cleanAudioTitle.length >= 8 &&
      normalizedHaystack.includes(cleanAudioTitle)
    ) {
      matchedCatalogPostTitle = item.title;
      if (!item.classification.isOriginalSafe) {
        detectedRightsHolder =
          detectedRightsHolder ||
          item.classification.detectedLabelOrRightsHolder ||
          item.audioAuthor;
        findings.push({
          code: 'INDEX_COMMERCIAL_MATCH',
          severity: 'blocked',
          title: 'Matched Known Copyrighted Commercial Track',
          detail: `Audio attribution matches screened commercial track "${item.audioTitle}".`,
        });
      } else {
        findings.push({
          code: 'INDEX_ORIGINAL_MATCH',
          severity: 'clear',
          title: 'Matched Verified Original / Non-Copyrighted Creator Track',
          detail: `Matches verified creator sound "${item.audioTitle}" (@${item.creatorHandle}).`,
        });
      }
      break;
    }
  }

  // 9. Check explicit Royalty-Free / Studio Original declaration
  const hasRoyaltyFreeDeclaration = ROYALTY_FREE_GRANT_REGEX.test(combinedTagText);
  if (
    hasRoyaltyFreeDeclaration &&
    !detectedRightsHolder &&
    !detectedIsrc &&
    !detectedIswc &&
    !detectedProSociety
  ) {
    findings.push({
      code: 'EXPLICIT_ORIGINAL_OR_FREE_GRANT',
      severity: 'clear',
      title: 'Original / Royalty-Free Declaration Verified',
      detail:
        'Container tags explicitly declare creator-original or royalty-free non-copyrighted status with zero record-label claims.',
    });
  }

  // 10. Check third-party album/artist song tags when not marked original
  if (
    !detectedRightsHolder &&
    !detectedIsrc &&
    !detectedIswc &&
    !hasRoyaltyFreeDeclaration &&
    Boolean(tags.album || (tags.artist && tags.title && !/original|raw|voice|mic/i.test(combinedTagText)))
  ) {
    findings.push({
      code: 'UNVERIFIED_SONG_TAGS',
      severity: 'warning',
      title: 'Embedded Artist / Album Song Tags Detected',
      detail: `File contains music release metadata (${[tags.artist, tags.album || tags.title].filter(Boolean).join(' — ')}). Confirm the aspiring artist owns this recording before registering copyright.`,
    });
  }

  // 11. Segment-by-Segment & EBU R128 Acoustic Loudness / Stereo Inspection
  if (
    typeof technical.rmsLoudnessDb === 'number' &&
    typeof technical.crestFactorDb === 'number'
  ) {
    if (technical.silenceRatioPct !== undefined && technical.silenceRatioPct > 92) {
      findings.push({
        code: 'NEAR_SILENT_AUDIO',
        severity: 'clear',
        title: 'Near-Silent Ambient Track',
        detail: `${technical.silenceRatioPct.toFixed(1)}% of frames are below -50 dBFS; negligible musical copyright footprint.`,
      });
    } else if (
      technical.rmsLoudnessDb > -10.5 &&
      technical.crestFactorDb < 7.2 &&
      !hasRoyaltyFreeDeclaration
    ) {
      findings.push({
        code: 'HEAVY_COMMERCIAL_LIMITING',
        severity: 'warning',
        title: 'Commercial Brickwall Mastering Profile',
        detail: `Loudness (${technical.rmsLoudnessDb.toFixed(1)} dBFS RMS, ${technical.crestFactorDb.toFixed(1)} dB crest factor${
          typeof technical.ebur128IntegratedLufs === 'number'
            ? `, ${technical.ebur128IntegratedLufs.toFixed(1)} LUFS`
            : ''
        }) resembles a commercially mastered release. Verify stems if background music is present.`,
      });
    } else {
      findings.push({
        code: 'NATURAL_DYNAMIC_PROFILE',
        severity: 'clear',
        title: 'Natural Creator / Studio Dynamic Range',
        detail: `Measured ${technical.rmsLoudnessDb.toFixed(1)} dBFS RMS with ${technical.crestFactorDb.toFixed(1)} dB crest factor${
          typeof technical.ebur128IntegratedLufs === 'number'
            ? ` (${technical.ebur128IntegratedLufs.toFixed(1)} LUFS)`
            : ''
        }—consistent with raw camera mic, voiceover, or uncompressed studio stems.`,
      });
    }
  }

  if (
    !detectedRightsHolder &&
    !detectedIsrc &&
    flaggedSegments.length > 0 &&
    !hasRoyaltyFreeDeclaration
  ) {
    const windowSummary = flaggedSegments
      .slice(0, 3)
      .map((s) => `${s.startSec.toFixed(1)}s–${s.endSec.toFixed(1)}s`)
      .join(', ');
    findings.push({
      code: 'SEGMENT_MASTERING_ANOMALY',
      severity: 'warning',
      title: `Commercial Loudness Spike in ${flaggedSegments.length} Time Window(s)`,
      detail: `Segment scan detected dense commercially limited audio at ${windowSummary} (${flaggedSegments[0].riskReason}). Check these timestamps for background music.`,
    });
  } else if (
    !detectedRightsHolder &&
    !detectedIsrc &&
    reviewSegments.length > 0 &&
    !hasRoyaltyFreeDeclaration
  ) {
    findings.push({
      code: 'SEGMENT_STEREO_MIX',
      severity: 'warning',
      title: `Wide Stereo Produced Segment(s) Detected (${reviewSegments.length})`,
      detail: `Timestamps around ${reviewSegments[0].startSec.toFixed(1)}s–${reviewSegments[0].endSec.toFixed(1)}s show ${reviewSegments[0].stereoSidePct}% stereo side energy, typical of backing music.`,
    });
  }

  if (findings.every((f) => f.severity === 'clear')) {
    findings.unshift({
      code: 'NO_RIGHTS_CLAIMS_FOUND',
      severity: 'clear',
      title: 'Zero Commercial Label, ISRC, PRO, or XMP Claims',
      detail:
        'Container format streams, binary XMP boxes, and metadata headers contain no UMG/Sony/Warner/TME rights notices, ISRC/ISWC codes, PRO affiliations, or sync-catalog locks.',
    });
  }

  const hasBlocked = findings.some((f) => f.severity === 'blocked');
  const hasWarning = findings.some((f) => f.severity === 'warning');

  const studioClearanceChecklist: StudioClearanceCheckItem[] = [
    {
      id: 'identifiers',
      label: 'ISRC / ISWC / UPC / PRO Clearance',
      status:
        detectedIsrc || detectedIswc || detectedProSociety
          ? 'blocked'
          : detectedUpc
          ? 'action_required'
          : 'pass',
      detail:
        detectedIsrc || detectedIswc || detectedProSociety
          ? `Found registered code(s): ${[detectedIsrc, detectedIswc, detectedProSociety]
              .filter(Boolean)
              .join(' · ')}`
          : 'No existing commercial recording or publishing IDs embedded.',
    },
    {
      id: 'rights-holder',
      label: 'Record Label / Distributor / XMP Lock',
      status:
        detectedRightsHolder || tags.xmpRightsMarked === 'true'
          ? 'blocked'
          : 'pass',
      detail:
        detectedRightsHolder ||
        (tags.xmpRightsMarked === 'true'
          ? 'XMP rights flag set'
          : 'No record-label or aggregator claim present.'),
    },
    {
      id: 'timeline-acoustics',
      label: 'Segment-by-Segment Acoustic Scan',
      status: hasBlocked
        ? 'blocked'
        : flaggedSegments.length > 0 || reviewSegments.length > 0
        ? 'action_required'
        : 'pass',
      detail:
        segments.length > 0
          ? `${segments.length} windows scanned · ${flaggedSegments.length} flagged, ${reviewSegments.length} review`
          : 'Whole-file acoustic dynamics inspected.',
    },
    {
      id: 'custody-hash',
      label: 'SHA-256 Chain-of-Custody Proof',
      status: technical.fileSha256 ? 'pass' : 'action_required',
      detail: technical.fileSha256
        ? `File ${technical.fileSha256.slice(0, 12)}… · Audio ${
            technical.audioStreamSha256?.slice(0, 12) || 'N/A'
          }`
        : 'Attach local file hash before SR/PA copyright filing.',
    },
  ];

  if (hasBlocked) {
    return {
      status: 'copyrighted_detected',
      verdictTitle: 'Existing Copyright / Commercial Claim Detected',
      verdictSummary: detectedRightsHolder
        ? `Flagged existing rights metadata (${detectedRightsHolder}${
            detectedIsrc ? ` · ISRC ${detectedIsrc}` : ''
          }). Do not register this audio as an original work without replacing or re-recording the soundtrack.`
        : `Flagged registered recording metadata (${
            detectedIsrc || detectedIswc || detectedProSociety || 'copyright tag'
          }). Replace or strip the audio before studio registration.`,
      safeForStudioRegistration: false,
      detectedRightsHolder,
      detectedIsrc,
      detectedIswc,
      detectedUpc,
      detectedProSociety,
      creativeCommons,
      matchedCatalogPostTitle,
      flaggedSegmentCount: flaggedSegments.length,
      studioClearanceChecklist,
      tags,
      technical,
      findings,
    };
  }

  if (hasWarning) {
    return {
      status: 'potential_third_party',
      verdictTitle: 'Review Recommended — Unverified Music Characteristics',
      verdictSummary:
        'No major-label block was found, but embedded song tags, restricted license terms, or heavy mastering segments were detected. Confirm the creator recorded every stem from scratch before filing copyright.',
      safeForStudioRegistration: false,
      detectedRightsHolder,
      detectedIsrc,
      detectedIswc,
      detectedUpc,
      detectedProSociety,
      creativeCommons,
      matchedCatalogPostTitle,
      flaggedSegmentCount: flaggedSegments.length,
      studioClearanceChecklist,
      tags,
      technical,
      findings,
    };
  }

  return {
    status: 'clear_original',
    verdictTitle: 'No Existing Copyright Detected — Clear for Studio Intake',
    verdictSummary:
      'No commercial record-label claims, ISRC/ISWC/PRO locks, or restricted mastering segments were found. Ready for studio stem extraction and creator copyright registration.',
    safeForStudioRegistration: true,
    detectedUpc,
    creativeCommons,
    matchedCatalogPostTitle,
    flaggedSegmentCount: 0,
    studioClearanceChecklist,
    tags,
    technical,
    findings,
  };
}
