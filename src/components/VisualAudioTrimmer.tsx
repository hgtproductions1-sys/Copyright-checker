import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Scissors, Square } from 'lucide-react';
import {
  computeTrimmerDragUpdate,
  dbToLinearGain,
  detectTrimmerHitTarget,
  formatPreciseTimecode,
  type TrimmerDragTarget,
} from '../lib/audioTimelineMath';

export interface TrimmerEditableClip {
  id: string;
  name: string;
  peaks: number[];
  sourceDurationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
}

interface VisualAudioTrimmerProps {
  clips: TrimmerEditableClip[];
  selectedClip: TrimmerEditableClip;
  selectedIndex: number;
  soloClipId: string | null;
  soloPlayheadSec: number | null;
  onSelectClip: (clipId: string) => void;
  onUpdateTrim: (
    clipId: string,
    patch: { trimStartSec?: number; trimEndSec?: number }
  ) => void;
  onTogglePreview: (clip: TrimmerEditableClip) => void;
}

interface ActiveDragSession {
  target: TrimmerDragTarget;
  grabOffsetSec: number;
  initialWindowSpanSec: number;
}

export function VisualAudioTrimmer({
  clips,
  selectedClip,
  selectedIndex,
  soloClipId,
  soloPlayheadSec,
  onSelectClip,
  onUpdateTrim,
  onTogglePreview,
}: VisualAudioTrimmerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [dragTarget, setDragTarget] = useState<TrimmerDragTarget | null>(null);
  const dragSessionRef = useRef<ActiveDragSession | null>(null);

  const sourceDur = Math.max(0.25, selectedClip.sourceDurationSec);
  const startRatio = Math.max(0, Math.min(1, selectedClip.trimStartSec / sourceDur));
  const endRatio = Math.max(
    startRatio,
    Math.min(1, selectedClip.trimEndSec / sourceDur)
  );
  const keptDurationSec = Math.max(
    0.25,
    selectedClip.trimEndSec - selectedClip.trimStartSec
  );
  const isPreviewing = soloClipId === selectedClip.id;

  const startSvgX = Number((startRatio * 1000).toFixed(2));
  const endSvgX = Number((endRatio * 1000).toFixed(2));
  const selectionSvgW = Math.max(4, Number((endSvgX - startSvgX).toFixed(2)));
  const startHandleX = Math.max(0, Math.min(968, startSvgX - 16));
  const endHandleX = Math.max(0, Math.min(968, endSvgX - 16));
  const playheadSvgX =
    isPreviewing && soloPlayheadSec !== null
      ? Number(
          (
            Math.max(0, Math.min(1, soloPlayheadSec / sourceDur)) * 1000
          ).toFixed(2)
        )
      : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const rulerHeight = 22;
    const waveTop = rulerHeight + 4;
    const waveHeight = h - waveTop - 8;

    ctx.clearRect(0, 0, w, h);

    // Base surface
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Top ruler strip
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, w, rulerHeight);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerHeight);
    ctx.lineTo(w, rulerHeight);
    ctx.stroke();

    const startX = startRatio * w;
    const endX = endRatio * w;

    // Dimmed trimmed-out regions before In and after Out
    ctx.fillStyle = '#e2e8f0';
    if (startX > 0) {
      ctx.fillRect(0, rulerHeight, startX, h - rulerHeight);
    }
    if (endX < w) {
      ctx.fillRect(endX, rulerHeight, w - endX, h - rulerHeight);
    }

    // Active kept window subtle sky wash
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(startX, rulerHeight, Math.max(2, endX - startX), h - rulerHeight);

    // Time ruler ticks across source clip duration
    const tickStep =
      sourceDur <= 6 ? 0.5 : sourceDur <= 16 ? 1 : sourceDur <= 40 ? 2 : 5;
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#cbd5e1';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;

    for (let t = 0; t <= sourceDur + 0.001; t += tickStep) {
      const x = Math.min(w - 1, (t / sourceDur) * w);
      ctx.beginPath();
      ctx.moveTo(x, rulerHeight - 6);
      ctx.lineTo(x, rulerHeight);
      ctx.stroke();

      if (x < w - 34) {
        const label =
          Number.isInteger(t) || tickStep >= 1 ? `${t.toFixed(0)}s` : `${t.toFixed(1)}s`;
        ctx.fillText(label, x + 4, 14);
      }
    }

    // Center zero-crossing reference axis
    const midY = waveTop + waveHeight / 2;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Waveform amplitude bars
    const gainScale = Math.min(
      1.35,
      Math.max(0.35, dbToLinearGain(selectedClip.gainDb))
    );
    const barCount = Math.max(1, selectedClip.peaks.length);
    const barStep = w / barCount;
    const barWidth = Math.max(3, barStep * 0.64);

    for (let i = 0; i < barCount; i++) {
      const bx = i * barStep + (barStep - barWidth) / 2;
      const centerRatio = (i + 0.5) / barCount;
      const inActive = centerRatio >= startRatio && centerRatio <= endRatio;
      const amp = Math.min(0.96, selectedClip.peaks[i] * gainScale);
      const barH = Math.max(6, amp * (waveHeight - 6));
      const by = midY - barH / 2;

      ctx.fillStyle = inActive ? '#0369a1' : '#94a3b8';
      ctx.fillRect(bx, by, barWidth, barH);
    }

    // Fade-in & fade-out curve overlay inside kept selection
    if (selectedClip.fadeInSec > 0.02 || selectedClip.fadeOutSec > 0.02) {
      const fadeInW = (selectedClip.fadeInSec / sourceDur) * w;
      const fadeOutW = (selectedClip.fadeOutSec / sourceDur) * w;
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, h - 6);
      ctx.lineTo(Math.min(endX, startX + fadeInW), waveTop + 4);
      ctx.lineTo(Math.max(startX, endX - fadeOutW), waveTop + 4);
      ctx.lineTo(endX, h - 6);
      ctx.stroke();
    }
  }, [selectedClip, sourceDur, startRatio, endRatio]);

  const ratioFromClientX = (clientX: number): number => {
    const el = surfaceRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const pointerRatio = ratioFromClientX(e.clientX);
    const pointerSec = pointerRatio * sourceDur;

    const hit = detectTrimmerHitTarget({
      pointerRatio,
      startRatio,
      endRatio,
      edgeToleranceRatio: 0.028,
    });

    const spanSec = selectedClip.trimEndSec - selectedClip.trimStartSec;
    const grabOffsetSec =
      hit.target === 'window'
        ? Math.max(0, Math.min(spanSec, pointerSec - selectedClip.trimStartSec))
        : 0;

    dragSessionRef.current = {
      target: hit.target,
      grabOffsetSec,
      initialWindowSpanSec: spanSec,
    };
    setDragTarget(hit.target);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events where pointerId cannot be captured
    }

    if (hit.jumpImmediately || hit.target === 'start' || hit.target === 'end') {
      const updated = computeTrimmerDragUpdate({
        sourceDurationSec: sourceDur,
        trimStartSec: selectedClip.trimStartSec,
        trimEndSec: selectedClip.trimEndSec,
        target: hit.target,
        pointerSec,
        grabOffsetSec,
        initialWindowSpanSec: spanSec,
      });
      onUpdateTrim(selectedClip.id, updated);
    }
  };

  const handleSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session) return;
    const pointerSec = ratioFromClientX(e.clientX) * sourceDur;
    const updated = computeTrimmerDragUpdate({
      sourceDurationSec: sourceDur,
      trimStartSec: selectedClip.trimStartSec,
      trimEndSec: selectedClip.trimEndSec,
      target: session.target,
      pointerSec,
      grabOffsetSec: session.grabOffsetSec,
      initialWindowSpanSec: session.initialWindowSpanSec,
    });
    onUpdateTrim(selectedClip.id, updated);
  };

  const handleSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragSessionRef.current) return;
    dragSessionRef.current = null;
    setDragTarget(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore synthetic pointer release errors
    }
  };

  const isAlreadyFullClip =
    selectedClip.trimStartSec <= 0.01 &&
    Math.abs(selectedClip.trimEndSec - selectedClip.sourceDurationSec) <= 0.05;

  return (
    <div
      data-testid="visual-audio-trimmer"
      className="border border-slate-200 rounded-xl bg-slate-50/70 p-4 space-y-4"
    >
      {/* Top Header & Action Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Scissors className="w-3.5 h-3.5 text-sky-700 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-slate-900">
              Visual Audio Trimmer
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums font-semibold text-sky-800 truncate">
              {String(selectedIndex + 1).padStart(2, '0')}. {selectedClip.name}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Drag the left <strong className="text-slate-700">IN</strong> or right{' '}
            <strong className="text-slate-700">OUT</strong> marker across the
            waveform, or drag the highlighted blue region to shift your kept window
            before compiling.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePreview(selectedClip)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            {isPreviewing ? (
              <>
                <Square className="w-3 h-3 text-amber-400" aria-hidden="true" />
                <span>Stop Preview</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-sky-300" aria-hidden="true" />
                <span>Preview Selection</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isAlreadyFullClip}
            onClick={() =>
              onUpdateTrim(selectedClip.id, {
                trimStartSec: 0,
                trimEndSec: selectedClip.sourceDurationSec,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-45 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset Full Clip</span>
          </button>
        </div>
      </div>

      {/* Multi-clip quick switcher when timeline has >1 track */}
      {clips.length > 1 && (
        <div
          role="tablist"
          aria-label="Select clip to trim visually"
          className="flex items-center gap-1.5 overflow-x-auto pb-1"
        >
          {clips.map((c, idx) => {
            const active = c.id === selectedClip.id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectClip(c.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 max-w-52 truncate ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {String(idx + 1).padStart(2, '0')}. {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Interactive Waveform Canvas + Crisp SVG Handle Overlay */}
      <div
        ref={surfaceRef}
        data-testid="visual-audio-trimmer-surface"
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerCancel={handleSurfacePointerUp}
        className={`relative w-full h-32 rounded-lg border overflow-hidden select-none touch-none ${
          dragTarget
            ? 'border-sky-600 cursor-grabbing'
            : 'border-slate-300 cursor-ew-resize'
        }`}
      >
        <canvas
          ref={canvasRef}
          width={960}
          height={128}
          aria-label={`Interactive waveform trimmer for ${selectedClip.name}`}
          className="w-full h-full block"
        />

        {/* Vector Handle & Active Selection Frame Overlay (no inline CSS styles) */}
        <svg
          viewBox="0 0 1000 128"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {/* Active region top and bottom border rails */}
          <rect
            x={startSvgX}
            y={22}
            width={selectionSvgW}
            height={105}
            fill="none"
            stroke="#0284c7"
            strokeWidth={2}
          />

          {/* Top slip bar indicator */}
          <rect
            x={startSvgX}
            y={22}
            width={selectionSvgW}
            height={5}
            fill="#0284c7"
            fillOpacity={0.35}
          />

          {/* Live preview playback playhead */}
          {playheadSvgX !== null && (
            <g>
              <line
                x1={playheadSvgX}
                y1={0}
                x2={playheadSvgX}
                y2={128}
                stroke="#d97706"
                strokeWidth={2.5}
              />
              <polygon
                points={`${playheadSvgX - 5},0 ${playheadSvgX + 5},0 ${playheadSvgX},8`}
                fill="#d97706"
              />
            </g>
          )}

          {/* Start (IN) boundary vertical line + grip handle */}
          <line
            x1={startSvgX}
            y1={0}
            x2={startSvgX}
            y2={128}
            stroke="#0f172a"
            strokeWidth={2.5}
          />
          <rect
            x={startHandleX}
            y={2}
            width={32}
            height={18}
            rx={4}
            fill={dragTarget === 'start' ? '#0284c7' : '#0f172a'}
          />
          <text
            x={startHandleX + 16}
            y={14}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10"
            fontWeight="700"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            IN
          </text>

          {/* End (OUT) boundary vertical line + grip handle */}
          <line
            x1={endSvgX}
            y1={0}
            x2={endSvgX}
            y2={128}
            stroke="#0f172a"
            strokeWidth={2.5}
          />
          <rect
            x={endHandleX}
            y={2}
            width={32}
            height={18}
            rx={4}
            fill={dragTarget === 'end' ? '#0284c7' : '#0f172a'}
          />
          <text
            x={endHandleX + 16}
            y={14}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10"
            fontWeight="700"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            OUT
          </text>
        </svg>
      </div>

      {/* Precision Telemetry & Keyboard-Accessible Trim Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <label
              htmlFor={`visual-trim-start-slider-${selectedClip.id}`}
              className="font-medium text-slate-700"
            >
              Trim Start Point (In)
            </label>
            <span
              data-testid="trimmer-readout-in"
              className="font-mono tabular-nums font-semibold text-slate-900"
            >
              {formatPreciseTimecode(selectedClip.trimStartSec)} ({selectedClip.trimStartSec.toFixed(2)}s)
            </span>
          </div>
          <input
            id={`visual-trim-start-slider-${selectedClip.id}`}
            aria-label="Trim start point"
            type="range"
            min={0}
            max={Math.max(0, Number((selectedClip.trimEndSec - 0.25).toFixed(2)))}
            step={0.05}
            value={selectedClip.trimStartSec}
            onChange={(e) =>
              onUpdateTrim(selectedClip.id, {
                trimStartSec: Number(e.target.value),
              })
            }
            className="w-full accent-sky-700 cursor-pointer"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <label
              htmlFor={`visual-trim-end-slider-${selectedClip.id}`}
              className="font-medium text-slate-700"
            >
              Trim End Point (Out)
            </label>
            <span
              data-testid="trimmer-readout-out"
              className="font-mono tabular-nums font-semibold text-slate-900"
            >
              {formatPreciseTimecode(selectedClip.trimEndSec)} ({selectedClip.trimEndSec.toFixed(2)}s)
            </span>
          </div>
          <input
            id={`visual-trim-end-slider-${selectedClip.id}`}
            aria-label="Trim end point"
            type="range"
            min={Math.min(
              selectedClip.sourceDurationSec,
              Number((selectedClip.trimStartSec + 0.25).toFixed(2))
            )}
            max={selectedClip.sourceDurationSec}
            step={0.05}
            value={selectedClip.trimEndSec}
            onChange={(e) =>
              onUpdateTrim(selectedClip.id, {
                trimEndSec: Number(e.target.value),
              })
            }
            className="w-full accent-sky-700 cursor-pointer"
          />
        </div>
      </div>

      {/* Summary Footer Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs font-mono tabular-nums text-slate-600">
        <div>
          Kept Clip Length:{' '}
          <span
            data-testid="trimmer-readout-kept"
            className="font-bold text-sky-800"
          >
            {formatPreciseTimecode(keptDurationSec)} ({keptDurationSec.toFixed(2)}s)
          </span>
        </div>
        <div>
          Full Source Length:{' '}
          <span className="font-semibold text-slate-900">
            {formatPreciseTimecode(selectedClip.sourceDurationSec)} (
            {selectedClip.sourceDurationSec.toFixed(2)}s)
          </span>
        </div>
      </div>
    </div>
  );
}
