import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  AudioWaveform,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileJson,
  FileVideo,
  Fingerprint,
  Globe,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { formatPreciseTimecode } from '../lib/audioTimelineMath';
import type { AudioSimilarityReport } from '../lib/audioSimilarity';
import { sanitizeDownloadFilename } from '../lib/urlSafety';
import type {
  RegistryLookupResult,
  VideoCopyrightCheckResult,
} from '../lib/videoCopyrightInspector';
import { CopyrightTimelineCanvas } from './CopyrightTimelineCanvas';

interface CopyrightCheckerViewProps {
  onSendVideoToStudio: (file: File) => void;
}

type CheckerToolTab = 'file_scanner' | 'registry_lookup' | 'audio_matcher';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function CopyrightCheckerView({
  onSendVideoToStudio,
}: CopyrightCheckerViewProps) {
  const [activeTool, setActiveTool] = useState<CheckerToolTab>('file_scanner');

  // Tool 1: File & Segment-by-Segment Scanner
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState<
    'original' | 'copyrighted' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<VideoCopyrightCheckResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Tool 2: Global Registry & ISRC Lookup
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryResult, setRegistryResult] =
    useState<RegistryLookupResult | null>(null);

  // Tool 3: Reference Audio / Beat Matcher
  const [comparePrimaryFile, setComparePrimaryFile] = useState<File | null>(null);
  const [compareRefFile, setCompareRefFile] = useState<File | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareSampleLoading, setCompareSampleLoading] = useState<
    'match' | 'distinct' | null
  >(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareReport, setCompareReport] =
    useState<AudioSimilarityReport | null>(null);
  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const videoPreviewUrl = useMemo(() => {
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  const inspectFile = async (file: File) => {
    if (!file || file.size === 0) {
      setError('Select a non-empty video or audio file to check.');
      return;
    }
    if (file.size > 45 * 1024 * 1024) {
      setError('File exceeds the 45 MB upload limit. Trim or compress the clip first.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setLoading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const res = await fetch('/api/check-video-copyright', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: arrayBuf,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        report?: VideoCopyrightCheckResult;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.report) {
        setError(data.error || 'Unable to inspect uploaded video file.');
        setReport(null);
      } else {
        setReport(data.report);
        // Pre-fill registry query when detected ISRC or track title exists
        const suggested =
          data.report.detectedIsrc ||
          [data.report.tags.title, data.report.tags.artist]
            .filter(Boolean)
            .join(' ');
        if (suggested) {
          setRegistryQuery(suggested);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Network error while checking video copyright.'
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSampleVideo = async (kind: 'original' | 'copyrighted') => {
    setSampleLoading(kind);
    setError(null);
    try {
      const res = await fetch(`/api/sample-video?kind=${kind}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const fileName =
        kind === 'copyrighted'
          ? 'sample-umg-copyrighted-clip.mp4'
          : 'sample-studio-original-clip.mp4';
      const sampleFile = new File([blob], fileName, { type: 'video/mp4' });
      await inspectFile(sampleFile);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load studio sample video.'
      );
    } finally {
      setSampleLoading(null);
    }
  };

  const runRegistrySearch = async (queryOverride?: string) => {
    const q = (queryOverride ?? registryQuery).trim();
    if (q.length < 2) {
      setRegistryError(
        'Enter at least 2 characters (track title, artist, lyrics, or ISRC code).'
      );
      return;
    }
    if (queryOverride !== undefined) {
      setRegistryQuery(queryOverride);
    }
    setRegistryLoading(true);
    setRegistryError(null);
    try {
      const res = await fetch('/api/lookup-copyright-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as RegistryLookupResult & {
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setRegistryError(data.error || 'Registry lookup failed.');
        setRegistryResult(null);
      } else {
        setRegistryResult(data);
      }
    } catch (err) {
      setRegistryError(
        err instanceof Error ? err.message : 'Unable to reach registry endpoint.'
      );
      setRegistryResult(null);
    } finally {
      setRegistryLoading(false);
    }
  };

  const runAudioComparison = async (primary: File, reference: File) => {
    setCompareLoading(true);
    setCompareError(null);
    try {
      const [pBuf, rBuf] = await Promise.all([
        primary.arrayBuffer(),
        reference.arrayBuffer(),
      ]);
      const res = await fetch('/api/compare-audio-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryName: primary.name,
          primaryBase64: arrayBufferToBase64(pBuf),
          referenceName: reference.name,
          referenceBase64: arrayBufferToBase64(rBuf),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        comparison?: AudioSimilarityReport;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.comparison) {
        setCompareError(data.error || 'Unable to compare uploaded audio files.');
        setCompareReport(null);
      } else {
        setCompareReport(data.comparison);
      }
    } catch (err) {
      setCompareError(
        err instanceof Error ? err.message : 'Comparison request failed.'
      );
      setCompareReport(null);
    } finally {
      setCompareLoading(false);
    }
  };

  const handleLoadComparisonSamples = async (mode: 'match' | 'distinct') => {
    setCompareSampleLoading(mode);
    setCompareError(null);
    try {
      if (mode === 'match') {
        const [vidRes, mp3Res] = await Promise.all([
          fetch('/api/sample-video?kind=original'),
          fetch('/api/sample-mp3?preset=guzheng_rain_lofi'),
        ]);
        if (!vidRes.ok || !mp3Res.ok) {
          throw new Error('Failed to generate comparison samples.');
        }
        const [vidBlob, mp3Blob] = await Promise.all([
          vidRes.blob(),
          mp3Res.blob(),
        ]);
        const primary = new File([vidBlob], 'creator-video-upload.mp4', {
          type: 'video/mp4',
        });
        const ref = new File([mp3Blob], 'guzheng-original-master.mp3', {
          type: 'audio/mpeg',
        });
        setComparePrimaryFile(primary);
        setCompareRefFile(ref);
        await runAudioComparison(primary, ref);
      } else {
        const [aRes, bRes] = await Promise.all([
          fetch('/api/sample-mp3?preset=jiangnan_pipa_groove'),
          fetch('/api/sample-mp3?preset=yunnan_handpan_echo'),
        ]);
        if (!aRes.ok || !bRes.ok) {
          throw new Error('Failed to generate comparison samples.');
        }
        const [aBlob, bBlob] = await Promise.all([aRes.blob(), bRes.blob()]);
        const primary = new File([aBlob], 'artist-pipa-take.mp3', {
          type: 'audio/mpeg',
        });
        const ref = new File([bBlob], 'external-handpan-reference.mp3', {
          type: 'audio/mpeg',
        });
        setComparePrimaryFile(primary);
        setCompareRefFile(ref);
        await runAudioComparison(primary, ref);
      }
    } catch (err) {
      setCompareError(
        err instanceof Error ? err.message : 'Unable to load sample audio pair.'
      );
    } finally {
      setCompareSampleLoading(null);
    }
  };

  const handleDownloadAuditCertificate = (format: 'txt' | 'json') => {
    if (!report) return;

    const baseName = sanitizeDownloadFilename(
      `copyright-check-${report.technical.fileName}`
    );

    if (format === 'json') {
      const jsonBlob = new Blob([JSON.stringify(report, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(jsonBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return;
    }

    const lines = [
      'ORIGISOUND — STUDIO COPYRIGHT, METADATA & ACOUSTIC AUDIT CERTIFICATE',
      '====================================================================',
      `Inspected At:        ${new Date().toISOString()}`,
      `Source File:         ${report.technical.fileName} (${formatBytes(report.technical.fileSizeBytes)})`,
      `File SHA-256:        ${report.technical.fileSha256 || 'N/A'}`,
      `Audio PCM SHA-256:   ${report.technical.audioStreamSha256 || 'N/A'}`,
      `Acoustic Digest:     ${report.technical.acousticDigest || 'N/A (Silent)'}`,
      `Container / Codecs:  ${report.technical.containerFormat} (${report.technical.videoCodec || 'no-video'} / ${report.technical.audioCodec || 'no-audio'})`,
      `Duration:            ${formatPreciseTimecode(report.technical.durationSec)}`,
      `EBU R128 Loudness:   ${
        report.technical.ebur128IntegratedLufs !== undefined
          ? `${report.technical.ebur128IntegratedLufs} LUFS · LRA ${report.technical.ebur128LoudnessRangeLu ?? 'N/A'} LU`
          : 'N/A'
      }`,
      '',
      'VERDICT',
      `Status:              ${report.verdictTitle}`,
      `Studio Safe:         ${report.safeForStudioRegistration ? 'YES — Clear for Studio Intake' : 'NO — Existing Claim or Review Required'}`,
      `Rights Holder:       ${report.detectedRightsHolder || 'None Detected'}`,
      `ISRC / ISWC / UPC:   ${[report.detectedIsrc, report.detectedIswc, report.detectedUpc].filter(Boolean).join(' · ') || 'None Detected'}`,
      `PRO Affiliation:     ${report.detectedProSociety || 'None Detected'}`,
      `Summary:             ${report.verdictSummary}`,
      '',
      'CLEARANCE CHECKLIST',
      ...report.studioClearanceChecklist.map(
        (c) => `  - [${c.status.toUpperCase()}] ${c.label}: ${c.detail}`
      ),
      '',
      'FINDINGS',
      ...report.findings.map(
        (f) => `  - [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`
      ),
      '',
      'Studio Note: Retain the SHA-256 file proof and creator signed originality statement',
      'when submitting sound-recording (SR) or composition (PA) copyright filings.',
    ];
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Studio Copyright Checking Toolkit Header & Navigation Tabs */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Studio Copyright Checker & Rights Verification Suite
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Screen videos and stems before studio copyright registration: inspect
              container tags, XMP flags, ISRC/ISWC/UPC/PRO claims, SHA-256 hashes,
              EBU R128 segment risk windows, global music catalogs, and
              reference-beat similarity.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Copyright checking tools"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTool === 'file_scanner'}
              onClick={() => setActiveTool('file_scanner')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTool === 'file_scanner'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>File & Timeline Scanner</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTool === 'registry_lookup'}
              onClick={() => setActiveTool('registry_lookup')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTool === 'registry_lookup'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ISRC, Title & Registry Lookup</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTool === 'audio_matcher'}
              onClick={() => setActiveTool('audio_matcher')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTool === 'audio_matcher'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <AudioWaveform className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Beat & Reference Matcher</span>
            </button>
          </div>
        </div>

        {/* TOOL 1 UPLOAD PANEL */}
        {activeTool === 'file_scanner' && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) {
                  void inspectFile(dropped);
                }
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                isDragging
                  ? 'border-sky-600 bg-sky-50/50'
                  : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
              }`}
            >
              <input
                ref={fileInputRef}
                id="copyright-video-file-input"
                type="file"
                accept="video/*,audio/*"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) {
                    void inspectFile(picked);
                  }
                }}
                className="sr-only"
              />

              <div className="max-w-md mx-auto space-y-3">
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center mx-auto text-slate-700">
                  <Upload className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="copyright-video-file-input"
                    className="text-sm font-semibold text-slate-900 cursor-pointer hover:text-sky-700"
                  >
                    Choose a video or audio file to audit copyright
                  </label>
                  <p className="text-xs text-slate-500">
                    Scans MP4, MOV, WebM, MKV, MP3, and WAV up to 45 MB for XMP,
                    ISRC/ISWC/UPC, PRO societies, Creative Commons, EBU R128, &
                    segment loudness spikes.
                  </p>
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {loading ? 'Running Deep Scan...' : 'Select Video From Computer'}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">
                Quick test studio files:
              </span>
              <button
                type="button"
                disabled={loading || sampleLoading !== null}
                onClick={() => void handleLoadSampleVideo('original')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {sampleLoading === 'original'
                  ? 'Generating Sample...'
                  : 'Load Sample Video (Clean Studio Original)'}
              </button>
              <button
                type="button"
                disabled={loading || sampleLoading !== null}
                onClick={() => void handleLoadSampleVideo('copyrighted')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {sampleLoading === 'copyrighted'
                  ? 'Generating Sample...'
                  : 'Load Sample Video (UMG Copyrighted Track)'}
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
              >
                {error}
              </div>
            )}
          </div>
        )}

        {/* TOOL 2: GLOBAL MUSIC REGISTRY & ISRC LOOKUP */}
        {activeTool === 'registry_lookup' && (
          <div data-testid="registry-lookup-panel" className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runRegistrySearch();
              }}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <div className="flex-1">
                <label htmlFor="registry-query-input" className="sr-only">
                  Search track title, artist, lyrics, or ISRC code
                </label>
                <input
                  id="registry-query-input"
                  type="text"
                  value={registryQuery}
                  onChange={(e) => setRegistryQuery(e.target.value)}
                  placeholder="Enter Song Title, Artist Name, Lyrics Phrase, or ISRC (e.g. USUM72409182)..."
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
              <button
                type="submit"
                disabled={registryLoading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {registryLoading
                    ? 'Querying Registries...'
                    : 'Search Global Registries'}
                </span>
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Sample lookups:</span>
              <button
                type="button"
                onClick={() => void runRegistrySearch('Espresso Sabrina Carpenter')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer whitespace-nowrap"
              >
                Sabrina Carpenter — Espresso
              </button>
              <button
                type="button"
                onClick={() => void runRegistrySearch('USUM72409182')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-mono cursor-pointer whitespace-nowrap"
              >
                ISRC USUM72409182
              </button>
              <button
                type="button"
                onClick={() => void runRegistrySearch('Universal Music')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer whitespace-nowrap"
              >
                Universal Music
              </button>
            </div>

            {registryError && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
              >
                {registryError}
              </div>
            )}

            {registryResult && (
              <div className="space-y-4 pt-2 border-t border-slate-200">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900">
                      Registry Audit Summary ({registryResult.hits.length}{' '}
                      {registryResult.hits.length === 1 ? 'hit' : 'hits'})
                    </span>
                    <span className="font-mono text-slate-500">
                      Sources: {registryResult.sourcesQueried.join(' · ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {registryResult.summary}
                  </p>
                  {registryResult.isrcValid && (
                    <div className="pt-1 text-xs font-mono tabular-nums text-sky-900">
                      Valid ISRC Structure: {registryResult.isrcValid.code} ·
                      Country {registryResult.isrcValid.country} · Registrant{' '}
                      {registryResult.isrcValid.registrant} · Designation Year{' '}
                      {registryResult.isrcValid.year}
                    </div>
                  )}
                </div>

                {registryResult.hits.length > 0 && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                    {registryResult.hits.map((hit, i) => (
                      <div
                        key={`${hit.source}-${hit.title}-${i}`}
                        className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="font-semibold text-slate-900">
                            {hit.title}{' '}
                            <span className="font-normal text-slate-600">
                              — {hit.artist}
                            </span>
                          </div>
                          <div className="text-slate-500 font-mono tabular-nums">
                            {hit.source}
                            {hit.albumOrRelease ? ` · ${hit.albumOrRelease}` : ''}
                            {hit.isrc ? ` · ISRC ${hit.isrc}` : ''}
                            {hit.releaseDate ? ` · ${hit.releaseDate}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`font-semibold ${
                              hit.isCommercialLocked
                                ? 'text-rose-700'
                                : 'text-teal-700'
                            }`}
                          >
                            {hit.rightsOrLabel ||
                              (hit.isCommercialLocked
                                ? 'Commercial Rights Match'
                                : 'Creator / Original Entry')}
                          </span>
                          {hit.externalUrl && (
                            <a
                              href={hit.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 font-medium whitespace-nowrap"
                            >
                              <span>Record</span>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TOOL 3: BEAT & REFERENCE AUDIO MATCHER */}
        {activeTool === 'audio_matcher' && (
          <div data-testid="audio-matcher-panel" className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/70 space-y-2.5">
                <div className="text-xs font-semibold text-slate-900">
                  1. Target Video or Studio Track
                </div>
                <input
                  ref={primaryInputRef}
                  id="compare-primary-input"
                  type="file"
                  accept="video/*,audio/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setComparePrimaryFile(f);
                      setCompareError(null);
                    }
                  }}
                  className="sr-only"
                />
                <button
                  type="button"
                  onClick={() => primaryInputRef.current?.click()}
                  className="w-full px-3 py-2 text-xs font-medium text-left bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer truncate"
                >
                  {comparePrimaryFile
                    ? `${comparePrimaryFile.name} (${formatBytes(comparePrimaryFile.size)})`
                    : 'Choose artist demo or uploaded video...'}
                </button>
              </div>

              <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/70 space-y-2.5">
                <div className="text-xs font-semibold text-slate-900">
                  2. Reference Beat, Type-Beat, or Existing Song
                </div>
                <input
                  ref={referenceInputRef}
                  id="compare-reference-input"
                  type="file"
                  accept="video/*,audio/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setCompareRefFile(f);
                      setCompareError(null);
                    }
                  }}
                  className="sr-only"
                />
                <button
                  type="button"
                  onClick={() => referenceInputRef.current?.click()}
                  className="w-full px-3 py-2 text-xs font-medium text-left bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer truncate"
                >
                  {compareRefFile
                    ? `${compareRefFile.name} (${formatBytes(compareRefFile.size)})`
                    : 'Choose reference MP3/WAV/MP4 beat to check against...'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">
                  Quick test stem pairs:
                </span>
                <button
                  type="button"
                  disabled={compareLoading || compareSampleLoading !== null}
                  onClick={() => void handleLoadComparisonSamples('match')}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  {compareSampleLoading === 'match'
                    ? 'Comparing Pair...'
                    : 'Test Matching Video vs Reference Beat'}
                </button>
                <button
                  type="button"
                  disabled={compareLoading || compareSampleLoading !== null}
                  onClick={() => void handleLoadComparisonSamples('distinct')}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  {compareSampleLoading === 'distinct'
                    ? 'Comparing Pair...'
                    : 'Test Two Distinct Tracks'}
                </button>
              </div>

              <button
                type="button"
                disabled={compareLoading || !comparePrimaryFile || !compareRefFile}
                onClick={() => {
                  if (comparePrimaryFile && compareRefFile) {
                    void runAudioComparison(comparePrimaryFile, compareRefFile);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {compareLoading
                    ? 'Analyzing PCM Envelopes...'
                    : 'Compare Acoustic Fingerprint & Similarity'}
                </span>
              </button>
            </div>

            {compareError && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
              >
                {compareError}
              </div>
            )}

            {compareReport && (
              <div
                data-testid="audio-similarity-report"
                className={`p-5 rounded-xl border space-y-4 ${
                  compareReport.verdict === 'high_match'
                    ? 'bg-rose-50/70 border-rose-200'
                    : compareReport.verdict === 'partial_overlap'
                    ? 'bg-amber-50/70 border-amber-200'
                    : 'bg-teal-50/70 border-teal-200'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-slate-600">
                      {compareReport.primaryName} vs {compareReport.referenceName}
                    </div>
                    <h2 className="text-base font-bold text-slate-900">
                      {compareReport.verdictTitle}
                    </h2>
                    <p className="text-xs text-slate-700 leading-relaxed max-w-2xl">
                      {compareReport.verdictSummary}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-slate-600">
                      Overall Structural Match
                    </div>
                    <div
                      data-testid="similarity-pct-value"
                      className="text-3xl font-bold font-mono tabular-nums text-slate-900"
                    >
                      {compareReport.overallSimilarityPct}%
                    </div>
                  </div>
                </div>

                {/* SVG Bar Telemetry */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200/70 text-xs font-mono tabular-nums">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-slate-700">
                      <span>Amplitude Envelope</span>
                      <span className="font-bold">
                        {compareReport.envelopeCorrelationPct}%
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 6"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className="w-full h-2 rounded overflow-hidden block"
                    >
                      <rect x="0" y="0" width="100" height="6" fill="#cbd5e1" />
                      <rect
                        x="0"
                        y="0"
                        width={compareReport.envelopeCorrelationPct}
                        height="6"
                        fill="#0369a1"
                      />
                    </svg>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-slate-700">
                      <span>Spectral Texture Contour</span>
                      <span className="font-bold">
                        {compareReport.textureCorrelationPct}%
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 6"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className="w-full h-2 rounded overflow-hidden block"
                    >
                      <rect x="0" y="0" width="100" height="6" fill="#cbd5e1" />
                      <rect
                        x="0"
                        y="0"
                        width={compareReport.textureCorrelationPct}
                        height="6"
                        fill="#0d9488"
                      />
                    </svg>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-slate-700">
                      <span>Peak Alignment Lag</span>
                      <span className="font-bold">
                        {compareReport.bestLagSec >= 0 ? '+' : ''}
                        {compareReport.bestLagSec}s
                      </span>
                    </div>
                    <div className="text-slate-600">
                      RMS: {compareReport.primaryRmsDb} vs{' '}
                      {compareReport.referenceRmsDb} dBFS
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Loading Skeleton for Tool 1 */}
      {activeTool === 'file_scanner' && loading && (
        <section
          aria-busy="true"
          aria-label="Analyzing uploaded video copyright"
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 animate-pulse"
        >
          <div className="h-5 bg-slate-200 rounded w-1/3" />
          <div className="h-4 bg-slate-200 rounded w-2/3" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            <div className="lg:col-span-5 h-52 bg-slate-200 rounded-lg" />
            <div className="lg:col-span-7 space-y-3">
              <div className="h-12 bg-slate-200 rounded" />
              <div className="h-12 bg-slate-200 rounded" />
              <div className="h-12 bg-slate-200 rounded" />
            </div>
          </div>
        </section>
      )}

      {/* Inspection Report for Tool 1 */}
      {activeTool === 'file_scanner' && !loading && report && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          {/* Verdict Banner */}
          <div
            data-testid="copyright-verdict-banner"
            className={`p-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
              report.status === 'clear_original'
                ? 'bg-teal-50/70 border-teal-200'
                : report.status === 'potential_third_party'
                ? 'bg-amber-50/70 border-amber-200'
                : 'bg-rose-50/70 border-rose-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {report.status === 'clear_original' ? (
                <ShieldCheck
                  className="w-5 h-5 text-teal-700 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              ) : report.status === 'potential_third_party' ? (
                <AlertTriangle
                  className="w-5 h-5 text-amber-700 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              ) : (
                <ShieldAlert
                  className="w-5 h-5 text-rose-700 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              )}
              <div className="space-y-1">
                <div className="text-xs font-mono text-slate-600">
                  {report.technical.fileName} ·{' '}
                  {formatBytes(report.technical.fileSizeBytes)} ·{' '}
                  {formatPreciseTimecode(report.technical.durationSec)}
                </div>
                <h2 className="text-base font-bold text-slate-900">
                  {report.verdictTitle}
                </h2>
                <p className="text-xs text-slate-700 leading-relaxed max-w-2xl">
                  {report.verdictSummary}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => onSendVideoToStudio(selectedFile)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>Convert to MP3 in Audio Studio</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDownloadAuditCertificate('txt')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Audit Report (.txt)</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadAuditCertificate('json')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Proof Packet (.json)</span>
              </button>
            </div>
          </div>

          {/* Segment-by-Segment Acoustic Timeline Scanner */}
          {report.technical.segments && report.technical.segments.length > 0 && (
            <CopyrightTimelineCanvas
              segments={report.technical.segments}
              durationSec={report.technical.durationSec}
            />
          )}

          {/* Studio Registration Readiness Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {report.studioClearanceChecklist.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">
                    {item.label}
                  </span>
                  {item.status === 'pass' ? (
                    <CheckCircle2
                      className="w-4 h-4 text-teal-700 shrink-0"
                      aria-hidden="true"
                    />
                  ) : item.status === 'action_required' ? (
                    <AlertTriangle
                      className="w-4 h-4 text-amber-700 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="w-4 h-4 text-rose-700 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Preview + EBU R128 + SHA-256 Chain of Custody Telemetry */}
            <div className="lg:col-span-5 space-y-4">
              {videoPreviewUrl && report.technical.hasVideoStream && (
                <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-950">
                  <video
                    src={videoPreviewUrl}
                    controls
                    preload="metadata"
                    className="w-full max-h-64 object-contain"
                  />
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <FileVideo className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>Stream, EBU R128 & Chain-of-Custody Telemetry</span>
                </h3>
                <dl className="divide-y divide-slate-100 text-xs border-t border-b border-slate-200">
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Container & Codecs</dt>
                    <dd className="font-mono text-slate-900 text-right">
                      {report.technical.containerFormat.split(',')[0]} ·{' '}
                      {report.technical.videoCodec || 'no-video'} /{' '}
                      {report.technical.audioCodec || 'no-audio'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Sample Rate & Channels</dt>
                    <dd className="font-mono tabular-nums text-slate-900 text-right">
                      {report.technical.sampleRateHz
                        ? `${report.technical.sampleRateHz} Hz · ${report.technical.channels || 1} ch`
                        : 'Silent'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">EBU R128 Loudness / LRA</dt>
                    <dd className="font-mono tabular-nums text-slate-900 text-right">
                      {report.technical.ebur128IntegratedLufs !== undefined
                        ? `${report.technical.ebur128IntegratedLufs} LUFS · ${
                            report.technical.ebur128LoudnessRangeLu ?? '—'
                          } LU`
                        : 'N/A'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">RMS / True Peak / Crest</dt>
                    <dd className="font-mono tabular-nums text-slate-900 text-right">
                      {report.technical.rmsLoudnessDb !== undefined
                        ? `${report.technical.rmsLoudnessDb} dBFS / ${report.technical.peakLevelDb} dBFS (${report.technical.crestFactorDb} dB)`
                        : 'N/A'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Stereo Side Ratio</dt>
                    <dd className="font-mono tabular-nums text-slate-900 text-right">
                      {report.technical.stereoSideRatioPct !== undefined
                        ? `${report.technical.stereoSideRatioPct}%`
                        : 'N/A'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Acoustic Envelope Digest</dt>
                    <dd className="font-mono text-slate-900 text-right">
                      {report.technical.acousticDigest || 'N/A'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">File SHA-256 Proof</dt>
                    <dd
                      data-testid="file-sha256-value"
                      className="font-mono text-slate-900 text-right truncate max-w-52"
                      title={report.technical.fileSha256}
                    >
                      {report.technical.fileSha256
                        ? `${report.technical.fileSha256.slice(0, 20)}…`
                        : 'N/A'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Right Column: Expanded Identifiers, XMP, PRO, & Screening Findings */}
            <div className="lg:col-span-7 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Container Identifiers, XMP, PRO & License Headers
                  </h3>
                  {(report.detectedIsrc || report.tags.title) && (
                    <button
                      type="button"
                      onClick={() => {
                        const q =
                          report.detectedIsrc ||
                          [report.tags.title, report.tags.artist]
                            .filter(Boolean)
                            .join(' ');
                        setActiveTool('registry_lookup');
                        void runRegistrySearch(q);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer whitespace-nowrap"
                    >
                      <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Verify in Global Registry</span>
                    </button>
                  )}
                </div>
                <dl className="divide-y divide-slate-100 text-xs border-t border-b border-slate-200">
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Title / Artist Tag</dt>
                    <dd className="font-mono text-slate-900 text-right">
                      {[report.tags.title, report.tags.artist]
                        .filter(Boolean)
                        .join(' — ') || 'None declared'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Album / Label / Publisher</dt>
                    <dd className="font-mono text-slate-900 text-right">
                      {[report.tags.album, report.tags.publisher]
                        .filter(Boolean)
                        .join(' · ') || 'None declared'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">Copyright Notice (© / ℗)</dt>
                    <dd
                      className={`font-mono text-right ${
                        report.detectedRightsHolder
                          ? 'text-rose-700 font-semibold'
                          : 'text-slate-900'
                      }`}
                    >
                      {report.tags.copyright || 'None declared'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">ISRC / ISWC / UPC Codes</dt>
                    <dd
                      className={`font-mono text-right ${
                        report.detectedIsrc || report.detectedIswc
                          ? 'text-rose-700 font-semibold'
                          : 'text-slate-900'
                      }`}
                    >
                      {[report.detectedIsrc, report.detectedIswc, report.detectedUpc]
                        .filter(Boolean)
                        .join(' · ') || 'None declared'}
                    </dd>
                  </div>
                  <div className="py-2 flex justify-between gap-4">
                    <dt className="text-slate-500">PRO Society / XMP Rights</dt>
                    <dd className="font-mono text-slate-900 text-right">
                      {[
                        report.detectedProSociety,
                        report.tags.xmpRightsMarked === 'true'
                          ? 'XMP Rights Marked'
                          : undefined,
                        report.creativeCommons?.code,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'None declared'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-900">
                  Copyright Screening Signals ({report.findings.length})
                </h3>
                <ul className="divide-y divide-slate-100 border-t border-b border-slate-200">
                  {report.findings.map((f) => (
                    <li
                      key={f.code}
                      className="py-3 flex items-start gap-2.5 text-xs"
                    >
                      {f.severity === 'clear' ? (
                        <CheckCircle2
                          className="w-4 h-4 text-teal-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : f.severity === 'warning' ? (
                        <AlertTriangle
                          className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="w-4 h-4 text-rose-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                      )}
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">
                          {f.title}
                        </div>
                        <p className="text-slate-600 leading-relaxed">
                          {f.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
