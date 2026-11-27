import { RotateCcw } from 'lucide-react';
import { NICHE_CATEGORIES } from '../lib/seedCatalog';
import { PLATFORM_LABELS } from '../lib/formatters';
import type { AudioFilterMode, SocialPlatform } from '../types/media';

interface SidebarFiltersProps {
  selectedPlatforms: SocialPlatform[];
  onTogglePlatform: (platform: SocialPlatform) => void;
  onSelectAllPlatforms: () => void;
  audioMode: AudioFilterMode;
  onChangeAudioMode: (mode: AudioFilterMode) => void;
  audioStyle: string;
  onChangeAudioStyle: (style: string) => void;
  selectedNiche: string;
  onChangeNiche: (niche: string) => void;
  minViews: number;
  onChangeMinViews: (views: number) => void;
  excludedCount: number;
  onResetFilters: () => void;
}

const ALL_PLATFORMS: SocialPlatform[] = [
  'tiktok',
  'instagram',
  'douyin',
  'facebook',
];

const MIN_VIEW_OPTIONS = [
  { label: 'Any Views', value: 0 },
  { label: '1M+ Views', value: 1_000_000 },
  { label: '2.5M+ Views', value: 2_500_000 },
  { label: '4M+ Views', value: 4_000_000 },
];

const AUDIO_STYLE_OPTIONS = [
  { label: 'All Original Styles', value: 'all' },
  { label: 'Royalty-Free Original Music', value: 'royalty_free_music' },
  { label: 'Raw Room / ASMR', value: 'ambient_raw' },
  { label: 'Creator Voiceover', value: 'voiceover' },
  { label: 'Street Mic / Vox-Pop', value: 'street_interview' },
  { label: 'Live Acoustic Take', value: 'live_acoustic' },
];

export function SidebarFilters({
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
  excludedCount,
  onResetFilters,
}: SidebarFiltersProps) {
  const allSelected = selectedPlatforms.length === ALL_PLATFORMS.length;

  return (
    <aside
      aria-label="Discovery filters"
      className="w-full lg:w-64 shrink-0 space-y-6"
    >
      {/* Audio Rights Filter */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-900">
            Audio Rights Screening
          </h2>
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>

        <div className="flex flex-col gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeAudioMode('original_only')}
            className={`w-full text-left px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap truncate ${
              audioMode === 'original_only'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Original Audio Only
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioMode('creator_owned_only')}
            className={`w-full text-left px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap truncate ${
              audioMode === 'creator_owned_only'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            First-Party Creator Mic
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioMode('all_with_excluded')}
            className={`w-full text-left px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap truncate ${
              audioMode === 'all_with_excluded'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Excluded Tracks ({excludedCount})
          </button>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {excludedCount} commercial or record-label tracks automatically
          screened out from current match set.
        </p>
      </section>

      <hr className="border-slate-200" />

      {/* Platforms */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-900">Platforms</h2>
          {!allSelected && (
            <button
              type="button"
              onClick={onSelectAllPlatforms}
              className="text-xs text-sky-700 hover:text-sky-900 font-medium cursor-pointer whitespace-nowrap"
            >
              Select all
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {ALL_PLATFORMS.map((platform) => {
            const active = selectedPlatforms.includes(platform);
            return (
              <button
                key={platform}
                type="button"
                aria-pressed={active}
                onClick={() => onTogglePlatform(platform)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
      </section>

      <hr className="border-slate-200" />

      {/* Original Sound Format */}
      <section className="space-y-2">
        <label
          htmlFor="audio-style-select"
          className="block text-xs font-semibold text-slate-900"
        >
          Sound Recording Type
        </label>
        <select
          id="audio-style-select"
          value={audioStyle}
          onChange={(e) => onChangeAudioStyle(e.target.value)}
          className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
        >
          {AUDIO_STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </section>

      {/* Niche Category */}
      <section className="space-y-2">
        <label
          htmlFor="niche-select"
          className="block text-xs font-semibold text-slate-900"
        >
          Content Niche
        </label>
        <select
          id="niche-select"
          value={selectedNiche}
          onChange={(e) => onChangeNiche(e.target.value)}
          className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
        >
          {NICHE_CATEGORIES.map((niche) => (
            <option key={niche} value={niche}>
              {niche}
            </option>
          ))}
        </select>
      </section>

      {/* Minimum Virality Threshold */}
      <section className="space-y-2">
        <span className="block text-xs font-semibold text-slate-900">
          Minimum Reach
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {MIN_VIEW_OPTIONS.map((opt) => {
            const active = minViews === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeMinViews(opt.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-50 text-sky-900 border-sky-300 font-semibold'
                    : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
