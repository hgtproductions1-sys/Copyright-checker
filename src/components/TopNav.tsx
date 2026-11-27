import { Terminal } from 'lucide-react';

export type WorkspaceTab =
  | 'discover'
  | 'inspector'
  | 'copyright'
  | 'studio'
  | 'saved'
  | 'queries';

interface TopNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  savedCount: number;
  onOpenLocalModal: () => void;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'discover', label: 'Discover' },
  { id: 'inspector', label: 'URL Inspector' },
  { id: 'copyright', label: 'Copyright Check' },
  { id: 'studio', label: 'Audio Studio' },
  { id: 'saved', label: 'Saved Leads' },
];

export function TopNav({
  activeTab,
  onSelectTab,
  savedCount,
  onOpenLocalModal,
}: TopNavProps) {
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-8 px-6 h-14">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('discover');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          OrigiSound
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary workspace navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            const labelText =
              item.id === 'saved' && savedCount > 0
                ? `${item.label} (${savedCount})`
                : item.label;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectTab(item.id);
                }}
                className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                  isActive
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {labelText}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenLocalModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Run Locally</span>
          </button>
        </div>
      </div>

      {/* Responsive mobile tab bar (shown only below md so desktop strictly preserves 1-row 3-zone header) */}
      <nav
        aria-label="Mobile workspace navigation"
        className="flex md:hidden items-center gap-1 px-4 py-2 border-t border-slate-100 overflow-x-auto bg-slate-50"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const labelText =
            item.id === 'saved' && savedCount > 0
              ? `${item.label} (${savedCount})`
              : item.label;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {labelText}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
