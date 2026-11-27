import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopNav, type WorkspaceTab } from './components/TopNav';
import { DiscoverView } from './components/DiscoverView';
import { UrlInspectorView } from './components/UrlInspectorView';
import { CopyrightCheckerView } from './components/CopyrightCheckerView';
import { AudioStudioView } from './components/AudioStudioView';
import { QueryBuilderView } from './components/QueryBuilderView';
import { SavedLeadsView } from './components/SavedLeadsView';
import { PostDetailDrawer } from './components/PostDetailDrawer';
import { RunLocallyModal } from './components/RunLocallyModal';
import {
  compileClipsToMaster,
  createWavObjectUrl,
  downloadPostAudioDirect,
  downloadPostVideoDirect,
  downloadStudioCopyrightSheet,
  downloadStudioWavMaster,
  fetchPostAudioMp3,
  inferPresetForPost,
  triggerAudioBytesDownload,
} from './lib/studioMediaExporter';
import {
  STUDIO_AUDIO_FORMATS,
  type StudioAudioFormat,
} from './lib/audioFormats';
import type {
  AudioFilterMode,
  IncomingCompiledMaster,
  IncomingStudioAudioClip,
  SavedLead,
  SearchResponse,
  SocialPlatform,
  SortOrder,
  ViralPost,
} from './types/media';

const DEFAULT_PLATFORMS: SocialPlatform[] = [
  'tiktok',
  'instagram',
  'douyin',
  'facebook',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('discover');
  const [queryInput, setQueryInput] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [liveSweep, setLiveSweep] = useState(true);
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<SocialPlatform[]>(DEFAULT_PLATFORMS);
  const [audioMode, setAudioMode] = useState<AudioFilterMode>('original_only');
  const [audioStyle, setAudioStyle] = useState<string>('all');
  const [selectedNiche, setSelectedNiche] = useState<string>('All Niches');
  const [minViews, setMinViews] = useState<number>(0);
  const [sortOrder, setSortOrder] = useState<SortOrder>('velocity');
  const [viewLayout, setViewLayout] = useState<'grid' | 'table'>('grid');

  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sweepingMore, setSweepingMore] = useState<boolean>(false);
  const [sweepBatch, setSweepBatch] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [inspectedPost, setInspectedPost] = useState<ViralPost | null>(null);
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [localModalOpen, setLocalModalOpen] = useState<boolean>(false);

  // Incoming media handoff state for Audio Studio
  const [studioIncomingVideo, setStudioIncomingVideo] = useState<File | null>(
    null
  );
  const [studioIncomingClips, setStudioIncomingClips] = useState<
    IncomingStudioAudioClip[]
  >([]);
  const [studioIncomingMaster, setStudioIncomingMaster] =
    useState<IncomingCompiledMaster | null>(null);

  // Multi-select posts for Auto Audio Downloader & Studio Compiler
  const [selectedPostMap, setSelectedPostMap] = useState<
    Map<string, ViralPost>
  >(() => new Map());
  const [batchBusyMode, setBatchBusyMode] = useState<
    'none' | 'send_studio' | 'auto_compile' | 'batch_mp3'
  >('none');
  const [autoCompileFormat, setAutoCompileFormat] =
    useState<StudioAudioFormat>('mp3');
  const [batchProgressText, setBatchProgressText] = useState<string | null>(
    null
  );

  const [playingPostId, setPlayingPostId] = useState<string | null>(null);
  const [downloadingPostId, setDownloadingPostId] = useState<string | null>(
    null
  );
  const [downloadingAudioPostId, setDownloadingAudioPostId] = useState<
    string | null
  >(null);
  const [sendingCompilerPostId, setSendingCompilerPostId] = useState<
    string | null
  >(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);

  const stopAudioPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
    setPlayingPostId(null);
  }, []);

  useEffect(() => {
    return () => {
      stopAudioPreview();
    };
  }, [stopAudioPreview]);

  const handleTogglePlayPreview = useCallback(
    (post: ViralPost) => {
      if (playingPostId === post.id) {
        stopAudioPreview();
        return;
      }

      stopAudioPreview();
      const preset = inferPresetForPost(post);
      const wavUrl = createWavObjectUrl(preset, 10);
      activeAudioUrlRef.current = wavUrl;
      const audio = new Audio(wavUrl);
      audioRef.current = audio;
      audio.onended = () => {
        stopAudioPreview();
      };
      setPlayingPostId(post.id);
      void audio.play().catch(() => {
        setDownloadNotice(
          `Prepared non-copyrighted preview stem for "${post.title}".`
        );
      });
    },
    [playingPostId, stopAudioPreview]
  );

  const handleDownloadVideo = useCallback(async (post: ViralPost) => {
    setDownloadingPostId(post.id);
    try {
      const res = await downloadPostVideoDirect(post, (statusMsg) => {
        setDownloadNotice(statusMsg);
      });
      setDownloadNotice(res.message);
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `Video download failed: ${err.message}`
          : 'Unable to complete direct video download.'
      );
    } finally {
      setDownloadingPostId(null);
    }
  }, []);

  const handleDownloadAudio = useCallback(async (post: ViralPost) => {
    setDownloadingAudioPostId(post.id);
    try {
      const res = await downloadPostAudioDirect(post, (statusMsg) => {
        setDownloadNotice(statusMsg);
      });
      setDownloadNotice(res.message);
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `MP3 audio download failed: ${err.message}`
          : 'Unable to extract MP3 audio.'
      );
    } finally {
      setDownloadingAudioPostId(null);
    }
  }, []);

  const handleSendPostToCompiler = useCallback(async (post: ViralPost) => {
    setSendingCompilerPostId(post.id);
    try {
      const clip = await fetchPostAudioMp3(post, (statusMsg) => {
        setDownloadNotice(statusMsg);
      });
      setStudioIncomingMaster(null);
      setStudioIncomingClips([clip]);
      setActiveTab('studio');
      setDownloadNotice(
        `Extracted "${clip.name}" and added it to your Audio Studio compiler timeline.`
      );
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `Unable to send audio to compiler: ${err.message}`
          : 'Unable to send audio to compiler.'
      );
    } finally {
      setSendingCompilerPostId(null);
    }
  }, []);

  const handleToggleSelectPost = useCallback((post: ViralPost) => {
    setSelectedPostMap((prev) => {
      const next = new Map(prev);
      if (next.has(post.id)) {
        next.delete(post.id);
      } else if (next.size < 12) {
        next.set(post.id, post);
      } else {
        setDownloadNotice('Up to 12 tracks can be batch-compiled at once.');
      }
      return next;
    });
  }, []);

  const handleSelectFirstPosts = useCallback((posts: ViralPost[]) => {
    setSelectedPostMap((prev) => {
      const next = new Map(prev);
      for (const p of posts) {
        if (next.size >= 12) break;
        next.set(p.id, p);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedPostMap(new Map());
    setBatchProgressText(null);
  }, []);

  const handleSendSelectedToStudio = useCallback(async () => {
    const selectedPosts = Array.from(selectedPostMap.values());
    if (selectedPosts.length === 0) return;

    setBatchBusyMode('send_studio');
    try {
      const extracted: IncomingStudioAudioClip[] = [];
      for (let i = 0; i < selectedPosts.length; i++) {
        const post = selectedPosts[i];
        setBatchProgressText(
          `Extracting MP3 ${i + 1} of ${selectedPosts.length}: @${post.creatorHandle}...`
        );
        const clip = await fetchPostAudioMp3(post);
        extracted.push(clip);
      }

      setStudioIncomingMaster(null);
      setStudioIncomingClips(extracted);
      setSelectedPostMap(new Map());
      setBatchProgressText(null);
      setActiveTab('studio');
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `Batch audio extraction failed: ${err.message}`
          : 'Unable to extract selected audio tracks.'
      );
    } finally {
      setBatchBusyMode('none');
    }
  }, [selectedPostMap]);

  const handleAutoDownloadAndCompileSelected = useCallback(async () => {
    const selectedPosts = Array.from(selectedPostMap.values());
    if (selectedPosts.length === 0) return;

    const spec = STUDIO_AUDIO_FORMATS[autoCompileFormat];
    setBatchBusyMode('auto_compile');
    try {
      const extracted: IncomingStudioAudioClip[] = [];
      for (let i = 0; i < selectedPosts.length; i++) {
        const post = selectedPosts[i];
        setBatchProgressText(
          `Auto-downloading audio ${i + 1} of ${selectedPosts.length}: @${post.creatorHandle}...`
        );
        const clip = await fetchPostAudioMp3(post);
        extracted.push(clip);
      }

      setBatchProgressText(
        `Compiling ${extracted.length} tracks into 1 ${spec.label} master...`
      );
      const compiled = await compileClipsToMaster(
        extracted,
        `origisound-compiled-${extracted.length}-tracks`,
        'seamless',
        autoCompileFormat,
        '192k'
      );
      triggerAudioBytesDownload(
        compiled.bytes,
        compiled.name,
        compiled.format || autoCompileFormat
      );

      setStudioIncomingClips(extracted);
      setStudioIncomingMaster(compiled);
      setSelectedPostMap(new Map());
      setBatchProgressText(null);
      setActiveTab('studio');
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `Auto-compiler failed: ${err.message}`
          : 'Unable to auto-download and compile selected tracks.'
      );
    } finally {
      setBatchBusyMode('none');
    }
  }, [autoCompileFormat, selectedPostMap]);

  const handleDownloadSelectedMp3s = useCallback(async () => {
    const selectedPosts = Array.from(selectedPostMap.values());
    if (selectedPosts.length === 0) return;

    setBatchBusyMode('batch_mp3');
    try {
      for (let i = 0; i < selectedPosts.length; i++) {
        const post = selectedPosts[i];
        setBatchProgressText(
          `Downloading MP3 ${i + 1} of ${selectedPosts.length}: @${post.creatorHandle}...`
        );
        await downloadPostAudioDirect(post);
      }
      setDownloadNotice(
        `Downloaded ${selectedPosts.length} individual MP3 audio files directly in app.`
      );
      setSelectedPostMap(new Map());
      setBatchProgressText(null);
    } catch (err) {
      setDownloadNotice(
        err instanceof Error
          ? `Batch MP3 download failed: ${err.message}`
          : 'Unable to complete batch MP3 download.'
      );
    } finally {
      setBatchBusyMode('none');
    }
  }, [selectedPostMap]);

  const handleDownloadWav = useCallback((post: ViralPost) => {
    downloadStudioWavMaster(post);
    setDownloadNotice(
      `Downloaded 16-bit WAV studio master for @${post.creatorHandle} directly in app.`
    );
  }, []);

  const handleDownloadCopyrightSheet = useCallback((post: ViralPost) => {
    downloadStudioCopyrightSheet(post);
    setDownloadNotice(
      `Downloaded Recording Studio Copyright & Split-Sheet Intake (.txt) for @${post.creatorHandle}.`
    );
  }, []);

  const savedIds = useMemo(
    () => new Set(savedLeads.map((item) => item.post.id)),
    [savedLeads]
  );

  const selectedPostIds = useMemo(
    () => new Set(selectedPostMap.keys()),
    [selectedPostMap]
  );

  const handleConsumeIncomingAudio = useCallback(() => {
    setStudioIncomingClips([]);
    setStudioIncomingMaster(null);
  }, []);

  const fetchDiscovery = useCallback(async () => {
    if (sweepBatch > 0) {
      setSweepingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        q: committedQuery,
        platforms: selectedPlatforms.join(','),
        niche: selectedNiche,
        audioMode,
        audioStyle,
        minViews: String(minViews),
        sort: sortOrder,
        live: liveSweep ? 'true' : 'false',
        batch: String(sweepBatch),
      });

      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as SearchResponse;
      setSearchData(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to fetch search index'
      );
    } finally {
      setLoading(false);
      setSweepingMore(false);
    }
  }, [
    committedQuery,
    selectedPlatforms,
    selectedNiche,
    audioMode,
    audioStyle,
    minViews,
    sortOrder,
    liveSweep,
    sweepBatch,
  ]);

  useEffect(() => {
    void fetchDiscovery();
  }, [fetchDiscovery]);

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSweepBatch(0);
    setCommittedQuery(queryInput);
  };

  const handleTogglePlatform = (platform: SocialPlatform) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platform)) {
        return prev.length > 1 ? prev.filter((p) => p !== platform) : prev;
      }
      return [...prev, platform];
    });
  };

  const handleResetFilters = () => {
    setQueryInput('');
    setCommittedQuery('');
    setSweepBatch(0);
    setSelectedPlatforms(DEFAULT_PLATFORMS);
    setAudioMode('original_only');
    setAudioStyle('all');
    setSelectedNiche('All Niches');
    setMinViews(0);
    setSortOrder('velocity');
  };

  const handleQuickFilterDouyinMusic = () => {
    setQueryInput('');
    setCommittedQuery('');
    setSweepBatch(0);
    setSelectedPlatforms(['douyin']);
    setAudioMode('original_only');
    setAudioStyle('royalty_free_music');
    setSelectedNiche('All Niches');
    setMinViews(0);
  };

  const handleToggleSave = (post: ViralPost) => {
    setSavedLeads((prev) => {
      const exists = prev.some((item) => item.post.id === post.id);
      if (exists) {
        return prev.filter((item) => item.post.id !== post.id);
      }
      return [
        {
          post,
          savedAt: new Date().toISOString().slice(0, 10),
          notes: '',
        },
        ...prev,
      ];
    });
  };

  const handleUpdateNotes = (postId: string, notes: string) => {
    setSavedLeads((prev) =>
      prev.map((item) =>
        item.post.id === postId ? { ...item, notes } : item
      )
    );
  };

  const handleRemoveLead = (postId: string) => {
    setSavedLeads((prev) => prev.filter((item) => item.post.id !== postId));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        savedCount={savedLeads.length}
        onOpenLocalModal={() => setLocalModalOpen(true)}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8">
        {activeTab === 'discover' && (
          <DiscoverView
            queryInput={queryInput}
            onChangeQueryInput={(val) => {
              setQueryInput(val);
              if (val === '') {
                setCommittedQuery('');
              }
            }}
            onSubmitSearch={handleSubmitSearch}
            liveSweep={liveSweep}
            onToggleLiveSweep={setLiveSweep}
            selectedPlatforms={selectedPlatforms}
            onTogglePlatform={handleTogglePlatform}
            onSelectAllPlatforms={() => setSelectedPlatforms(DEFAULT_PLATFORMS)}
            audioMode={audioMode}
            onChangeAudioMode={setAudioMode}
            audioStyle={audioStyle}
            onChangeAudioStyle={setAudioStyle}
            selectedNiche={selectedNiche}
            onChangeNiche={setSelectedNiche}
            minViews={minViews}
            onChangeMinViews={setMinViews}
            sortOrder={sortOrder}
            onChangeSortOrder={setSortOrder}
            viewLayout={viewLayout}
            onChangeViewLayout={setViewLayout}
            onResetFilters={handleResetFilters}
            onQuickFilterDouyinMusic={handleQuickFilterDouyinMusic}
            onOpenQueryBuilder={() => setActiveTab('queries')}
            onSweepMoreLive={() => {
              setLiveSweep(true);
              setSweepBatch((prev) => prev + 1);
            }}
            sweepingMore={sweepingMore}
            loading={loading}
            error={error}
            searchData={searchData}
            savedIds={savedIds}
            selectedPostIds={selectedPostIds}
            playingPostId={playingPostId}
            downloadingPostId={downloadingPostId}
            downloadingAudioPostId={downloadingAudioPostId}
            sendingCompilerPostId={sendingCompilerPostId}
            batchBusyMode={batchBusyMode}
            autoCompileFormat={autoCompileFormat}
            onChangeAutoCompileFormat={setAutoCompileFormat}
            batchProgressText={batchProgressText}
            downloadNotice={downloadNotice}
            onDismissDownloadNotice={() => setDownloadNotice(null)}
            onTogglePlayPreview={handleTogglePlayPreview}
            onDownloadVideo={handleDownloadVideo}
            onDownloadAudio={handleDownloadAudio}
            onSendPostToCompiler={handleSendPostToCompiler}
            onToggleSelectPost={handleToggleSelectPost}
            onSelectFirstPosts={handleSelectFirstPosts}
            onClearSelection={handleClearSelection}
            onSendSelectedToStudio={handleSendSelectedToStudio}
            onAutoDownloadAndCompileSelected={
              handleAutoDownloadAndCompileSelected
            }
            onDownloadSelectedMp3s={handleDownloadSelectedMp3s}
            onToggleSave={handleToggleSave}
            onInspectPost={setInspectedPost}
          />
        )}

        {activeTab === 'inspector' && (
          <UrlInspectorView
            savedIds={savedIds}
            playingPostId={playingPostId}
            downloadingPostId={downloadingPostId}
            downloadingAudioPostId={downloadingAudioPostId}
            sendingCompilerPostId={sendingCompilerPostId}
            downloadNotice={downloadNotice}
            onDismissDownloadNotice={() => setDownloadNotice(null)}
            onTogglePlayPreview={handleTogglePlayPreview}
            onDownloadVideo={handleDownloadVideo}
            onDownloadAudio={handleDownloadAudio}
            onSendPostToCompiler={handleSendPostToCompiler}
            onDownloadWav={handleDownloadWav}
            onDownloadCopyrightSheet={handleDownloadCopyrightSheet}
            onToggleSave={handleToggleSave}
          />
        )}

        {activeTab === 'copyright' && (
          <CopyrightCheckerView
            onSendVideoToStudio={(file) => {
              setStudioIncomingVideo(file);
              setActiveTab('studio');
            }}
          />
        )}

        {activeTab === 'studio' && (
          <AudioStudioView
            incomingVideoFile={studioIncomingVideo}
            onConsumeIncomingVideo={() => setStudioIncomingVideo(null)}
            incomingAudioClips={studioIncomingClips}
            incomingCompiledMaster={studioIncomingMaster}
            onConsumeIncomingAudio={handleConsumeIncomingAudio}
          />
        )}

        {activeTab === 'queries' && <QueryBuilderView />}

        {activeTab === 'saved' && (
          <SavedLeadsView
            leads={savedLeads}
            downloadingPostId={downloadingPostId}
            downloadingAudioPostId={downloadingAudioPostId}
            sendingCompilerPostId={sendingCompilerPostId}
            onDownloadVideo={handleDownloadVideo}
            onDownloadAudio={handleDownloadAudio}
            onSendPostToCompiler={handleSendPostToCompiler}
            onDownloadCopyrightSheet={handleDownloadCopyrightSheet}
            onUpdateNotes={handleUpdateNotes}
            onRemoveLead={handleRemoveLead}
            onInspectPost={setInspectedPost}
            onNavigateDiscover={() => setActiveTab('discover')}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            OrigiSound — Zero-login original-audio discovery, Douyin
            non-copyrighted music & studio audio/video compiler.
          </span>
          <span>
            Direct in-app MP3 & MP4 downloads · Screens public metadata only ·
            No social logins
          </span>
        </div>
      </footer>

      <PostDetailDrawer
        post={inspectedPost}
        isSaved={inspectedPost ? savedIds.has(inspectedPost.id) : false}
        isPlaying={inspectedPost ? playingPostId === inspectedPost.id : false}
        isDownloading={
          inspectedPost ? downloadingPostId === inspectedPost.id : false
        }
        isDownloadingAudio={
          inspectedPost ? downloadingAudioPostId === inspectedPost.id : false
        }
        isSendingCompiler={
          inspectedPost ? sendingCompilerPostId === inspectedPost.id : false
        }
        onClose={() => setInspectedPost(null)}
        onToggleSave={handleToggleSave}
        onTogglePlayPreview={handleTogglePlayPreview}
        onDownloadVideo={handleDownloadVideo}
        onDownloadAudio={handleDownloadAudio}
        onSendPostToCompiler={handleSendPostToCompiler}
        onDownloadWav={handleDownloadWav}
        onDownloadCopyrightSheet={handleDownloadCopyrightSheet}
      />

      <RunLocallyModal
        open={localModalOpen}
        onClose={() => setLocalModalOpen(false)}
      />
    </div>
  );
}
