import {
  Bookmark,
  BookmarkCheck,
  CheckSquare,
  Download,
  FileAudio,
  Layers,
  LayoutGrid,
  List,
  Music,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import {
  STUDIO_AUDIO_FORMAT_ORDER,
  STUDIO_AUDIO_FORMATS,
  type StudioAudioFormat,
} from '../lib/audioFormats';
import {
  AUDIO_STYLE_LABELS,
  formatCompactNumber,
  formatDuration,
  formatRelativeAge,
  getAudioStatusTextClass,
  PLATFORM_LABELS,
} from '../lib/formatters';
import { MediaThumbnail } from './MediaThumbnail';
import { SidebarFilters } from './SidebarFilters';
import type {
  AudioFilterMode,
  SearchResponse,
  SocialPlatform,
  SortOrder,
  ViralPost,
} from '../types/media';

interface DiscoverViewProps {
  queryInput: string;
  onChangeQueryInput: (v: string) => void;
  onSubmitSearch: (e: React.FormEvent) => void;
  liveSweep: boolean;
  onToggleLiveSweep: (v: boolean) => void;
  selectedPlatforms: SocialPlatform[];
  onTogglePlatform: (p: SocialPlatform) => void;
  onSelectAllPlatforms: () => void;
  audioMode: AudioFilterMode;
  onChangeAudioMode: (m: AudioFilterMode) => void;
  audioStyle: string;
  onChangeAudioStyle: (s: string) => void;
  selectedNiche: string;
  onChangeNiche: (n: string) => void;
  minViews: number;
  onChangeMinViews: (v: number) => void;
  sortOrder: SortOrder;
  onChangeSortOrder: (s: SortOrder) => void;
  viewLayout: 'grid' | 'table';
  onChangeViewLayout: (l: 'grid' | 'table') => void;
  onResetFilters: () => void;
  onQuickFilterDouyinMusic: () => void;
  onOpenQueryBuilder: () => void;
  onSweepMoreLive: () => void;
  sweepingMore: boolean;
  loading: boolean;
  error: string | null;
  searchData: SearchResponse | null;
  savedIds: Set<string>;
  selectedPostIds: Set<string>;
  playingPostId: string | null;
  downloadingPostId: string | null;
  downloadingAudioPostId: string | null;
  sendingCompilerPostId: string | null;
  batchBusyMode: 'none' | 'send_studio' | 'auto_compile' | 'batch_mp3';
  autoCompileFormat: StudioAudioFormat;
  onChangeAutoCompileFormat: (fmt: StudioAudioFormat) => void;
  batchProgressText: string | null;
  downloadNotice: string | null;
  onDismissDownloadNotice: () => void;
  onTogglePlayPreview: (post: ViralPost) => void;
  onDownloadVideo: (post: ViralPost) => void;
  onDownloadAudio: (post: ViralPost) => void;
  onSendPostToCompiler: (post: ViralPost) => void;
  onToggleSelectPost: (post: ViralPost) => void;
  onSelectFirstPosts: (posts: ViralPost[]) => void;
  onClearSelection: () => void;
  onSendSelectedToStudio: () => void;
  onAutoDownloadAndCompileSelected: () => void;
  onDownloadSelectedMp3s: () => void;
  onToggleSave: (post: ViralPost) => void;
  onInspectPost: (post: ViralPost) => void;
}

export function DiscoverView({
  queryInput,
  onChangeQueryInput,
  onSubmitSearch,
  liveSweep,
  onToggleLiveSweep,
  selectedPlatforms,
  onTogglePlatform,
  onSelectAllPlatforms,
  audioMode,
  onChangeAudioMode,
  audioStyle,
  onChangeAudioStyle,
  selectedNiche,
  onChangeNiche,
  minViews,
  onChangeMinViews,
  sortOrder,
  onChangeSortOrder,
  viewLayout,
  onChangeViewLayout,
  onResetFilters,
  onQuickFilterDouyinMusic,
  onOpenQueryBuilder,
  onSweepMoreLive,
  sweepingMore,
  loading,
  error,
  searchData,
  savedIds,
  selectedPostIds,
  playingPostId,
  downloadingPostId,
  downloadingAudioPostId,
  sendingCompilerPostId,
  batchBusyMode,
  autoCompileFormat,
  onChangeAutoCompileFormat,
  batchProgressText,
  downloadNotice,
  onDismissDownloadNotice,
  onTogglePlayPreview,
  onDownloadVideo,
  onDownloadAudio,
  onSendPostToCompiler,
  onToggleSelectPost,
  onSelectFirstPosts,
  onClearSelection,
  onSendSelectedToStudio,
  onAutoDownloadAndCompileSelected,
  onDownloadSelectedMp3s,
  onToggleSave,
  onInspectPost,
}: DiscoverViewProps) {
  const items = searchData?.items ?? [];
  const excludedCount = searchData?.meta.excludedCopyrightedCount ?? 0;
  const selectedCount = selectedPostIds.size;
  const isBatchBusy = batchBusyMode !== 'none';
  const isDouyinMusicActive =
    selectedPlatforms.length === 1 &&
    selectedPlatforms[0] === 'douyin' &&
    audioStyle === 'royalty_free_music';

  return (
    <div className="space-y-6">
      {/* Workspace Header & Search Form */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Zero-Account Viral Original-Audio & Studio Scout
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Search TikTok, Instagram, Douyin, and Facebook for viral original
              audio and Douyin non-copyrighted music without logging in.
              Download MP3 audio or MP4 video in-app, or select multiple tracks
              to auto-download and compile into WAV, MP3, M4A, FLAC, AIFF, or
              WMA.
            </p>
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
            {searchData
              ? `${searchData.meta.totalMatchedOriginal} original safe · ${excludedCount} copyrighted screened`
              : 'Loading index...'}
          </div>
        </div>

        <form onSubmit={onSubmitSearch} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <label htmlFor="discover-search-input" className="sr-only">
                Search keywords, niches, creators, or sound types
              </label>
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="discover-search-input"
                type="search"
                value={queryInput}
                onChange={(e) => onChangeQueryInput(e.target.value)}
                placeholder="Search original sounds or Douyin free music (e.g. guzheng, dizi, chillhop, 无版权音乐, wok)..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Search Original Audio
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={
                  isDouyinMusicActive
                    ? onResetFilters
                    : onQuickFilterDouyinMusic
                }
                aria-pressed={isDouyinMusicActive}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  isDouyinMusicActive
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-slate-50 text-slate-800 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Music className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Douyin Non-Copyrighted Music (无版权音乐)</span>
              </button>

              <button
                type="button"
                onClick={onOpenQueryBuilder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Search Operators</span>
              </button>

              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={liveSweep}
                  onChange={(e) => onToggleLiveSweep(e.target.checked)}
                  className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  Auto-sweep live unauthenticated public feeds for maximum results
                </span>
              </label>
            </div>

            {searchData?.meta.liveProbeNote && (
              <p className="text-xs text-slate-500">
                {searchData.meta.liveProbeNote}
              </p>
            )}
          </div>
        </form>
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

      {/* Main 2-Column Workspace: Sidebar Filters + Results */}
      <div className="flex flex-col lg:flex-row items-start gap-8">
        <SidebarFilters
          selectedPlatforms={selectedPlatforms}
          onTogglePlatform={onTogglePlatform}
          onSelectAllPlatforms={onSelectAllPlatforms}
          audioMode={audioMode}
          onChangeAudioMode={onChangeAudioMode}
          audioStyle={audioStyle}
          onChangeAudioStyle={onChangeAudioStyle}
          selectedNiche={selectedNiche}
          onChangeNiche={onChangeNiche}
          minViews={minViews}
          onChangeMinViews={onChangeMinViews}
          excludedCount={excludedCount}
          onResetFilters={onResetFilters}
        />

        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* Sticky Multi-Select Auto Audio Downloader & Studio Compiler Action Bar */}
          {(selectedCount > 0 || isBatchBusy) && (
            <section
              aria-label="Auto audio downloader and compiler batch bar"
              className="sticky top-3 z-30 bg-slate-900 text-slate-100 rounded-xl p-3.5 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-3"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="text-xs font-semibold text-white">
                  <span className="font-mono tabular-nums text-sky-300">
                    {selectedCount}
                  </span>{' '}
                  {selectedCount === 1 ? 'track selected' : 'tracks selected'} for
                  Auto Audio Downloader & Studio Compiler
                </div>
                <p className="text-xs text-slate-300 truncate">
                  {batchProgressText ||
                    'Auto-download audio and compile into WAV, MP3, M4A, FLAC, AIFF, or WMA, or send clips to Audio Studio.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  id="discover-compile-format-select"
                  aria-label="Auto-compile output audio format"
                  disabled={isBatchBusy || selectedCount === 0}
                  value={autoCompileFormat}
                  onChange={(e) =>
                    onChangeAutoCompileFormat(
                      e.target.value as StudioAudioFormat
                    )
                  }
                  className="px-2.5 py-2 text-xs font-semibold bg-slate-800 text-white border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
                >
                  {STUDIO_AUDIO_FORMAT_ORDER.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {STUDIO_AUDIO_FORMATS[fmt].label} (.
                      {STUDIO_AUDIO_FORMATS[fmt].extension})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={isBatchBusy || selectedCount === 0}
                  onClick={onAutoDownloadAndCompileSelected}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-500 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {batchBusyMode === 'auto_compile'
                      ? `Auto-Compiling ${STUDIO_AUDIO_FORMATS[autoCompileFormat].label}...`
                      : `Auto-Download & Compile ${STUDIO_AUDIO_FORMATS[autoCompileFormat].label} (${selectedCount})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isBatchBusy || selectedCount === 0}
                  onClick={onSendSelectedToStudio}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white rounded-lg hover:bg-slate-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                  <span>
                    {batchBusyMode === 'send_studio'
                      ? 'Sending Audio to Studio...'
                      : `Send Audio to Studio (${selectedCount})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isBatchBusy || selectedCount === 0}
                  onClick={onDownloadSelectedMp3s}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {batchBusyMode === 'batch_mp3'
                      ? 'Downloading MP3s...'
                      : 'Download Individual MP3s'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isBatchBusy}
                  onClick={onClearSelection}
                  className="px-2 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  Clear
                </button>
              </div>
            </section>
          )}
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-sm font-medium text-slate-700">
                Showing{' '}
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {items.length}
                </span>{' '}
                {items.length === 1 ? 'public video' : 'public videos'}
              </p>

              <button
                type="button"
                disabled={sweepingMore || loading}
                onClick={onSweepMoreLive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${sweepingMore ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {sweepingMore
                    ? 'Sweeping Public Feeds...'
                    : 'Sweep More Live Posts'}
                </span>
              </button>

              {items.length >= 2 && (
                <button
                  type="button"
                  disabled={isBatchBusy}
                  onClick={() => onSelectFirstPosts(items.slice(0, 3))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                  <span>Select Top 3 to Compile</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="sort-order-select"
                  className="text-xs font-medium text-slate-600 whitespace-nowrap"
                >
                  Sort by
                </label>
                <select
                  id="sort-order-select"
                  value={sortOrder}
                  onChange={(e) => onChangeSortOrder(e.target.value as SortOrder)}
                  className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  <option value="velocity">Viral Velocity (Views / Day)</option>
                  <option value="views">Total Views</option>
                  <option value="engagement">Engagement Rate (%)</option>
                  <option value="recent">Most Recent</option>
                </select>
              </div>

              {/* View mode segmented buttons */}
              <div
                role="group"
                aria-label="Result layout mode"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  aria-label="Card grid layout"
                  aria-pressed={viewLayout === 'grid'}
                  onClick={() => onChangeViewLayout('grid')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewLayout === 'grid'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Dense data table layout"
                  aria-pressed={viewLayout === 'table'}
                  onClick={() => onChangeViewLayout('table')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewLayout === 'table'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Error State */}
          {error && (
            <div
              role="alert"
              className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-900"
            >
              Unable to load discovery results: {error}
            </div>
          )}

          {/* Loading Skeleton */}
          {loading && (
            <div
              aria-busy="true"
              aria-label="Loading viral original-audio results"
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse"
                >
                  <div className="aspect-[4/3] bg-slate-200" />
                  <div className="p-4 space-y-3">
                    <div className="h-3 bg-slate-200 rounded w-2/3" />
                    <div className="h-4 bg-slate-200 rounded w-full" />
                    <div className="h-3 bg-slate-200 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && items.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <h3 className="text-base font-semibold text-slate-900">
                No original-audio videos match your current filters
              </h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                {excludedCount > 0
                  ? `${excludedCount} matching posts were screened out because they use copyrighted commercial music. Clear filters or switch to Audit Excluded Tracks to inspect them.`
                  : 'Try broadening your keyword, lowering the minimum view threshold, or enabling all 4 platforms.'}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Reset All Filters
                </button>
              </div>
            </div>
          )}

          {/* Populated Grid View */}
          {!loading && items.length > 0 && viewLayout === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {items.map((post) => {
                const isSaved = savedIds.has(post.id);
                const isSelected = selectedPostIds.has(post.id);
                const isSafe = post.classification.isOriginalSafe;
                const isPlaying = playingPostId === post.id;
                const isDownloading = downloadingPostId === post.id;
                const isDownloadingAudio = downloadingAudioPostId === post.id;
                const isSendingCompiler = sendingCompilerPostId === post.id;
                return (
                  <article
                    key={post.id}
                    className={`group bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-colors ${
                      isSelected
                        ? 'border-sky-600 ring-1 ring-sky-600'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => onInspectPost(post)}
                        aria-label={`Inspect audio verification and copyright kit for ${post.title}`}
                        className="block w-full text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-600"
                      >
                        <MediaThumbnail
                          src={post.thumbnailUrl}
                          alt={post.title}
                          platform={post.platform}
                          durationSec={post.durationSec}
                          creatorHandle={post.creatorHandle}
                          audioTitle={post.audioTitle}
                          bpm={post.bpm}
                          musicalKey={post.musicalKey}
                        />
                      </button>

                      <div className="p-4 space-y-2.5">
                        {/* Unboxed metadata row + selection checkbox */}
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-slate-800">
                              {PLATFORM_LABELS[post.platform]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{post.niche}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeAge(post.publishedAt)}</span>
                          </div>

                          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer shrink-0 select-none">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onToggleSelectPost(post)}
                              aria-label={`Select ${post.title} for audio compiler`}
                              className="rounded border-slate-300 text-sky-700 focus:ring-sky-600 cursor-pointer"
                            />
                            <span>Select</span>
                          </label>
                        </div>

                        <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
                          <button
                            type="button"
                            onClick={() => onInspectPost(post)}
                            className="text-left hover:text-sky-700 transition-colors cursor-pointer"
                          >
                            {post.title}
                          </button>
                        </h3>

                        {/* Audio Verification Line */}
                        <div className="pt-1 space-y-1 text-xs">
                          <div className="flex items-center gap-1.5">
                            {isSafe ? (
                              <ShieldCheck
                                className="w-3.5 h-3.5 text-teal-700 shrink-0"
                                aria-hidden="true"
                              />
                            ) : (
                              <ShieldAlert
                                className="w-3.5 h-3.5 text-rose-700 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={`${getAudioStatusTextClass(
                                post.classification.status
                              )} shrink-0 whitespace-nowrap`}
                            >
                              {post.classification.summaryLabel}
                            </span>
                            <span className="text-slate-400" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-slate-600 truncate">
                              {AUDIO_STYLE_LABELS[post.classification.audioStyle]}
                            </span>
                          </div>
                          <p
                            className="text-slate-500 truncate font-mono text-[11px]"
                            title={post.audioTitle}
                          >
                            Track: {post.audioTitle}
                          </p>
                          {(post.bpm || post.musicalKey) && (
                            <p className="text-slate-600 font-mono tabular-nums text-[11px]">
                              {[
                                post.bpm ? `${post.bpm} BPM` : null,
                                post.musicalKey,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metrics & In-App Studio Actions Footer */}
                    <div className="px-4 py-3 border-t border-slate-100 space-y-2.5 bg-slate-50/60">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-700 min-w-0">
                          <span title="Total public views" className="whitespace-nowrap">
                            {formatCompactNumber(post.views)} views
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className="text-slate-900 font-semibold whitespace-nowrap"
                            title="Viral velocity per day"
                          >
                            {formatCompactNumber(post.viewsPerDay)}/day
                          </span>
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span title="Engagement rate" className="whitespace-nowrap">
                            {post.engagementRatePct}% ER
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSafe && (
                            <button
                              type="button"
                              onClick={() => onTogglePlayPreview(post)}
                              aria-label={
                                isPlaying
                                  ? `Stop audio preview for ${post.title}`
                                  : `Play audio preview for ${post.title}`
                              }
                              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                                isPlaying
                                  ? 'text-sky-700 bg-sky-50'
                                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                              }`}
                            >
                              {isPlaying ? (
                                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onToggleSave(post)}
                            aria-label={
                              isSaved
                                ? `Remove ${post.title} from shortlist`
                                : `Save ${post.title} to shortlist`
                            }
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              isSaved
                                ? 'text-sky-700 bg-sky-50'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                            }`}
                          >
                            {isSaved ? (
                              <BookmarkCheck
                                className="w-4 h-4"
                                aria-hidden="true"
                              />
                            ) : (
                              <Bookmark className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-1.5 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isDownloadingAudio}
                            onClick={() => onDownloadAudio(post)}
                            aria-label={`Download MP3 audio for ${post.title}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-sky-700 rounded-md hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <FileAudio className="w-3 h-3" aria-hidden="true" />
                            <span>
                              {isDownloadingAudio ? 'MP3...' : 'MP3'}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={isSendingCompiler}
                            onClick={() => onSendPostToCompiler(post)}
                            aria-label={`Download audio and send ${post.title} to compiler`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-300 rounded-md hover:bg-sky-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
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
                            aria-label={`Download video for ${post.title} without going to external website`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Download className="w-3 h-3" aria-hidden="true" />
                            <span>
                              {isDownloading ? 'Saving...' : 'Video'}
                            </span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => onInspectPost(post)}
                          className="text-xs font-medium text-sky-700 hover:text-sky-900 cursor-pointer whitespace-nowrap"
                        >
                          Studio Kit
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Populated High-Density Table View */}
          {!loading && items.length > 0 && viewLayout === 'table' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50">
                    <th className="py-3 pl-4 pr-2 w-9">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="py-3 px-3">Post & Creator</th>
                    <th className="py-3 px-3">Platform</th>
                    <th className="py-3 px-3">Audio Verification</th>
                    <th className="py-3 px-3 text-right">Views</th>
                    <th className="py-3 px-3 text-right">Views / Day</th>
                    <th className="py-3 px-4 text-right">In-App Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {items.map((post) => {
                    const isSaved = savedIds.has(post.id);
                    const isSelected = selectedPostIds.has(post.id);
                    const isDownloading = downloadingPostId === post.id;
                    const isDownloadingAudio =
                      downloadingAudioPostId === post.id;
                    const isSendingCompiler = sendingCompilerPostId === post.id;
                    return (
                      <tr
                        key={post.id}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-sky-50/50'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleSelectPost(post)}
                            aria-label={`Select ${post.title} for audio compiler`}
                            className="rounded border-slate-300 text-sky-700 focus:ring-sky-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 max-w-xs">
                          <button
                            type="button"
                            onClick={() => onInspectPost(post)}
                            className="font-semibold text-slate-900 hover:text-sky-700 text-left line-clamp-1 cursor-pointer"
                          >
                            {post.title}
                          </button>
                          <div className="text-slate-500 mt-0.5 truncate">
                            @{post.creatorHandle} ·{' '}
                            {formatDuration(post.durationSec)} · {post.audioTitle}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                          {PLATFORM_LABELS[post.platform]}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={getAudioStatusTextClass(
                              post.classification.status
                            )}
                          >
                            {post.classification.summaryLabel}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatCompactNumber(post.views)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatCompactNumber(post.viewsPerDay)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={isDownloadingAudio}
                              onClick={() => onDownloadAudio(post)}
                              className="text-sky-700 hover:text-sky-900 font-semibold cursor-pointer"
                            >
                              {isDownloadingAudio ? 'MP3...' : 'MP3'}
                            </button>
                            <button
                              type="button"
                              disabled={isSendingCompiler}
                              onClick={() => onSendPostToCompiler(post)}
                              className="text-teal-700 hover:text-teal-900 font-semibold cursor-pointer"
                            >
                              {isSendingCompiler ? 'Sending...' : '+ Compile'}
                            </button>
                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => onDownloadVideo(post)}
                              className="text-slate-800 hover:text-slate-950 font-medium cursor-pointer"
                            >
                              {isDownloading ? 'Saving...' : 'Video'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleSave(post)}
                              className="text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
                            >
                              {isSaved ? 'Saved' : 'Save'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Bottom Sweep More Action */}
          {!loading && items.length > 0 && (
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-5 py-4">
              <p className="text-xs text-slate-600">
                Displaying all{' '}
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {items.length}
                </span>{' '}
                discovered videos matching your filters. Select multiple cards
                above to batch-download and compile MP3 audio into one file.
              </p>
              <button
                type="button"
                disabled={sweepingMore}
                onClick={onSweepMoreLive}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${sweepingMore ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {sweepingMore
                    ? 'Sweeping Public Feeds...'
                    : 'Discover More Live Posts'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
