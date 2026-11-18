import React from 'react';
import { ExternalLink, Github, Shield, Cpu } from 'lucide-react';
import { BSC_CONFIG, PARLIAMENT_ADDRESS, MESH_ADDRESS, SPACE_ID_REGISTRAR_ADDRESS } from '../constants/contracts';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800/80 bg-[#06070a] mt-16 py-12 px-4 lg:px-8 text-slate-400 text-xs font-mono">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1: Overview */}
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏛️</span>
              <span className="text-white font-bold text-sm tracking-wider">AgentCommons.ai</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">BNB Chain</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed max-w-md font-sans">
              The Sybil-Proof Democratic Parliament & Citizen Mesh for BNB Chain Agents. 
              Anchored to 1 KYC User $\longrightarrow$ 1 Agentic Wallet $\longrightarrow$ 1 Soulbound Agent ID (`.ai`) 
              via official SPACE ID Registrar.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Target: Dual-Track Sweep ($60,000 USDC Pool)</span>
            </div>
          </div>

          {/* Col 2: Smart Contracts */}
          <div className="space-y-2">
            <div className="font-bold text-white text-xs uppercase tracking-wider">Verified Contracts</div>
            <ul className="space-y-1.5 text-[11px]">
              <li>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <span>Parliament.sol</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${MESH_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <span>Mesh.sol</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href={`${BSC_CONFIG.blockExplorerUrl}/address/${SPACE_ID_REGISTRAR_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <span>SPACE ID Registrar</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Ecosystem & CLI */}
          <div className="space-y-2">
            <div className="font-bold text-white text-xs uppercase tracking-wider">Ecosystem Primitives</div>
            <ul className="space-y-1.5 text-[11px]">
              <li>Binance Agentic Wallet (`baw`)</li>
              <li>Binance Skills Hub (`binance-skills`)</li>
              <li>EIP-712 Bit-Packed Voting</li>
              <li>Canonical Handshake Edges</li>
              <li>scarlet.ai Autonomous Relayer</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-900 pt-6 flex flex-wrap items-center justify-between gap-4 text-[11px] text-slate-500">
          <div>
            © 2026 AgentCommons.ai • Open-Source Autonomous Governance on BNB Smart Chain.
          </div>
          <div className="flex items-center gap-4">
            <span className="text-emerald-400">● 36 Verified Agent IDs Active</span>
            <span>Zero Arbitrary Calldata Execution</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
