import { useEffect, useState } from 'react';
import { Download, Image as ImageIcon, RefreshCw } from 'lucide-react';
import {
  COVER_ART_DIMENSION_PX,
  COVER_ART_STYLES,
  formatCoverDisplayTitle,
  generateSquareCoverJpg,
  pickNextCoverStyle,
  type CoverArtStyleId,
  type GeneratedCoverArtResult,
} from '../lib/coverArtGenerator';

interface CoverArtPanelProps {
  songSlug: string;
  waveformPeaks: number[];
}

function formatImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CoverArtPanel({ songSlug, waveformPeaks }: CoverArtPanelProps) {
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState('Original Studio Session');
  const [styleId, setStyleId] = useState<CoverArtStyleId>('obsidian_vinyl');
  const [seedSalt, setSeedSalt] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cover, setCover] = useState<GeneratedCoverArtResult | null>(null);

  const effectiveTitle =
    customTitle !== null ? customTitle : formatCoverDisplayTitle(songSlug);

  useEffect(() => {
    return () => {
      if (cover?.objectUrl) {
        URL.revokeObjectURL(cover.objectUrl);
      }
    };
  }, [cover]);

  const handleGenerateCover = async (overrideStyle?: CoverArtStyleId) => {
    setGenerating(true);
    setError(null);
    const chosenStyle = overrideStyle ?? styleId;
    const nextSalt = seedSalt + 1;
    setSeedSalt(nextSalt);

    try {
      const result = await generateSquareCoverJpg({
        titleInput: effectiveTitle || songSlug || 'Studio Master',
        subtitleInput: subtitle,
        styleId: chosenStyle,
        waveformPeaks,
        seedSalt: nextSalt,
      });
      setCover(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to render 3,000 × 3,000 JPG cover image.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadCover = () => {
    if (!cover) return;
    const a = document.createElement('a');
    a.href = cover.objectUrl;
    a.download = cover.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      data-testid="cover-art-studio-panel"
      className="border border-slate-200 rounded-xl p-5 bg-slate-50/60 space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-sky-700" aria-hidden="true" />
            <span>Distribution Cover Art Generator (3,000 × 3,000 JPG)</span>
          </h3>
          <p className="text-xs text-slate-600">
            Renders distribution-ready square 3,000 × 3,000 px JPEG cover artwork
            locally with waveform geometry from your compiled tracks — no AI image
            credits used.
          </p>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
          {COVER_ART_DIMENSION_PX} × {COVER_ART_DIMENSION_PX} px · Square JPG
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="cover-art-title-input"
                className="block text-xs font-medium text-slate-700"
              >
                Cover Title
              </label>
              <input
                id="cover-art-title-input"
                type="text"
                value={effectiveTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Song title on artwork"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="cover-art-subtitle-input"
                className="block text-xs font-medium text-slate-700"
              >
                Artist / Studio Credit
              </label>
              <input
                id="cover-art-subtitle-input"
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Optional credit line"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="cover-art-style-select"
                className="block text-xs font-medium text-slate-700"
              >
                Artwork Palette
              </label>
              <select
                id="cover-art-style-select"
                value={styleId}
                onChange={(e) => setStyleId(e.target.value as CoverArtStyleId)}
                className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                {COVER_ART_STYLES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={generating}
              onClick={() => void handleGenerateCover()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {generating
                  ? 'Rendering 3,000×3,000 JPG...'
                  : cover
                  ? 'Regenerate 3,000×3,000 Cover JPG'
                  : 'Generate 3,000×3,000 Cover JPG'}
              </span>
            </button>

            <button
              type="button"
              disabled={generating}
              onClick={() => {
                const next = pickNextCoverStyle(styleId);
                setStyleId(next.id);
                void handleGenerateCover(next.id);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
              <span>Next Style &amp; Render</span>
            </button>

            {customTitle !== null && (
              <button
                type="button"
                onClick={() => setCustomTitle(null)}
                className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
              >
                Sync Title from Song Name
              </button>
            )}

            {cover && (
              <button
                type="button"
                onClick={handleDownloadCover}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download Cover JPG</span>
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-900"
            >
              {error}
            </div>
          )}

          {cover && (
            <div
              data-testid="cover-art-metadata"
              className="text-xs font-mono tabular-nums text-slate-600 pt-1"
            >
              Ready: <span className="font-semibold text-slate-900">{cover.fileName}</span> ·{' '}
              {cover.width} × {cover.height} px · {formatImageBytes(cover.sizeBytes)} ·{' '}
              {cover.styleLabel}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 flex justify-start lg:justify-end">
          {cover ? (
            <div className="w-44 h-44 rounded-lg overflow-hidden border border-slate-300 bg-slate-900 shrink-0">
              <img
                src={cover.objectUrl}
                alt={`Generated ${cover.width}x${cover.height} square JPG cover art for ${cover.displayTitle}`}
                className="w-full h-full object-cover block"
              />
            </div>
          ) : (
            <div className="w-44 h-44 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center p-4 text-center gap-2 shrink-0">
              <ImageIcon className="w-6 h-6 text-slate-400" aria-hidden="true" />
              <span className="text-xs text-slate-500 leading-snug">
                3,000 × 3,000 px JPG cover preview
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
