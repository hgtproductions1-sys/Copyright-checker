import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import {
  buildZeroLoginQueries,
  QUERY_LANGUAGES,
  type QueryLanguage,
} from '../lib/queryBuilder';
import { PLATFORM_LABELS } from '../lib/formatters';
import type { SocialPlatform } from '../types/media';

const ALL_PLATFORMS: SocialPlatform[] = [
  'tiktok',
  'instagram',
  'douyin',
  'facebook',
];

export function QueryBuilderView() {
  const [keyword, setKeyword] = useState('street food');
  const [language, setLanguage] = useState<QueryLanguage>('en');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(ALL_PLATFORMS);
  const [excludeLabels, setExcludeLabels] = useState(true);
  const [rawAmbientOnly, setRawAmbientOnly] = useState(false);
  const [royaltyFreeMusicOnly, setRoyaltyFreeMusicOnly] = useState(true);
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);

  const togglePlatform = (p: SocialPlatform) => {
    setPlatforms((prev) =>
      prev.includes(p)
        ? prev.length > 1
          ? prev.filter((item) => item !== p)
          : prev
        : [...prev, p]
    );
  };

  const generated = buildZeroLoginQueries({
    keyword,
    platforms,
    language,
    excludeCommercialLabels: excludeLabels,
    rawAmbientOnly,
    royaltyFreeMusicOnly,
  });

  const handleCopy = async (platform: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPlatform(platform);
      setTimeout(() => setCopiedPlatform(null), 1800);
    } catch {
      setCopiedPlatform(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Zero-Login Deep Search Operator Builder
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Generate localized search engine operators that surface public
            TikTok, Instagram, Douyin, and Facebook video permalinks stamped
            with original-sound markers while bypassing platform login walls and
            excluding major music labels.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div className="md:col-span-2 space-y-1.5">
            <label
              htmlFor="qb-keyword-input"
              className="block text-xs font-semibold text-slate-900"
            >
              Topic, Niche, or Sound Keyword
            </label>
            <input
              id="qb-keyword-input"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. guzheng, lofi, pottery, street food, espresso"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="qb-language-select"
              className="block text-xs font-semibold text-slate-900"
            >
              Original-Sound Tag Language
            </label>
            <select
              id="qb-language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as QueryLanguage)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              {QUERY_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 mr-1">
              Target Platforms:
            </span>
            {ALL_PLATFORMS.map((p) => {
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                  }`}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={royaltyFreeMusicOnly}
                onChange={(e) => setRoyaltyFreeMusicOnly(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Non-Copyrighted / Free BGM (无版权音乐)</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeLabels}
                onChange={(e) => setExcludeLabels(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Exclude UMG / Sony / Warner / Official Audio</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rawAmbientOnly}
                onChange={(e) => setRawAmbientOnly(e.target.checked)}
                className="rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Require Raw Mic / ASMR / No-Music terms</span>
            </label>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {generated.map((item) => {
          const isCopied = copiedPlatform === item.platform;
          return (
            <section
              key={item.platform}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    {item.platformLabel}
                  </h2>
                  <button
                    type="button"
                    onClick={() => void handleCopy(item.platform, item.queryText)}
                    aria-label={`Copy ${item.platformLabel} search operator`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copy Query</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-3 bg-slate-950 text-slate-100 text-xs font-mono rounded-lg overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                  {item.queryText}
                </pre>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {item.rationale}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs font-medium">
                <span className="text-slate-500">Launch without account:</span>
                <a
                  href={item.duckDuckGoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 whitespace-nowrap"
                >
                  <span>DuckDuckGo</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <a
                  href={item.googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 whitespace-nowrap"
                >
                  <span>Google</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <a
                  href={item.bingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 whitespace-nowrap"
                >
                  <span>Bing</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
