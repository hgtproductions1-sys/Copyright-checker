import { useEffect, useRef, useState } from 'react';
import { formatPreciseTimecode } from '../lib/audioTimelineMath';
import type { SegmentAcousticProfile } from '../lib/audioSimilarity';

interface CopyrightTimelineCanvasProps {
  segments: SegmentAcousticProfile[];
  durationSec: number;
}

export function CopyrightTimelineCanvas({
  segments,
  durationSec,
}: CopyrightTimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedSegIdx, setSelectedSegIdx] = useState<number>(0);

  useEffect(() => {
    setSelectedSegIdx(0);
  }, [segments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const rulerH = 20;
    const trackY = rulerH + 4;
    const trackH = h - trackY - 6;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const total = Math.max(
      0.5,
      durationSec,
      segments.length > 0 ? segments[segments.length - 1].endSec : 0
    );

    const tickStep = total <= 10 ? 1 : total <= 30 ? 2 : 5;
    ctx.strokeStyle = '#334155';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;

    for (let t = 0; t <= total + 0.001; t += tickStep) {
      const tx = Math.min(w - 1, (t / total) * w);
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, 10);
      ctx.stroke();
      if (tx < w - 28) {
        ctx.fillText(`${t}s`, tx + 3, 10);
      }
    }

    segments.forEach((seg, idx) => {
      const x = Math.max(0, (seg.startSec / total) * w);
      const segW = Math.max(8, ((seg.endSec - seg.startSec) / total) * w);
      const isSelected = idx === selectedSegIdx;

      const fill =
        seg.riskLevel === 'flagged'
          ? '#be123c'
          : seg.riskLevel === 'review'
          ? '#d97706'
          : '#0d9488';

      ctx.fillStyle = fill;
      ctx.fillRect(x + 1, trackY, Math.max(4, segW - 2), trackH);

      // Loudness intensity bar inside segment (maps -50..0 dBFS to height)
      const normDb = Math.max(0.08, Math.min(0.95, (seg.rmsDb + 50) / 50));
      const meterH = Math.round(normDb * (trackH - 8));
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(
        x + 3,
        trackY + trackH - meterH - 3,
        Math.max(2, segW - 6),
        meterH
      );

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, trackY, Math.max(4, segW - 2), trackH);
      }
    });
  }, [segments, durationSec, selectedSegIdx]);

  if (segments.length === 0) {
    return null;
  }

  const activeSegment = segments[selectedSegIdx] || segments[0];

  return (
    <div
      data-testid="copyright-segment-timeline"
      className="bg-slate-900 text-slate-100 rounded-xl p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-semibold text-white">
          Segment-by-Segment Acoustic Rights Scan ({segments.length} windows)
        </div>
        <div className="flex items-center gap-4 text-slate-300 font-mono tabular-nums">
          <span>Clear: {segments.filter((s) => s.riskLevel === 'clear').length}</span>
          <span>Review: {segments.filter((s) => s.riskLevel === 'review').length}</span>
          <span>Flagged: {segments.filter((s) => s.riskLevel === 'flagged').length}</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={960}
        height={64}
        aria-label={`Segment copyright timeline with ${segments.length} windows`}
        className="w-full h-16 rounded-lg border border-slate-700 block"
      />

      {/* Clickable Segment Window Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {segments.map((seg, idx) => {
          const active = idx === selectedSegIdx;
          return (
            <button
              key={seg.index}
              type="button"
              onClick={() => setSelectedSegIdx(idx)}
              className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                active
                  ? 'bg-white text-slate-900 font-semibold'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {formatPreciseTimecode(seg.startSec)}–{formatPreciseTimecode(seg.endSec)}{' '}
              {seg.riskLevel === 'flagged'
                ? '!'
                : seg.riskLevel === 'review'
                ? '?'
                : '· Clear'}
            </button>
          );
        })}
      </div>

      {activeSegment && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
          <div className="text-slate-200">
            <span className="font-mono tabular-nums font-semibold text-white">
              {formatPreciseTimecode(activeSegment.startSec)} →{' '}
              {formatPreciseTimecode(activeSegment.endSec)}
            </span>{' '}
            <span aria-hidden="true">·</span>{' '}
            <span>{activeSegment.riskReason}</span>
          </div>
          <div className="font-mono tabular-nums text-slate-400">
            RMS {activeSegment.rmsDb} dBFS · Crest {activeSegment.crestDb} dB · Stereo Side{' '}
            {activeSegment.stereoSidePct}%
          </div>
        </div>
      )}
    </div>
  );
}
