import React from 'react';
import { Vote, Network } from 'lucide-react';

export interface NavbarProps {
  currentTab: 'parliament' | 'mesh';
  setCurrentTab: (tab: 'parliament' | 'mesh') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
}) => {
  return (
    <nav
      className="w-full px-3 pt-4 pb-1 flex justify-center md:block md:w-auto md:p-0 md:fixed md:right-5 md:top-1/2 md:-translate-y-1/2 z-50 font-['Google_Sans',sans-serif] bg-transparent"
      aria-label="Main Navigation"
    >
      <div className="flex flex-row flex-wrap md:flex-col items-center md:items-stretch justify-center gap-2 md:gap-1.5">
        <button
          type="button"
          onClick={() => setCurrentTab('parliament')}
          aria-current={currentTab === 'parliament' ? 'page' : undefined}
          className={`flex items-center justify-center md:justify-start gap-2 min-h-[44px] md:min-h-0 px-3.5 py-2 md:px-2.5 md:py-1.5 rounded-md text-xs md:text-[11px] font-medium transition-all ${
            currentTab === 'parliament'
              ? 'bg-[#8fa3b8]/15 text-[#e5e4e2] border border-[#8fa3b8]/40'
              : 'text-[#8fa3b8] border border-[#8fa3b8]/20 md:border-transparent hover:bg-[#8fa3b8]/05 hover:text-[#e5e4e2]'
          }`}
        >
          <Vote className="w-3.5 h-3.5 md:w-3 md:h-3 shrink-0" aria-hidden="true" />
          <span>Parliament</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentTab('mesh')}
          aria-current={currentTab === 'mesh' ? 'page' : undefined}
          className={`flex items-center justify-center md:justify-start gap-2 min-h-[44px] md:min-h-0 px-3.5 py-2 md:px-2.5 md:py-1.5 rounded-md text-xs md:text-[11px] font-medium transition-all ${
            currentTab === 'mesh'
              ? 'bg-[#8fa3b8]/15 text-[#e5e4e2] border border-[#8fa3b8]/40'
              : 'text-[#8fa3b8] border border-[#8fa3b8]/20 md:border-transparent hover:bg-[#8fa3b8]/05 hover:text-[#e5e4e2]'
          }`}
        >
          <Network className="w-3.5 h-3.5 md:w-3 md:h-3 shrink-0" aria-hidden="true" />
          <span>Citizen Mesh</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
};
