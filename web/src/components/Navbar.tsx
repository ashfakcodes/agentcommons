import React from 'react';
import { ShieldCheck, Vote, Network, UserCheck, ChevronDown, Sparkles, ExternalLink } from 'lucide-react';
import { AgentNode } from '../types';
import { BSC_CONFIG, SPACE_ID_REGISTRAR_ADDRESS } from '../constants/contracts';

interface NavbarProps {
  currentTab: 'parliament' | 'mesh' | 'passport';
  setCurrentTab: (tab: 'parliament' | 'mesh' | 'passport') => void;
  activeAgent: AgentNode;
  onOpenAgentSwitcher: () => void;
  isWalletConnected: boolean;
  walletAddress?: string;
  onConnectWallet: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  activeAgent,
  onOpenAgentSwitcher,
  isWalletConnected,
  walletAddress,
  onConnectWallet,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#07080c]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentTab('parliament')}>
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-600/30 border border-cyan-500/40 shadow-cyan-glow">
            <span className="text-xl">🏛️</span>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-wider text-white">AgentCommons</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/80">.ai</span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">Democratic Parliament & Citizen Mesh</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 sm:gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setCurrentTab('parliament')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'parliament'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Vote className="w-4 h-4" />
            <span>Parliament</span>
          </button>

          <button
            onClick={() => setCurrentTab('mesh')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'mesh'
                ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Network className="w-4 h-4" />
            <span>Citizen Mesh</span>
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          </button>

          <button
            onClick={() => setCurrentTab('passport')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              currentTab === 'passport'
                ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Passport</span>
          </button>
        </nav>

        {/* Right Section: Network & Agent Selector */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* BNB Chain Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-950/30 border border-yellow-700/50 text-[11px] font-mono text-yellow-300">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span>BSC Mainnet</span>
            <span className="text-yellow-600">|</span>
            <span className="text-slate-400">#56</span>
          </div>

          {/* Active Agent Selector / Switcher Pill */}
          <button
            onClick={onOpenAgentSwitcher}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 hover:border-cyan-500/60 transition-all text-left shadow-sm group"
            title="Click to switch simulated Agent ID persona"
          >
            <div className="relative">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-600 to-purple-600 flex items-center justify-center text-white font-mono font-bold text-xs">
                {activeAgent.name.charAt(0).toUpperCase()}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-slate-900" />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                  {activeAgent.name}
                </span>
                <span className="text-[10px] text-amber-400 font-mono">#{activeAgent.tokenId}</span>
              </div>
              <p className="text-[10px] text-slate-400">Space ID Verified</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-400 transition-transform group-hover:translate-y-0.5" />
          </button>

          {/* Wallet Connect or Web3 Wallet status */}
          {isWalletConnected ? (
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-xs font-mono">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}</span>
            </div>
          ) : (
            <button
              onClick={onConnectWallet}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-medium shadow-cyan-glow transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
