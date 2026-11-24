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
      className="fixed right-3 sm:right-5 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-1.5 font-['Google_Sans',sans-serif] bg-transparent"
      aria-label="Main Navigation"
    >
      <button
        type="button"
        onClick={() => setCurrentTab('parliament')}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
          currentTab === 'parliament'
            ? 'bg-[#8fa3b8]/15 text-[#e5e4e2] border border-[#8fa3b8]/40'
            : 'text-[#8fa3b8] border border-transparent hover:bg-[#8fa3b8]/05 hover:text-[#e5e4e2]'
        }`}
      >
        <Vote className="w-3 h-3" />
        <span>Parliament</span>
      </button>

      <button
        type="button"
        onClick={() => setCurrentTab('mesh')}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
          currentTab === 'mesh'
            ? 'bg-[#8fa3b8]/15 text-[#e5e4e2] border border-[#8fa3b8]/40'
            : 'text-[#8fa3b8] border border-transparent hover:bg-[#8fa3b8]/05 hover:text-[#e5e4e2]'
        }`}
      >
        <Network className="w-3 h-3" />
        <span>Citizen Mesh</span>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
      </button>
    </nav>
  );
};
