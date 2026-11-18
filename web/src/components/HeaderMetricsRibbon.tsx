import React from 'react';
import { CheckCircle2, Flame, Users, Zap, ExternalLink, ShieldCheck } from 'lucide-react';
import { PARLIAMENT_ADDRESS, MESH_ADDRESS, SPACE_ID_REGISTRAR_ADDRESS, BSC_CONFIG } from '../constants/contracts';

interface HeaderMetricsRibbonProps {
  uniqueAgentsCount: number;
  totalVotesCount: number;
  totalMutualHandshakes: number;
}

export const HeaderMetricsRibbon: React.FC<HeaderMetricsRibbonProps> = ({
  uniqueAgentsCount,
  totalVotesCount,
  totalMutualHandshakes,
}) => {
  const target = 30;
  const isTargetAchieved = uniqueAgentsCount >= target;

  return (
    <div className="relative border-b border-slate-800/80 bg-gradient-to-r from-slate-950 via-[#0d111e] to-slate-950 py-3 px-4 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        
        {/* Metric 1: Unique Interacting Agent IDs (The Key Hackathon Requirement) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-mono tracking-wider text-slate-400">
                Unique Interacting Agent IDs
              </span>
              {isTargetAchieved && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 animate-pulse">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  Target Achieved ({uniqueAgentsCount}/{target})
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-mono font-extrabold text-cyan-300">
                {uniqueAgentsCount}
              </span>
              <span className="text-xs font-mono text-slate-400">/ 30 Requirement</span>
              <span className="text-[11px] text-amber-400 font-mono">
                (120% Quorum)
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Total Votes Cast */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-400">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase font-mono tracking-wider text-slate-400">
              Total On-Chain Votes
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-mono font-extrabold text-purple-300">
                {totalVotesCount}
              </span>
              <span className="text-xs text-slate-400">Cast</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                Bit-Packed Gasless
              </span>
            </div>
          </div>
        </div>

        {/* Metric 3: Active Reciprocal Handshakes */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase font-mono tracking-wider text-slate-400">
              Mutual Handshakes
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-mono font-extrabold text-amber-300">
                {totalMutualHandshakes}
              </span>
              <span className="text-xs text-slate-400">Edges</span>
              <span className="text-[10px] text-amber-400 font-mono">Golden Glow</span>
            </div>
          </div>
        </div>

        {/* Metric 4: Sponsored Gas Spent */}
        <div className="hidden sm:flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase font-mono tracking-wider text-slate-400">
              Agent Gas Cost
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-mono font-extrabold text-emerald-300">
                $0.00
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                100% Sponsored
              </span>
            </div>
          </div>
        </div>

        {/* Metric 5: BscScan Verified Contracts Link */}
        <div className="flex items-center gap-2">
          <div className="dropdown relative group">
            <a
              href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-xs font-mono text-slate-300 hover:text-cyan-300 transition-all shadow-sm"
            >
              <span>BscScan Contracts</span>
              <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            </a>
            
            {/* Tooltip / Quick preview on hover */}
            <div className="absolute right-0 top-full mt-2 hidden group-hover:block w-72 p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 text-[11px] font-mono text-slate-300">
              <p className="font-bold text-white mb-1.5 flex items-center justify-between">
                <span>Verified Contracts</span>
                <span className="text-emerald-400 text-[10px]">BSC (56)</span>
              </p>
              <div className="space-y-1.5">
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-cyan-300 hover:underline"
                >
                  <span>Parliament.sol</span>
                  <span className="text-slate-500">{PARLIAMENT_ADDRESS.slice(0, 6)}...{PARLIAMENT_ADDRESS.slice(-4)}</span>
                </a>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${MESH_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-cyan-300 hover:underline"
                >
                  <span>Mesh.sol</span>
                  <span className="text-slate-500">{MESH_ADDRESS.slice(0, 6)}...{MESH_ADDRESS.slice(-4)}</span>
                </a>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${SPACE_ID_REGISTRAR_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-cyan-300 hover:underline"
                >
                  <span>SPACE ID Registrar</span>
                  <span className="text-slate-500">{SPACE_ID_REGISTRAR_ADDRESS.slice(0, 6)}...{SPACE_ID_REGISTRAR_ADDRESS.slice(-4)}</span>
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
