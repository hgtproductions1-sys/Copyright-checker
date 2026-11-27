import { Download, FileAudio, FileCheck2, Plus, Trash2 } from 'lucide-react';
import {
  buildShortlistCsv,
  formatCompactNumber,
  getAudioStatusTextClass,
  PLATFORM_LABELS,
} from '../lib/formatters';
import type { SavedLead, ViralPost } from '../types/media';

interface SavedLeadsViewProps {
  leads: SavedLead[];
  downloadingPostId: string | null;
  downloadingAudioPostId: string | null;
  sendingCompilerPostId: string | null;
  onDownloadVideo: (post: ViralPost) => void;
  onDownloadAudio: (post: ViralPost) => void;
  onSendPostToCompiler: (post: ViralPost) => void;
  onDownloadCopyrightSheet: (post: ViralPost) => void;
  onUpdateNotes: (postId: string, notes: string) => void;
  onRemoveLead: (postId: string) => void;
  onInspectPost: (post: ViralPost) => void;
  onNavigateDiscover: () => void;
}

export function SavedLeadsView({
  leads,
  downloadingPostId,
  downloadingAudioPostId,
  sendingCompilerPostId,
  onDownloadVideo,
  onDownloadAudio,
  onSendPostToCompiler,
  onDownloadCopyrightSheet,
  onUpdateNotes,
  onRemoveLead,
  onInspectPost,
  onNavigateDiscover,
}: SavedLeadsViewProps) {
  const handleExportCsv = () => {
    if (leads.length === 0) return;
    const csv = buildShortlistCsv(leads);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `origisound-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Saved Artist & Original-Audio Studio Shortlist
          </h1>
          <p className="text-sm text-slate-600">
            Organize aspiring creator leads, add studio session notes, download
            MP3 audio or MP4 videos in-app, send tracks to the compiler, and
            export artist copyright intake sheets.
          </p>
        </div>

        <button
          type="button"
          disabled={leads.length === 0}
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          <span>Download CSV ({leads.length})</span>
        </button>
      </section>

      {leads.length === 0 ? (
        <section className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            Your studio shortlist is currently empty
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Bookmark verified original-audio videos or Douyin non-copyrighted
            music tracks from the Discover feed to manage artist copyright
            sessions here.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onNavigateDiscover}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Browse Viral Original Audio
            </button>
          </div>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50">
                <th className="py-3 px-4">Post & Audio Track</th>
                <th className="py-3 px-3">Platform</th>
                <th className="py-3 px-3">Audio Verdict</th>
                <th className="py-3 px-3 text-right">Velocity</th>
                <th className="py-3 px-3">Studio Session Notes</th>
                <th className="py-3 px-4 text-right">In-App Studio Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {leads.map(({ post, notes }) => {
                const isDownloading = downloadingPostId === post.id;
                const isDownloadingAudio = downloadingAudioPostId === post.id;
                const isSendingCompiler = sendingCompilerPostId === post.id;
                return (
                  <tr key={post.id} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3.5 px-4 max-w-xs">
                      <button
                        type="button"
                        onClick={() => onInspectPost(post)}
                        className="font-semibold text-slate-900 hover:text-sky-700 text-left cursor-pointer"
                      >
                        {post.title}
                      </button>
                      <div className="text-slate-500 mt-0.5 font-mono text-[11px] truncate">
                        @{post.creatorHandle} · {post.audioTitle}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap">
                      {PLATFORM_LABELS[post.platform]}
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={getAudioStatusTextClass(
                          post.classification.status
                        )}
                      >
                        {post.classification.summaryLabel}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-900 font-semibold whitespace-nowrap">
                      {post.views > 0
                        ? `${formatCompactNumber(post.viewsPerDay)}/d`
                        : 'Unmetered'}
                    </td>
                    <td className="py-3 px-3 min-w-[200px]">
                      <label htmlFor={`note-${post.id}`} className="sr-only">
                        Studio session notes for {post.title}
                      </label>
                      <input
                        id={`note-${post.id}`}
                        type="text"
                        value={notes}
                        onChange={(e) => onUpdateNotes(post.id, e.target.value)}
                        placeholder="Add artist split or master note..."
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isDownloadingAudio}
                          onClick={() => onDownloadAudio(post)}
                          aria-label={`Download MP3 audio for ${post.title}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-700 text-white rounded-md hover:bg-sky-800 disabled:opacity-60 font-semibold cursor-pointer"
                        >
                          <FileAudio className="w-3 h-3" aria-hidden="true" />
                          <span>{isDownloadingAudio ? 'MP3...' : 'MP3'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isSendingCompiler}
                          onClick={() => onSendPostToCompiler(post)}
                          aria-label={`Send ${post.title} audio to compiler`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-50 border border-sky-300 text-sky-900 rounded-md hover:bg-sky-100 disabled:opacity-60 font-semibold cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                          <span>
                            {isSendingCompiler ? 'Sending...' : 'Compile'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() => onDownloadVideo(post)}
                          aria-label={`Download video for ${post.title} in app`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-60 font-semibold cursor-pointer"
                        >
                          <Download className="w-3 h-3" aria-hidden="true" />
                          <span>{isDownloading ? 'Saving...' : 'Video'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadCopyrightSheet(post)}
                          aria-label={`Download copyright intake sheet for ${post.title}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 text-slate-800 rounded-md hover:bg-slate-100 font-medium cursor-pointer"
                        >
                          <FileCheck2 className="w-3 h-3" aria-hidden="true" />
                          <span>Copyright</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveLead(post.id)}
                          aria-label={`Remove ${post.title} from shortlist`}
                          className="p-1.5 text-slate-500 hover:text-rose-700 rounded-md hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
