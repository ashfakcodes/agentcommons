import React, { useEffect, useRef, useState } from 'react';
import { 
  Network, Search, ZoomIn, ZoomOut, RotateCcw, Zap, 
  ShieldCheck, ArrowRight, ExternalLink, Sparkles, CheckCircle2, Info
} from 'lucide-react';
import { AgentNode, MeshEdge } from '../types';
import { ForceDirectedMesh } from '../utils/meshPhysics';
import { CAPABILITIES, MESH_ADDRESS, BSC_CONFIG } from '../constants/contracts';

interface MeshViewProps {
  agents: AgentNode[];
  edges: MeshEdge[];
  activeAgent: AgentNode;
  onSendPing: (fromTokenId: number, toTokenId: number) => void;
  onSelectAgentForPassport: (agent: AgentNode) => void;
}

export const MeshView: React.FC<MeshViewProps> = ({
  agents,
  edges,
  activeAgent,
  onSendPing,
  onSelectAgentForPassport,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meshRef = useRef<ForceDirectedMesh | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(agents[0]);
  const [search, setSearch] = useState('');
  const [isPinging, setIsPinging] = useState(false);
  const [pingSuccessMessage, setPingSuccessMessage] = useState<string | null>(null);

  // Initialize and mount Canvas Force-Directed Mesh
  useEffect(() => {
    if (!canvasRef.current) return;

    const mesh = new ForceDirectedMesh(agents, edges, (node) => {
      setSelectedAgent(node);
    });

    mesh.attach(canvasRef.current);
    meshRef.current = mesh;

    const handleResize = () => mesh.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mesh.detach();
    };
  }, [agents, edges]);

  // Handle agent search selection
  const handleSearchSelect = (agentName: string) => {
    const target = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
    if (target && meshRef.current) {
      setSelectedAgent(target);
      meshRef.current.selectedNodeId = target.id;
      // Center camera on node
      const nodePoint = meshRef.current.nodes.find((n) => n.id === target.id);
      if (nodePoint) {
        meshRef.current.panX = -nodePoint.x;
        meshRef.current.panY = -nodePoint.y;
      }
    }
  };

  // Zoom controls
  const handleZoom = (factor: number) => {
    if (meshRef.current) {
      meshRef.current.zoom = Math.max(0.4, Math.min(3.5, meshRef.current.zoom * factor));
    }
  };

  const handleResetCamera = () => {
    if (meshRef.current) {
      meshRef.current.panX = 0;
      meshRef.current.panY = 0;
      meshRef.current.zoom = 1;
    }
  };

  // 1-Click Ping / Reciprocate Handshake with scarlet.ai or selected agent
  const handleTriggerPing = async () => {
    if (!selectedAgent) return;
    setIsPinging(true);
    setPingSuccessMessage(null);

    await new Promise((res) => setTimeout(res, 900));

    // Call onSendPing to add edge to state
    onSendPing(activeAgent.tokenId, selectedAgent.tokenId);

    // Also update canvas mesh live
    if (meshRef.current) {
      meshRef.current.addHandshake(activeAgent.tokenId, selectedAgent.tokenId);
    }

    setIsPinging(false);
    setPingSuccessMessage(
      `Reciprocal Handshake Established between ${activeAgent.name} and ${selectedAgent.name}! Canonical key registered on-chain.`
    );

    setTimeout(() => setPingSuccessMessage(null), 5000);
  };

  // Check if mutual connection already exists between activeAgent and selectedAgent
  const hasMutualWithActive = edges.some(
    (e) =>
      e.isMutual &&
      ((e.fromTokenId === activeAgent.tokenId && e.toTokenId === selectedAgent?.tokenId) ||
        (e.fromTokenId === selectedAgent?.tokenId && e.toTokenId === activeAgent.tokenId))
  );

  return (
    <div className="space-y-4">
      {/* Mesh Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f121d] border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-400">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>The Citizen Mesh (AgentCommonsMesh.sol)</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-700 font-mono">
                Canonical Edges
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Interactive 3D/2D node graph visualizing verified Space ID `.ai` agents and golden glowing reciprocal handshakes.
            </p>
          </div>
        </div>

        {/* Quick Search */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find agent node..."
              className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 font-mono w-44 sm:w-56"
            />
          </div>

          <a
            href={`${BSC_CONFIG.blockExplorerUrl}/address/${MESH_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300 hover:text-amber-300 transition-colors"
          >
            <span>Mesh Contract</span>
            <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
          </a>
        </div>
      </div>

      {/* Main Canvas & Inspection Layout */}
      <div className="relative grid grid-cols-1 lg:grid-cols-4 gap-4 h-[680px]">
        {/* Canvas Visualizer (3 Cols on desktop) */}
        <div className="relative lg:col-span-3 bg-[#08090d] rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col">
          
          {/* Subtle Grid / Canvas */}
          <div className="absolute inset-0 cyber-grid-bg opacity-30 pointer-events-none" />
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-grab active:cursor-grabbing z-10"
          />

          {/* Floating Canvas Controls */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 p-1.5 rounded-xl backdrop-blur-md">
            <button
              onClick={() => handleZoom(1.2)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleZoom(0.8)}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetCamera}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
              title="Center View"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Graph Legend Overlay */}
          <div className="absolute top-4 left-4 z-20 hidden sm:flex items-center gap-3 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-xl text-[11px] font-mono backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm" />
              <span className="text-slate-300">Genesis Node (scarlet.ai)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" />
              <span className="text-amber-300">Reciprocal Golden Edge</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-sm" />
              <span className="text-cyan-300">Space ID Agent</span>
            </div>
          </div>

          {/* Toast Notification for Handshake */}
          {pingSuccessMessage && (
            <div className="absolute top-4 right-4 z-30 max-w-md p-3 rounded-xl bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 text-xs font-mono shadow-2xl flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{pingSuccessMessage}</span>
            </div>
          )}
        </div>

        {/* Selected Node Inspector Drawer (1 Col) */}
        <div className="bg-[#0f121d] border border-slate-800 rounded-2xl p-4 overflow-y-auto space-y-4 flex flex-col justify-between shadow-xl">
          {selectedAgent ? (
            <div className="space-y-4">
              {/* Agent Badge & Avatar */}
              <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center font-mono font-extrabold text-lg ${
                    selectedAgent.isGenesis
                      ? 'bg-gradient-to-tr from-rose-600 to-amber-600 text-white ring-2 ring-rose-400 shadow-lg'
                      : 'bg-gradient-to-tr from-cyan-600 to-purple-600 text-white'
                  }`}
                >
                  {selectedAgent.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-base font-mono text-white">
                      {selectedAgent.name}
                    </h3>
                    <span className="text-xs text-amber-400 font-mono">
                      #{selectedAgent.tokenId}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Space ID Soulbound</span>
                  </div>
                </div>
              </div>

              {/* Bio & Details */}
              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedAgent.bio}
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500">Reputation</span>
                  <p className="text-sm font-bold text-amber-300">{selectedAgent.reputationScore}%</p>
                </div>
                <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500">Mesh Peers</span>
                  <p className="text-sm font-bold text-cyan-300">{selectedAgent.peersCount} Connected</p>
                </div>
              </div>

              {/* Capabilities Bitmask Badges */}
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1.5">
                  CAPABILITY BITMASK (0x{selectedAgent.capabilities.toString(16).padStart(2, '0')})
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CAPABILITIES).map(([bitStr, cap]) => {
                    const hasCap = (selectedAgent.capabilities & Number(bitStr)) !== 0;
                    if (!hasCap) return null;
                    return (
                      <span
                        key={bitStr}
                        className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/80"
                      >
                        {cap.tag}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* BSC Address */}
              <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] font-mono space-y-1">
                <span className="text-slate-400">Owner Wallet Address:</span>
                <p className="text-slate-200 truncate">{selectedAgent.owner}</p>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-2">
                {selectedAgent.tokenId !== activeAgent.tokenId && (
                  <button
                    onClick={handleTriggerPing}
                    disabled={isPinging}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-bold text-xs shadow-gold-glow flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      {hasMutualWithActive
                        ? 'Ping Handshake (Renew Mutual)'
                        : `Ping ${selectedAgent.name} (Auto-Reciprocate)`}
                    </span>
                  </button>
                )}

                <button
                  onClick={() => onSelectAgentForPassport(selectedAgent)}
                  className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-colors flex items-center justify-center gap-1"
                >
                  <span>View Full Soulbound Passport</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <span>Click any node in the mesh graph to inspect credentials.</span>
            </div>
          )}

          {/* Canonical Edge Specification Footer */}
          <div className="border-t border-slate-800 pt-3 text-[10px] font-mono text-slate-500">
            <span>Canonical Key: keccak256(min(A,B), max(A,B))</span>
          </div>
        </div>
      </div>
    </div>
  );
};
