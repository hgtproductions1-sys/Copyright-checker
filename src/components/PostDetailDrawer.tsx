import { useEffect } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  FileAudio,
  FileCheck2,
  Info,
  Play,
  Plus,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  AUDIO_STYLE_LABELS,
  formatCompactNumber,
  formatDuration,
  getAudioStatusTextClass,
  PLATFORM_LABELS,
} from '../lib/formatters';
import type { ViralPost } from '../types/media';

interface PostDetailDrawerProps {
  post: ViralPost | null;
  isSaved: boolean;
  isPlaying: boolean;
  isDownloading: boolean;
  isDownloadingAudio: boolean;
  isSendingCompiler: boolean;
  onClose: () => void;
  onToggleSave: (post: ViralPost) => void;
  onTogglePlayPreview: (post: ViralPost) => void;
  onDownloadVideo: (post: ViralPost) => void;
  onDownloadAudio: (post: ViralPost) => void;
  onSendPostToCompiler: (post: ViralPost) => void;
  onDownloadWav: (post: ViralPost) => void;
  onDownloadCopyrightSheet: (post: ViralPost) => void;
}

export function PostDetailDrawer({
  post,
  isSaved,
  isPlaying,
  isDownloading,
  isDownloadingAudio,
  isSendingCompiler,
  onClose,
  onToggleSave,
  onTogglePlayPreview,
  onDownloadVideo,
  onDownloadAudio,
  onSendPostToCompiler,
  onDownloadWav,
  onDownloadCopyrightSheet,
}: PostDetailDrawerProps) {
  useEffect(() => {
    if (!post) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [post, onClose]);

  if (!post) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-post-title"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white h-full overflow-y-auto border-l border-slate-200 p-6 flex flex-col justify-between gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-slate-800">
                  {PLATFORM_LABELS[post.platform]}
                </span>
                {' · '}
                <span>@{post.creatorHandle}</span>
                {' · '}
                <span>{formatDuration(post.durationSec)}</span>
              </div>
              <h2
                id="drawer-post-title"
                className="text-lg font-bold text-slate-900 leading-snug"
              >
                {post.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close audio verification panel"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Recording Studio Media & Copyright Kit */}
          <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-900">
                Recording Studio Media & Copyright Kit
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Download audio-only MP3, send directly to the Audio Studio
                compiler timeline, save the MP4 video in-app, or export an
                artist copyright & split-sheet intake form.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isDownloadingAudio}
                onClick={() => onDownloadAudio(post)}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isDownloadingAudio
                    ? 'Extracting MP3...'
                    : 'Download Audio (.mp3)'}
                </span>
              </button>

              <button
                type="button"
                disabled={isSendingCompiler}
                onClick={() => {
                  onClose();
                  onSendPostToCompiler(post);
                }}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-300 rounded-lg hover:bg-sky-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isSendingCompiler ? 'Sending...' : 'Send Audio to Compiler'}
                </span>
              </button>

              <button
                type="button"
                disabled={isDownloading}
                onClick={() => onDownloadVideo(post)}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isDownloading
                    ? 'Downloading Video...'
                    : 'Download Video (In-App)'}
                </span>
              </button>

              {post.classification.isOriginalSafe && (
                <button
                  type="button"
                  onClick={() => onTogglePlayPreview(post)}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isPlaying ? (
                    <>
                      <Square className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                      <span>Stop Audio Preview</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                      <span>Play Audio Preview</span>
                    </>
                  )}
                </button>
              )}

              {post.classification.isOriginalSafe && (
                <button
                  type="button"
                  onClick={() => onDownloadWav(post)}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileAudio className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                  <span>16-bit WAV Master</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onDownloadCopyrightSheet(post)}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileCheck2 className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                <span>Copyright Intake Sheet (.txt)</span>
              </button>
            </div>
          </section>

          {/* Audio Classification Verdict */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              Audio Rights & Originality Verdict
            </h3>
            <div className="text-sm">
              <span className={getAudioStatusTextClass(post.classification.status)}>
                {post.classification.summaryLabel}
              </span>
              <span className="text-slate-400"> · </span>
              <span className="text-slate-700">
                {AUDIO_STYLE_LABELS[post.classification.audioStyle]}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-2 pt-1 text-xs border-t border-slate-100">
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-slate-500">Sound Track Attribution</dt>
                <dd className="font-mono text-slate-900 text-right">
                  {post.audioTitle}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-slate-500">Audio Uploader</dt>
                <dd className="font-mono text-slate-900 text-right">
                  @{post.audioAuthor}
                </dd>
              </div>
              {(post.bpm || post.musicalKey) && (
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-slate-500">Studio Tempo & Key</dt>
                  <dd className="font-mono tabular-nums text-slate-900 text-right">
                    {[post.bpm ? `${post.bpm} BPM` : null, post.musicalKey]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-slate-500">First-Party Creator Match</dt>
                <dd className="text-slate-900 font-medium text-right">
                  {post.classification.isCreatorOwned
                    ? 'Yes (Uploader recorded sound)'
                    : 'No (External or shared audio)'}
                </dd>
              </div>
            </dl>
          </section>

          <hr className="border-slate-200" />

          {/* Signal Breakdown */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900">
              Verification Signals ({post.classification.signals.length})
            </h3>
            <ul className="divide-y divide-slate-100 border-t border-b border-slate-100">
              {post.classification.signals.map((sig) => (
                <li key={sig.code} className="py-3 flex items-start gap-2.5 text-xs">
                  {sig.polarity === 'original' ? (
                    <CheckCircle2
                      className="w-4 h-4 text-teal-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : sig.polarity === 'copyrighted' ? (
                    <XCircle
                      className="w-4 h-4 text-rose-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <Info
                      className="w-4 h-4 text-sky-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  )}
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-900">
                      {sig.label}
                    </div>
                    <p className="text-slate-600 leading-relaxed">{sig.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Virality Metrics */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-900">
              Virality & Reach Metrics
            </h3>
            <div className="grid grid-cols-3 gap-4 py-3 border-t border-b border-slate-100 text-xs">
              <div>
                <div className="text-slate-500">Total Views</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatCompactNumber(post.views)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Daily Velocity</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatCompactNumber(post.viewsPerDay)}/d
                </div>
              </div>
              <div>
                <div className="text-slate-500">Engagement</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {post.engagementRatePct}%
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed pt-1">
              <span className="font-semibold text-slate-800">Caption: </span>
              {post.caption}
            </p>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onToggleSave(post)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              isSaved
                ? 'bg-sky-50 text-sky-900 border-sky-300'
                : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {isSaved ? (
              <>
                <BookmarkCheck className="w-4 h-4" aria-hidden="true" />
                <span>Saved in Shortlist</span>
              </>
            ) : (
              <>
                <Bookmark className="w-4 h-4" aria-hidden="true" />
                <span>Save to Shortlist</span>
              </>
            )}
          </button>

          <a
            href={post.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            <span>Source Permalink</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
