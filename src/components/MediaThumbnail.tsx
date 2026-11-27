import { useEffect, useMemo, useState } from 'react';
import { formatDuration, PLATFORM_LABELS } from '../lib/formatters';
import { isAllowedMediaCdnUrl } from '../lib/urlSafety';
import type { SocialPlatform } from '../types/media';

interface MediaThumbnailProps {
  src?: string;
  alt: string;
  platform: SocialPlatform;
  durationSec: number;
  creatorHandle: string;
  audioTitle?: string;
  bpm?: number;
  musicalKey?: string;
  className?: string;
}

function buildDeterministicWaveformBars(seedText: string, count = 30): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bars: number[] = [];
  let state = hash >>> 0 || 1337;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const rand = (state & 0xffff) / 0xffff;
    const envelope = Math.sin(((i + 1) / (count + 1)) * Math.PI);
    const height = Math.round(10 + (0.28 + 0.72 * envelope) * rand * 40);
    bars.push(Math.max(8, Math.min(50, height)));
  }
  return bars;
}

export function MediaThumbnail({
  src,
  alt,
  platform,
  durationSec,
  creatorHandle,
  audioTitle,
  bpm,
  musicalKey,
  className = 'aspect-[4/3]',
}: MediaThumbnailProps) {
  // Never display local AI-generated stock photos (/src/assets/images/...)
  const sanitizedSrc =
    src && !src.startsWith('/src/assets/images/') ? src : undefined;

  const [loadPhase, setLoadPhase] = useState<'direct' | 'proxy' | 'slate'>(
    sanitizedSrc ? 'direct' : 'slate'
  );

  useEffect(() => {
    setLoadPhase(sanitizedSrc ? 'direct' : 'slate');
  }, [sanitizedSrc]);

  const activeImgSrc = useMemo(() => {
    if (!sanitizedSrc || loadPhase === 'slate') return undefined;
    if (loadPhase === 'direct') return sanitizedSrc;
    if (loadPhase === 'proxy' && isAllowedMediaCdnUrl(sanitizedSrc)) {
      return `/api/proxy-thumbnail?url=${encodeURIComponent(sanitizedSrc)}`;
    }
    return undefined;
  }, [sanitizedSrc, loadPhase]);

  const bars = useMemo(
    () =>
      buildDeterministicWaveformBars(
        `${platform}:${creatorHandle}:${audioTitle || alt}`,
        30
      ),
    [platform, creatorHandle, audioTitle, alt]
  );

  const handleImageError = () => {
    if (
      loadPhase === 'direct' &&
      sanitizedSrc &&
      isAllowedMediaCdnUrl(sanitizedSrc)
    ) {
      setLoadPhase('proxy');
    } else {
      setLoadPhase('slate');
    }
  };

  const accentBarFill =
    platform === 'douyin'
      ? '#2dd4bf'
      : platform === 'tiktok'
      ? '#38bdf8'
      : platform === 'instagram'
      ? '#fb7185'
      : '#60a5fa';

  return (
    <div
      className={`relative overflow-hidden bg-slate-900 select-none ${className}`}
    >
      {activeImgSrc ? (
        <img
          src={activeImgSrc}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={handleImageError}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="w-full h-full flex flex-col justify-between p-4 pb-9 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-slate-200">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span className="font-semibold text-slate-200 truncate">
              {PLATFORM_LABELS[platform]} · Original Audio Stem
            </span>
            {(bpm || musicalKey) && (
              <span className="tabular-nums text-slate-300 shrink-0">
                {[bpm ? `${bpm} BPM` : null, musicalKey]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>

          <div className="my-auto py-2">
            <svg
              viewBox="0 0 240 56"
              aria-hidden="true"
              className="w-full h-14 overflow-visible"
            >
              <line
                x1="0"
                y1="28"
                x2="240"
                y2="28"
                stroke="#334155"
                strokeWidth="1"
              />
              {bars.map((barH, idx) => {
                const x = idx * 8 + 1.5;
                const y = Math.round((56 - barH) / 2);
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={y}
                    width="4.5"
                    height={barH}
                    rx="1.5"
                    fill={idx % 4 === 0 ? '#94a3b8' : accentBarFill}
                    opacity={idx % 3 === 0 ? '0.92' : '0.72'}
                  />
                );
              })}
            </svg>
            <p className="text-[11px] font-mono text-slate-300 truncate mt-1.5">
              {audioTitle || alt}
            </p>
          </div>
        </div>
      )}

      {/* Measured contrast scrim for bottom overlay legibility (WCAG AA >= 4.5:1) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between text-xs text-white/95">
        <span className="font-medium truncate max-w-[70%]">
          @{creatorHandle}
        </span>
        <span className="font-mono tabular-nums text-[11px] text-white/90">
          {formatDuration(durationSec)}
        </span>
      </div>
    </div>
  );
}
