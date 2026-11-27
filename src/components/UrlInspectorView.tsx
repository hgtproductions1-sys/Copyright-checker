import { useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Download,
  FileAudio,
  FileCheck2,
  Link2,
  Play,
  Plus,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  AUDIO_STYLE_LABELS,
  getAudioStatusTextClass,
  PLATFORM_LABELS,
} from '../lib/formatters';
import { validateAndParseSocialUrl } from '../lib/urlSafety';
import { MediaThumbnail } from './MediaThumbnail';
import type { UrlInspectResponse, ViralPost } from '../types/media';

interface UrlInspectorViewProps {
  savedIds: Set<string>;
  playingPostId: string | null;
  downloadingPostId: string | null;
  downloadingAudioPostId: string | null;
  sendingCompilerPostId: string | null;
  downloadNotice: string | null;
  onDismissDownloadNotice: () => void;
  onTogglePlayPreview: (post: ViralPost) => void;
  onDownloadVideo: (post: ViralPost) => void;
  onDownloadAudio: (post: ViralPost) => void;
  onSendPostToCompiler: (post: ViralPost) => void;
  onDownloadWav: (post: ViralPost) => void;
  onDownloadCopyrightSheet: (post: ViralPost) => void;
  onToggleSave: (post: ViralPost) => void;
}

const SAMPLE_PUBLIC_URLS = [
  {
    label: 'TikTok Public Direct MP4 Sample (@scout2015)',
    url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  },
  {
    label: 'Douyin Non-Copyrighted Guzheng Music (无版权)',
    url: 'https://www.douyin.com/video/7421098273645109281',
  },
  {
    label: 'Douyin Street Wok Original Sound',
    url: 'https://www.douyin.com/video/7398120495821049123',
  },
  {
    label: 'TikTok Excluded UMG Commercial Track',
    url: 'https://www.tiktok.com/@tokyobiteclips/video/7410092837465019283',
  },
];

export function UrlInspectorView({
  savedIds,
  playingPostId,
  downloadingPostId,
  downloadingAudioPostId,
  sendingCompilerPostId,
  downloadNotice,
  onDismissDownloadNotice,
  onTogglePlayPreview,
  onDownloadVideo,
  onDownloadAudio,
  onSendPostToCompiler,
  onDownloadWav,
  onDownloadCopyrightSheet,
  onToggleSave,
}: UrlInspectorViewProps) {
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UrlInspectResponse | null>(null);

  const runInspection = async (targetUrl: string) => {
    const clientCheck = validateAndParseSocialUrl(targetUrl);
    if (!clientCheck.ok) {
      setValidationError(clientCheck.error || 'Invalid social URL.');
      setResult(null);
      return;
    }

    setValidationError(null);
    setLoading(true);
    try {
      const serverRes = await fetch('/api/inspect-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = (await serverRes.json()) as UrlInspectResponse;
      if (!serverRes.ok || !data.ok || !data.post) {
        setValidationError(data.error || 'Unable to inspect public URL.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Network error during inspection.'
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runInspection(urlInput);
  };

  const inspectedPost = result?.post;
  const isSaved = inspectedPost ? savedIds.has(inspectedPost.id) : false;
  const isPlaying = inspectedPost ? playingPostId === inspectedPost.id : false;
  const isDownloading = inspectedPost
    ? downloadingPostId === inspectedPost.id
    : false;
  const isDownloadingAudio = inspectedPost
    ? downloadingAudioPostId === inspectedPost.id
    : false;
  const isSendingCompiler = inspectedPost
    ? sendingCompilerPostId === inspectedPost.id
    : false;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Public URL Audio Rights & Direct Audio/Video Downloader
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Paste any public TikTok, Instagram Reel, Douyin video, or Facebook
            Reel URL. OrigiSound screens audio rights and lets your recording
            studio download audio-only MP3, send directly to the Audio Studio
            compiler, or download the full MP4 video without visiting external
            websites.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <label htmlFor="public-url-input" className="sr-only">
                Public video permalink
              </label>
              <Link2
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="public-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="https://www.tiktok.com/@creator/video/... or https://www.douyin.com/video/..."
                aria-invalid={Boolean(validationError)}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? 'Inspecting...' : 'Inspect Public URL'}
            </button>
          </div>

          {validationError && (
            <p role="alert" className="text-xs font-medium text-rose-700">
              {validationError}
            </p>
          )}
        </form>

        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">
            Quick test public links:
          </span>
          {SAMPLE_PUBLIC_URLS.map((sample) => (
            <button
              key={sample.url}
              type="button"
              onClick={() => {
                setUrlInput(sample.url);
                void runInspection(sample.url);
              }}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              {sample.label}
            </button>
          ))}
        </div>
      </section>

      {downloadNotice && (
        <div
          role="status"
          className="bg-teal-50/90 border border-teal-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-teal-950"
        >
          <span className="font-medium">{downloadNotice}</span>
          <button
            type="button"
            onClick={onDismissDownloadNotice}
            aria-label="Dismiss download status notice"
            className="p-1 rounded-md text-teal-800 hover:bg-teal-100 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {inspectedPost && result?.rawMetadata && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-slate-800">
                  {PLATFORM_LABELS[inspectedPost.platform]}
                </span>
                {' · '}
                <span>@{inspectedPost.creatorHandle}</span>
                {' · '}
                <span>{result.rawMetadata.resolvedSource}</span>
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {inspectedPost.title}
              </h2>
              <div className="text-sm pt-1">
                <span
                  className={getAudioStatusTextClass(
                    inspectedPost.classification.status
                  )}
                >
                  {inspectedPost.classification.summaryLabel}
                </span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-700">
                  {AUDIO_STYLE_LABELS[inspectedPost.classification.audioStyle]}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isDownloadingAudio}
                onClick={() => onDownloadAudio(inspectedPost)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isDownloadingAudio ? 'Extracting MP3...' : 'Download MP3'}
                </span>
              </button>

              <button
                type="button"
                disabled={isSendingCompiler}
                onClick={() => onSendPostToCompiler(inspectedPost)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-300 rounded-lg hover:bg-sky-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isSendingCompiler ? 'Sending...' : 'Send to Compiler'}
                </span>
              </button>

              <button
                type="button"
                disabled={isDownloading}
                onClick={() => onDownloadVideo(inspectedPost)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isDownloading ? 'Saving Video...' : 'Download Video'}
                </span>
              </button>

              {inspectedPost.classification.isOriginalSafe && (
                <>
                  <button
                    type="button"
                    onClick={() => onTogglePlayPreview(inspectedPost)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                        <span>Preview</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadWav(inspectedPost)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>WAV Master</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onDownloadCopyrightSheet(inspectedPost)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copyright Sheet</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleSave(inspectedPost)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  isSaved
                    ? 'bg-sky-50 text-sky-900 border-sky-300'
                    : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {isSaved ? (
                  <>
                    <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 rounded-lg overflow-hidden border border-slate-200">
              <MediaThumbnail
                src={inspectedPost.thumbnailUrl}
                alt={inspectedPost.title}
                platform={inspectedPost.platform}
                durationSec={inspectedPost.durationSec}
                creatorHandle={inspectedPost.creatorHandle}
                audioTitle={inspectedPost.audioTitle}
                bpm={inspectedPost.bpm}
                musicalKey={inspectedPost.musicalKey}
              />
            </div>

            <div className="lg:col-span-4 space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                Extracted Unauthenticated Metadata
              </h3>
              <dl className="divide-y divide-slate-100 text-xs border-t border-b border-slate-100">
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Creator Handle</dt>
                  <dd className="font-mono text-slate-900">
                    {result.rawMetadata.extractedAuthor}
                  </dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Audio Attribution</dt>
                  <dd className="font-mono text-slate-900 text-right">
                    {result.rawMetadata.extractedAudioTrack}
                  </dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Resolver HTTP Status</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {result.rawMetadata.httpStatus || 'Cached'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="lg:col-span-5 space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                Classifier Audit Signals
              </h3>
              <ul className="divide-y divide-slate-100 text-xs border-t border-b border-slate-100">
                {inspectedPost.classification.signals.map((sig) => (
                  <li key={sig.code} className="py-2.5 flex items-start gap-2">
                    {sig.polarity === 'original' ? (
                      <CheckCircle2
                        className="w-4 h-4 text-teal-700 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="w-4 h-4 text-rose-700 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-slate-900">
                        {sig.label}
                      </div>
                      <p className="text-slate-600">{sig.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
