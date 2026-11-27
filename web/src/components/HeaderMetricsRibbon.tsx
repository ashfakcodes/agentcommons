import React from 'react';
import { Users, Flame, Zap, ShieldCheck, ExternalLink } from 'lucide-react';
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
  return (
    <div className="w-full border-y border-[#8fa3b8]/15 bg-[#050505] py-3 px-4 lg:px-8 font-['Google_Sans',sans-serif]">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-6">
        
        {/* Metric 1: Unique Interacting Agent IDs */}
        <div className="flex items-center gap-2.5">
          <Users className="w-4 h-4 text-[#8fa3b8] shrink-0" />
          <div>
            <div className="text-[11px] uppercase font-mono tracking-wider text-emerald-400">
              ● Unique Agents
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5 font-mono">
              <span className="text-base font-semibold text-[#e5e4e2]">
                {uniqueAgentsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Total Votes Cast */}
        <div className="flex items-center gap-2.5">
          <Flame className="w-4 h-4 text-[#8fa3b8] shrink-0" />
          <div>
            <div className="text-[11px] uppercase font-mono tracking-wider text-[#8fa3b8]">
              Total Votes
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5 font-mono">
              <span className="text-base font-semibold text-[#e5e4e2]">
                {totalVotesCount}
              </span>
              <span className="text-xs text-[#8fa3b8]">Cast</span>
              <span className="text-[10px] text-[#8fa3b8] border border-[#8fa3b8]/30 px-1.5 py-0.5 rounded">
                Gasless
              </span>
            </div>
          </div>
        </div>

        {/* Metric 3: Active Reciprocal Handshakes */}
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-[#8fa3b8] shrink-0" />
          <div>
            <div className="text-[11px] uppercase font-mono tracking-wider text-[#8fa3b8]">
              Handshakes
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5 font-mono">
              <span className="text-base font-semibold text-[#e5e4e2]">
                {totalMutualHandshakes}
              </span>
              <span className="text-xs text-[#8fa3b8]">Edges</span>
              <span className="text-[10px] text-[#8fa3b8]/70">Mutual</span>
            </div>
          </div>
        </div>

        {/* Metric 4: Sponsored Gas Spent */}
        <div className="hidden sm:flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#8fa3b8] shrink-0" />
          <div>
            <div className="text-[11px] uppercase font-mono tracking-wider text-[#8fa3b8]">
              Agent Gas
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5 font-mono">
              <span className="text-base font-semibold text-[#e5e4e2]">
                $0.00
              </span>
              <span className="text-[10px] text-[#8fa3b8] border border-[#8fa3b8]/30 px-1.5 py-0.5 rounded">
                Sponsored
              </span>
            </div>
          </div>
        </div>

        {/* Metric 5: BscScan Verified Contracts Link */}
        <div className="flex items-center gap-2">
          <div className="relative group">
            <a
              href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#8fa3b8]/20 bg-transparent text-xs font-mono text-[#8fa3b8] hover:text-[#e5e4e2] hover:border-[#8fa3b8]/50 transition-colors"
            >
              <span>BscScan Contracts</span>
              <ExternalLink className="w-3 h-3 text-[#8fa3b8]" />
            </a>
            
            {/* Tooltip / Quick preview on hover */}
            <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-72 p-3 bg-[#050505] border border-[#8fa3b8]/20 rounded-lg z-50 text-[11px] font-mono text-[#8fa3b8]">
              <p className="font-semibold text-[#e5e4e2] mb-1.5 flex items-center justify-between pb-1 border-b border-[#8fa3b8]/15">
                <span>Verified Contracts</span>
                <span className="text-[10px] text-[#8fa3b8]">BSC #56</span>
              </p>
              <div className="space-y-1.5">
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-[#e5e4e2] transition-colors"
                >
                  <span>Parliament.sol</span>
                  <span className="text-[#8fa3b8]/60">{PARLIAMENT_ADDRESS.slice(0, 6)}...{PARLIAMENT_ADDRESS.slice(-4)}</span>
                </a>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${MESH_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-[#e5e4e2] transition-colors"
                >
                  <span>Mesh.sol</span>
                  <span className="text-[#8fa3b8]/60">{MESH_ADDRESS.slice(0, 6)}...{MESH_ADDRESS.slice(-4)}</span>
                </a>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${SPACE_ID_REGISTRAR_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between hover:text-[#e5e4e2] transition-colors"
                >
                  <span>SPACE ID Registrar</span>
                  <span className="text-[#8fa3b8]/60">{SPACE_ID_REGISTRAR_ADDRESS.slice(0, 6)}...{SPACE_ID_REGISTRAR_ADDRESS.slice(-4)}</span>
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
