export const COVER_ART_DIMENSION_PX = 3000;

export type CoverArtStyleId =
  | 'obsidian_vinyl'
  | 'cobalt_frequency'
  | 'amber_analog'
  | 'emerald_resonance'
  | 'crimson_pulse'
  | 'ivory_monolith';

export interface CoverArtStyleSpec {
  id: CoverArtStyleId;
  label: string;
  bgStart: string;
  bgEnd: string;
  accentPrimary: string;
  accentSecondary: string;
  inkPrimary: string;
  inkMuted: string;
  lightMode: boolean;
}

export const COVER_ART_STYLES: readonly CoverArtStyleSpec[] = [
  {
    id: 'obsidian_vinyl',
    label: 'Obsidian Vinyl',
    bgStart: '#0b1120',
    bgEnd: '#1e293b',
    accentPrimary: '#38bdf8',
    accentSecondary: '#0284c7',
    inkPrimary: '#f8fafc',
    inkMuted: '#94a3b8',
    lightMode: false,
  },
  {
    id: 'cobalt_frequency',
    label: 'Cobalt Frequency',
    bgStart: '#0c1b3a',
    bgEnd: '#1e3a8a',
    accentPrimary: '#22d3ee',
    accentSecondary: '#f59e0b',
    inkPrimary: '#f8fafc',
    inkMuted: '#bae6fd',
    lightMode: false,
  },
  {
    id: 'amber_analog',
    label: 'Amber Analog',
    bgStart: '#1c120c',
    bgEnd: '#431407',
    accentPrimary: '#fbbf24',
    accentSecondary: '#fb7185',
    inkPrimary: '#fffbeb',
    inkMuted: '#fcd34d',
    lightMode: false,
  },
  {
    id: 'emerald_resonance',
    label: 'Emerald Resonance',
    bgStart: '#042f2e',
    bgEnd: '#0f172a',
    accentPrimary: '#2dd4bf',
    accentSecondary: '#a7f3d0',
    inkPrimary: '#f0fdfa',
    inkMuted: '#99f6e4',
    lightMode: false,
  },
  {
    id: 'crimson_pulse',
    label: 'Crimson Pulse',
    bgStart: '#230812',
    bgEnd: '#0f172a',
    accentPrimary: '#fb7185',
    accentSecondary: '#fda4af',
    inkPrimary: '#fff1f2',
    inkMuted: '#fecdd3',
    lightMode: false,
  },
  {
    id: 'ivory_monolith',
    label: 'Ivory Monolith',
    bgStart: '#f8fafc',
    bgEnd: '#e2e8f0',
    accentPrimary: '#0369a1',
    accentSecondary: '#0f172a',
    inkPrimary: '#0f172a',
    inkMuted: '#475569',
    lightMode: true,
  },
];

export function formatCoverDisplayTitle(rawSlugOrTitle: string): string {
  const cleaned = rawSlugOrTitle
    .trim()
    .replace(/\.(mp3|wav|m4a|flac|aiff?|wma)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Studio Original';
  return cleaned
    .split(' ')
    .map((word) => {
      if (/^(v\d+|\d+)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function buildCoverArtFilename(rawSlugOrTitle: string): string {
  const base = rawSlugOrTitle
    .trim()
    .toLowerCase()
    .replace(/\.(mp3|wav|m4a|flac|aiff?|wma|jpe?g|png)$/i, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${base || 'studio-master'}-cover-3000x3000.jpg`;
}

export function pickNextCoverStyle(
  currentStyleId?: CoverArtStyleId
): CoverArtStyleSpec {
  const idx = COVER_ART_STYLES.findIndex((s) => s.id === currentStyleId);
  const nextIdx = idx >= 0 ? (idx + 1) % COVER_ART_STYLES.length : 0;
  return COVER_ART_STYLES[nextIdx];
}

function createSeededPrng(seedText: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface GenerateCoverArtParams {
  titleInput: string;
  subtitleInput: string;
  styleId: CoverArtStyleId;
  waveformPeaks?: number[];
  seedSalt?: number;
}

export interface GeneratedCoverArtResult {
  blob: Blob;
  objectUrl: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  styleLabel: string;
  displayTitle: string;
}

export async function generateSquareCoverJpg(
  params: GenerateCoverArtParams
): Promise<GeneratedCoverArtResult> {
  const size = COVER_ART_DIMENSION_PX;
  const style =
    COVER_ART_STYLES.find((s) => s.id === params.styleId) ??
    COVER_ART_STYLES[0];
  const displayTitle = formatCoverDisplayTitle(params.titleInput);
  const subtitle = (params.subtitleInput || '').trim();
  const rng = createSeededPrng(
    `${displayTitle}|${subtitle}|${style.id}|${params.seedSalt ?? 1}`
  );

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas 2D context is unavailable for cover rendering.');
  }

  // 1. Rich angled atmospheric gradient background
  const bgGrad = ctx.createLinearGradient(0, 0, size, size);
  bgGrad.addColorStop(0, style.bgStart);
  bgGrad.addColorStop(1, style.bgEnd);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // 2. Radial spotlight aura behind central artwork geometry
  const glowCx = size * (0.42 + rng() * 0.16);
  const glowCy = size * (0.36 + rng() * 0.14);
  const radial = ctx.createRadialGradient(
    glowCx,
    glowCy,
    size * 0.04,
    glowCx,
    glowCy,
    size * 0.56
  );
  radial.addColorStop(
    0,
    style.lightMode ? 'rgba(3, 105, 161, 0.18)' : 'rgba(255, 255, 255, 0.14)'
  );
  radial.addColorStop(0.5, `${style.accentPrimary}26`);
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, size, size);

  // 3. Procedural fine studio geometric grid lines
  ctx.strokeStyle = style.lightMode
    ? 'rgba(15, 23, 42, 0.05)'
    : 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 2;
  const gridStep = 150;
  for (let p = gridStep; p < size; p += gridStep) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 4. Concentric vinyl / acoustic resonance emblem
  const centerX = size / 2;
  const centerY = size * 0.43;
  const maxRingRadius = size * 0.27;
  const ringCount = 9;
  for (let r = 0; r < ringCount; r++) {
    const ratio = (r + 1) / ringCount;
    const rad = maxRingRadius * ratio;
    ctx.beginPath();
    ctx.arc(centerX, centerY, rad, 0, Math.PI * 2);
    ctx.strokeStyle =
      r % 3 === 0 ? style.accentPrimary : `${style.accentSecondary}88`;
    ctx.lineWidth = r % 3 === 0 ? 5 : 2.5;
    ctx.stroke();
  }

  // Offset orbital arcs for editorial contrast
  for (let a = 0; a < 4; a++) {
    const startAngle = rng() * Math.PI * 2;
    const arcLen = Math.PI * (0.45 + rng() * 0.8);
    ctx.beginPath();
    ctx.arc(
      centerX,
      centerY,
      maxRingRadius * (0.62 + a * 0.13),
      startAngle,
      startAngle + arcLen
    );
    ctx.strokeStyle = a % 2 === 0 ? style.accentPrimary : style.inkPrimary;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 5. Real acoustic spectrum bar sculpture across center
  const peaksSource =
    params.waveformPeaks && params.waveformPeaks.length > 0
      ? params.waveformPeaks
      : Array.from({ length: 48 }, (_, idx) => {
          const t = idx / 47;
          return 0.24 + 0.65 * Math.sin(t * Math.PI) * (0.55 + rng() * 0.45);
        });
  const barCount = 48;
  const barBandWidth = size * 0.68;
  const barStartX = (size - barBandWidth) / 2;
  const barSlot = barBandWidth / barCount;
  const barWidth = barSlot * 0.56;

  for (let i = 0; i < barCount; i++) {
    const srcIdx = Math.min(
      peaksSource.length - 1,
      Math.floor((i / barCount) * peaksSource.length)
    );
    const amp = Math.max(0.12, Math.min(1, peaksSource[srcIdx] * (0.85 + rng() * 0.25)));
    const barHeight = amp * (size * 0.28);
    const x = barStartX + i * barSlot + (barSlot - barWidth) / 2;
    const y = centerY - barHeight / 2;

    const barGrad = ctx.createLinearGradient(x, y, x, y + barHeight);
    barGrad.addColorStop(0, style.accentPrimary);
    barGrad.addColorStop(1, style.accentSecondary);
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
    ctx.fill();
  }

  // 6. Outer hairline distribution frame (clean studio margin)
  const frameInset = 132;
  ctx.strokeStyle = style.lightMode
    ? 'rgba(15, 23, 42, 0.2)'
    : 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 3;
  ctx.strokeRect(
    frameInset,
    frameInset,
    size - frameInset * 2,
    size - frameInset * 2
  );

  // 7. Top & bottom crisp typography
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = style.inkMuted;
  ctx.font = '600 44px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('MASTER EDITION · 44.1 KHZ STEREO', frameInset + 64, frameInset + 56);

  ctx.textAlign = 'right';
  ctx.fillText('01 / 3000PX', size - frameInset - 64, frameInset + 56);

  // Bottom title block with automatic shrink-to-fit / word wrap up to 2 lines
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const maxTextWidth = size - (frameInset + 64) * 2;
  let titleFontSize = 186;
  ctx.font = `700 ${titleFontSize}px "Plus Jakarta Sans", "Manrope", system-ui, sans-serif`;

  const words = displayTitle.split(' ');
  const lines: string[] = [];
  if (ctx.measureText(displayTitle).width <= maxTextWidth || words.length === 1) {
    while (ctx.measureText(displayTitle).width > maxTextWidth && titleFontSize > 86) {
      titleFontSize -= 8;
      ctx.font = `700 ${titleFontSize}px "Plus Jakarta Sans", "Manrope", system-ui, sans-serif`;
    }
    lines.push(displayTitle);
  } else {
    const mid = Math.ceil(words.length / 2);
    lines.push(words.slice(0, mid).join(' '));
    lines.push(words.slice(mid).join(' '));
    while (
      Math.max(...lines.map((l) => ctx.measureText(l).width)) > maxTextWidth &&
      titleFontSize > 86
    ) {
      titleFontSize -= 8;
      ctx.font = `700 ${titleFontSize}px "Plus Jakarta Sans", "Manrope", system-ui, sans-serif`;
    }
  }

  const bottomBaselineY = size - frameInset - 64;
  if (subtitle) {
    ctx.fillStyle = style.inkMuted;
    ctx.font = '500 58px "Plus Jakarta Sans", "Manrope", system-ui, sans-serif';
    ctx.fillText(subtitle, frameInset + 64, bottomBaselineY);
  }

  ctx.fillStyle = style.inkPrimary;
  ctx.font = `700 ${titleFontSize}px "Plus Jakarta Sans", "Manrope", system-ui, sans-serif`;
  const titleOffsetBottom = subtitle ? bottomBaselineY - 96 : bottomBaselineY;
  const lineGap = titleFontSize * 1.12;
  for (let i = 0; i < lines.length; i++) {
    const lineIdxFromBottom = lines.length - 1 - i;
    ctx.fillText(
      lines[i],
      frameInset + 64,
      titleOffsetBottom - lineIdxFromBottom * lineGap
    );
  }

  // Export directly as real 3000x3000 JPEG Blob (zero AI image credits required)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to encode 3000x3000 cover image to JPEG.'));
      },
      'image/jpeg',
      0.93
    );
  });

  const objectUrl = URL.createObjectURL(blob);
  const fileName = buildCoverArtFilename(params.titleInput || displayTitle);

  return {
    blob,
    objectUrl,
    fileName,
    width: size,
    height: size,
    sizeBytes: blob.size,
    styleLabel: style.label,
    displayTitle,
  };
}
