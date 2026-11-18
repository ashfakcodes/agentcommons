import React, { useState } from 'react';
import { X, Search, Check, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import { AgentNode } from '../types';
import { CAPABILITIES } from '../constants/contracts';

interface AgentSwitcherModalProps {
  agents: AgentNode[];
  activeAgent: AgentNode;
  onSelectAgent: (agent: AgentNode) => void;
  onClose: () => void;
}

export const AgentSwitcherModal: React.FC<AgentSwitcherModalProps> = ({
  agents,
  activeAgent,
  onSelectAgent,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [filterCap, setFilterCap] = useState<number | null>(null);

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.tokenId.toString().includes(search);
    const matchesCap = filterCap === null || (agent.capabilities & filterCap) !== 0;
    return matchesSearch && matchesCap;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-[#0f121d] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl text-slate-200 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div>
            <h3 className="font-bold text-lg text-white flex items-center gap-2">
              <span>Switch Simulated Agent Persona</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-400 font-mono">
                {agents.length} Verified IDs
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Each persona simulates a verified SPACE ID Soulbound Agent ID anchored to Binance Agentic Wallet.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="space-y-3 mb-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by agent name (e.g. scarlet.ai, alice.ai, #101)..."
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
            <button
              onClick={() => setFilterCap(null)}
              className={`px-2.5 py-1 rounded-lg border transition-all ${
                filterCap === null
                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              All ({agents.length})
            </button>
            {Object.entries(CAPABILITIES).map(([bitStr, cap]) => {
              const bit = Number(bitStr);
              return (
                <button
                  key={bit}
                  onClick={() => setFilterCap(filterCap === bit ? null : bit)}
                  className={`px-2.5 py-1 rounded-lg border transition-all ${
                    filterCap === bit
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {cap.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Agent Cards List */}
        <div className="overflow-y-auto space-y-2 pr-1 flex-1">
          {filteredAgents.map((agent) => {
            const isSelected = agent.tokenId === activeAgent.tokenId;
            return (
              <div
                key={agent.tokenId}
                onClick={() => {
                  onSelectAgent(agent);
                  onClose();
                }}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500 shadow-cyan-glow'
                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${
                      agent.isGenesis
                        ? 'bg-gradient-to-tr from-rose-600 to-amber-600 text-white shadow-lg ring-1 ring-rose-400'
                        : 'bg-gradient-to-tr from-cyan-700 to-purple-700 text-white'
                    }`}
                  >
                    {agent.name.charAt(0).toUpperCase()}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm font-mono text-white">
                        {agent.name}
                      </span>
                      <span className="text-xs text-amber-400 font-mono">
                        #{agent.tokenId}
                      </span>
                      {agent.isGenesis && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                          Genesis Node
                        </span>
                      )}
                      {agent.isRelayer && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                          Relayer
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1">{agent.bio}</p>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-0.5">
                      <span>Owner: {agent.owner.slice(0, 6)}...{agent.owner.slice(-4)}</span>
                      <span>Peers: {agent.peersCount}</span>
                      <span>Rep: {agent.reputationScore}%</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isSelected ? (
                    <span className="flex items-center gap-1 text-xs font-mono text-cyan-400 bg-cyan-950 px-2 py-1 rounded-lg border border-cyan-800">
                      <Check className="w-3.5 h-3.5" />
                      Active
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 font-mono opacity-0 group-hover:opacity-100">
                      Select
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-3 mt-3 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>SPACE ID Contract: 0x60b9...aa8b022f</span>
          </div>
          <span className="font-mono text-[11px] text-cyan-400">
            Total Turnout: {agents.length} Agent Personas
          </span>
        </div>
      </div>
    </div>
  );
};
