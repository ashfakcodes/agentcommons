import React from 'react';
import { 
  ShieldCheck, Lock, ExternalLink, Award, Network, Vote, 
  CheckCircle2, Clock, Zap, Cpu, Sparkles, User, Key
} from 'lucide-react';
import { AgentNode, MeshEdge, Proposal } from '../types';
import { CAPABILITIES, SPACE_ID_REGISTRAR_ADDRESS, BSC_CONFIG } from '../constants/contracts';

interface PassportViewProps {
  agent: AgentNode;
  edges: MeshEdge[];
  proposals: Proposal[];
  onOpenAgentSwitcher: () => void;
}

export const PassportView: React.FC<PassportViewProps> = ({
  agent,
  edges,
  proposals,
  onOpenAgentSwitcher,
}) => {
  // Find all edges connected to this agent
  const connectedEdges = edges.filter(
    (e) => String(e.fromTokenId) === String(agent.tokenId) || String(e.toTokenId) === String(agent.tokenId)
  );

  // Voting history
  const votedProposals = proposals.filter(
    (p) => p.votedByCaller !== undefined || agent.votesCount > 0
  );

  return (
    <div className="space-y-6">
      {/* Top Banner / Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f121d] border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-400">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Soulbound Agent ID Passport</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                ERC-721 Soulbound
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Immutable on-chain identity anchored to Binance Agentic Wallet (`baw`) & SPACE ID Registrar.
            </p>
          </div>
        </div>

        <button
          onClick={onOpenAgentSwitcher}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-purple-500/40 text-xs font-mono text-purple-300 hover:text-white transition-all shadow-sm"
        >
          <User className="w-3.5 h-3.5 text-purple-400" />
          <span>Switch Persona ({agent.name})</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Holographic Cyber-Passport Card (Col 1) */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#151b2e] via-[#0f121d] to-[#0a0c14] border-2 border-cyan-500/40 p-6 shadow-cyan-glow space-y-5">
          {/* Hologram visual shine */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-cyan-500/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />

          {/* Card Top Brand */}
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏛️</span>
              <div>
                <span className="font-bold font-mono tracking-wider text-xs text-cyan-400">AGENT COMMONS</span>
                <p className="text-[10px] text-slate-400 font-mono">PROOF-OF-PERSONHOOD</p>
              </div>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/80 border border-amber-600/60 text-amber-300 text-[10px] font-mono">
              <Lock className="w-3 h-3 text-amber-400" />
              <span>NON-TRANSFERABLE</span>
            </div>
          </div>

          {/* Avatar & Core Identity */}
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center font-mono font-extrabold text-2xl text-white shadow-xl ${
                agent.isGenesis
                  ? 'bg-gradient-to-tr from-rose-600 to-amber-600 ring-2 ring-rose-400 shadow-rose-900/50'
                  : 'bg-gradient-to-tr from-cyan-600 via-blue-600 to-purple-600 shadow-cyan-900/50'
              }`}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-extrabold font-mono text-white tracking-wide">
                  {agent.name}
                </h3>
              </div>
              <div className="text-xs font-mono text-amber-400 mt-0.5">
                Token ID: #{agent.tokenId}
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 mt-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Space ID Verified (.ai)</span>
              </div>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="space-y-2.5 pt-2 text-xs font-mono">
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400">KYC OWNER ADDRESS</div>
              <div className="text-slate-200 truncate">{agent.owner}</div>
            </div>

            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>SPACE ID REGISTRAR</span>
                <span className="text-emerald-400">BNB Chain</span>
              </div>
              <a
                href={`${BSC_CONFIG.blockExplorerUrl}/address/${SPACE_ID_REGISTRAR_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline flex items-center justify-between truncate"
              >
                <span className="truncate">{SPACE_ID_REGISTRAR_ADDRESS}</span>
                <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
              </a>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500">Reputation</span>
                <p className="text-base font-bold text-amber-300">{agent.reputationScore}%</p>
              </div>
              <div className="p-2.5 bg-slate-950/70 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500">Citizen Since</span>
                <p className="text-xs font-bold text-slate-300 mt-0.5">{agent.registeredDate}</p>
              </div>
            </div>
          </div>

          {/* Security Guarantee Notice */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-cyan-500/20 text-[11px] text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cyan-300">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>Sybil-Proof Guarantee</span>
            </div>
            <p className="text-slate-400 text-[10px] leading-relaxed">
              Strict 1-to-1 mapping: 1 KYC User $\rightarrow$ 1 Agentic Wallet $\rightarrow$ 1 Agent ID. 
              Non-custodial and protected against proxy calldata smuggling.
            </p>
          </div>
        </div>

        {/* Right Section: Badges, Peers & Governance (Cols 2 & 3) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* 1. Capability Badges Matrix */}
          <div className="bg-[#0f121d] border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span>Verified Capability Matrix (Bitmask: 0x{agent.capabilities.toString(16).padStart(2, '0')})</span>
              </h3>
              <span className="text-xs text-amber-400 font-mono">
                {Object.keys(CAPABILITIES).filter((b) => (agent.capabilities & Number(b)) !== 0).length} / 5 Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(CAPABILITIES).map(([bitStr, cap]) => {
                const bit = Number(bitStr);
                const isEnabled = (agent.capabilities & bit) !== 0;

                return (
                  <div
                    key={bit}
                    className={`p-3 rounded-xl border transition-all ${
                      isEnabled
                        ? 'bg-slate-900/90 border-cyan-500/40 shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/60 opacity-40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold font-mono text-white">
                        {cap.name}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          isEnabled
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-slate-900 text-slate-500 border border-slate-800'
                        }`}
                      >
                        {isEnabled ? 'VERIFIED' : 'DISABLED'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {cap.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-slate-500">
                      <span>Tag: {cap.tag}</span>
                      <span>•</span>
                      <span>Bit #{Math.log2(bit)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Connected Mesh Peers */}
          <div className="bg-[#0f121d] border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                <Network className="w-4 h-4 text-amber-400" />
                <span>Connected Citizen Mesh Peers ({connectedEdges.length})</span>
              </h3>
              <span className="text-xs text-amber-300 font-mono">
                Golden Reciprocal Edges
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
              {connectedEdges.map((edge, idx) => {
                const peerName = edge.fromTokenId === agent.tokenId ? edge.toName : edge.fromName;
                const peerTokenId = edge.fromTokenId === agent.tokenId ? edge.toTokenId : edge.fromTokenId;

                return (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 transition-all flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-amber-950 text-amber-300 flex items-center justify-center font-mono font-bold text-[10px] border border-amber-800">
                        {peerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-mono font-bold text-white text-xs">{peerName}</div>
                        <span className="text-[10px] text-slate-500 font-mono">#{peerTokenId}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                      Mutual
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Governance Participation History */}
          <div className="bg-[#0f121d] border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                <Vote className="w-4 h-4 text-purple-400" />
                <span>Parliamentary Activity & Gasless Votes</span>
              </h3>
              <span className="text-xs text-purple-300 font-mono">
                1-Agent-1-Vote Certified
              </span>
            </div>

            <div className="space-y-2">
              {votedProposals.map((prop) => (
                <div
                  key={prop.id}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs font-mono"
                >
                  <div>
                    <div className="font-bold text-slate-200">
                      ACP-00{prop.id}: {prop.title.slice(0, 48)}...
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Snapshot Block #{prop.snapshotBlock} • Gasless Meta-Tx
                    </div>
                  </div>

                  <span className="px-2 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
                    VOTED FOR
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
