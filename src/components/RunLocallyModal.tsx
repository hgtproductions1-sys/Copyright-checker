import { useEffect, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';

interface RunLocallyModalProps {
  open: boolean;
  onClose: () => void;
}

const LOCAL_COMMANDS = `npm install
npm run dev
# Opens full-stack OrigiSound server on http://localhost:3000`;

export function RunLocallyModal({ open, onClose }: RunLocallyModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('npm install && npm run dev');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    setZipError(null);
    try {
      const res = await fetch('/api/export-zip');
      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'origisound-app.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setZipError(
        err instanceof Error ? err.message : 'Unable to download zip archive.'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-locally-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="run-locally-title"
              className="text-lg font-bold text-slate-900"
            >
              Download & Run OrigiSound Locally
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Download the full source package as a clean `.zip` file, extract
              it on your computer, and run OrigiSound locally with zero social
              media logins or API keys required.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close local setup dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Direct Project ZIP Download Box */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-slate-900">
              Full Project Source Archive
            </div>
            <p className="text-xs text-slate-600">
              Includes server, React frontend, audio compiler, and unit tests.
            </p>
          </div>
          <button
            type="button"
            disabled={downloadingZip}
            onClick={() => void handleDownloadZip()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {downloadingZip ? 'Packaging Zip...' : 'Download App (.zip)'}
            </span>
          </button>
        </div>

        {zipError && (
          <p role="alert" className="text-xs font-medium text-rose-700">
            {zipError}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">
              Quickstart Terminal Commands (Node.js 20+ &amp; FFmpeg)
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy Command</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-3.5 bg-slate-950 text-slate-100 text-xs font-mono rounded-lg overflow-x-auto leading-relaxed">
            {LOCAL_COMMANDS}
          </pre>
        </div>

        <div className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-4 leading-relaxed">
          <p>
            <span className="font-semibold text-slate-900">
              Why run locally?
            </span>{' '}
            Running on your own studio machine uses your residential connection
            to fetch live video covers, direct MP3/MP4 streams, and full
            discovery feeds with zero social logins.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
