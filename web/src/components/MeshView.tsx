import React, { useEffect, useRef, useState } from 'react';
import { 
  Network, Search, ZoomIn, ZoomOut, RotateCcw, Zap, 
  ShieldCheck, ExternalLink, CheckCircle2, Info, Loader2
} from 'lucide-react';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { AgentNode, MeshEdge } from '../types';
import { ForceDirectedMesh } from '../utils/meshPhysics';
import {
  CAPABILITIES,
  MESH_ADDRESS,
  SPACE_ID_REGISTRAR_ADDRESS,
  BSC_CONFIG,
  MESH_ABI,
  SPACE_ID_REGISTRAR_ABI,
} from '../constants/contracts';

interface MeshViewProps {
  agents: AgentNode[];
  edges: MeshEdge[];
  activeAgent: AgentNode;
  onSendPing: (fromTokenId: number | string, toTokenId: number | string) => void;
}

export const MeshView: React.FC<MeshViewProps> = ({
  agents,
  edges,
  activeAgent,
  onSendPing,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meshRef = useRef<ForceDirectedMesh | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(agents[0]);
  const [search, setSearch] = useState('');
  const [isPinging, setIsPinging] = useState(false);
  const [pingSuccessMessage, setPingSuccessMessage] = useState<string | null>(null);
  const [isProbingMesh, setIsProbingMesh] = useState(false);
  const [onChainMeshState, setOnChainMeshState] = useState<{
    tokenId: string;
    ownerOf: string | null;
    meshOperator: string | null;
    totalConnections: number | null;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setOnChainMeshState(null);
  }, [selectedAgent?.tokenId]);

  const handleProbeOnChainMesh = async () => {
    if (!selectedAgent) return;
    setIsProbingMesh(true);
    setOnChainMeshState(null);
    try {
      const client = createPublicClient({
        chain: bsc,
        transport: http(BSC_CONFIG.rpcUrl),
      });
      const tid = BigInt(selectedAgent.tokenId);
      const [ownerRes, opRes, connRes] = await Promise.allSettled([
        client.readContract({
          address: SPACE_ID_REGISTRAR_ADDRESS as `0x${string}`,
          abi: SPACE_ID_REGISTRAR_ABI,
          functionName: 'ownerOf',
          args: [tid],
        }),
        client.readContract({
          address: MESH_ADDRESS as `0x${string}`,
          abi: MESH_ABI,
          functionName: 'meshOperators',
          args: [tid],
        }),
        client.readContract({
          address: MESH_ADDRESS as `0x${string}`,
          abi: MESH_ABI,
          functionName: 'totalConnections',
          args: [tid],
        }),
      ]);

      setOnChainMeshState({
        tokenId: String(selectedAgent.tokenId),
        ownerOf: ownerRes.status === 'fulfilled' ? String(ownerRes.value) : null,
        meshOperator: opRes.status === 'fulfilled' ? String(opRes.value) : null,
        totalConnections: connRes.status === 'fulfilled' ? Number(connRes.value) : null,
      });
    } catch (err: any) {
      setOnChainMeshState({
        tokenId: String(selectedAgent.tokenId),
        ownerOf: null,
        meshOperator: null,
        totalConnections: null,
        error: err?.shortMessage || err?.message || 'RPC probe failed',
      });
    } finally {
      setIsProbingMesh(false);
    }
  };

  // Keep selectedAgent refreshed when live nodes update
  useEffect(() => {
    if (agents.length === 0) return;
    setSelectedAgent((prev) => {
      if (!prev) return agents[0];
      return agents.find((a) => String(a.tokenId) === String(prev.tokenId)) || agents[0];
    });
  }, [agents]);

  // Initialize and mount Canvas Force-Directed Mesh
  useEffect(() => {
    if (!canvasRef.current) return;

    const mesh = new ForceDirectedMesh(agents, edges, (node) => {
      const latestNode =
        agents.find((a) => String(a.tokenId) === String(node.tokenId)) || node;
      setSelectedAgent(latestNode);
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
    const q = agentName.trim().toLowerCase();
    if (!q) return;
    const target =
      agents.find((a) => a.name.toLowerCase() === q) ||
      agents.find((a) => a.name.toLowerCase().includes(q) || String(a.tokenId).includes(q));
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
      ((String(e.fromTokenId) === String(activeAgent.tokenId) && String(e.toTokenId) === String(selectedAgent?.tokenId)) ||
        (String(e.fromTokenId) === String(selectedAgent?.tokenId) && String(e.toTokenId) === String(activeAgent.tokenId)))
  );

  const formatTokenId = (tid: number | string) => {
    const str = String(tid);
    return str.length > 14 ? `${str.slice(0, 6)}...${str.slice(-4)}` : str;
  };

  return (
    <div className="space-y-4">
      {/* Mesh Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#050505] border border-[#8fa3b8]/20 p-4 rounded-lg font-['Google_Sans',sans-serif]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-[#8fa3b8]/10 border border-[#8fa3b8]/20 text-[#8fa3b8]">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#e5e4e2] flex items-center gap-2">
              <span>The Citizen Mesh</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#8fa3b8]/30 text-[#8fa3b8] font-mono">
                Canonical Edges
              </span>
            </h2>
            <p className="text-xs text-[#8fa3b8] mt-0.5">
              Interactive node graph visualizing verified Space ID .ai agents and reciprocal handshakes.
            </p>
          </div>
        </div>

        {/* Quick Search */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8fa3b8] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                handleSearchSelect(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearchSelect(search);
              }}
              placeholder="Find agent node..."
              className="pl-7 pr-3 py-1.5 bg-[#050505] border border-[#8fa3b8]/20 rounded-md text-xs text-[#e5e4e2] placeholder:text-[#8fa3b8]/50 focus:outline-none focus:border-[#8fa3b8]/50 font-mono w-44 sm:w-56"
            />
          </div>

          <a
            href={`${BSC_CONFIG.blockExplorerUrl}/address/${MESH_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-transparent hover:bg-[#8fa3b8]/10 border border-[#8fa3b8]/20 hover:border-[#8fa3b8]/50 text-xs font-mono text-[#8fa3b8] hover:text-[#e5e4e2] transition-colors"
          >
            <span>Mesh Contract</span>
            <ExternalLink className="w-3 h-3 text-[#8fa3b8]" />
          </a>
        </div>
      </div>

      {/* Main Canvas & Inspection Layout */}
      <div className="relative grid grid-cols-1 lg:grid-cols-4 gap-4 h-[680px]">
        {/* Canvas Visualizer (3 Cols on desktop) */}
        <div className="relative lg:col-span-3 bg-[#050505] rounded-lg border border-[#8fa3b8]/20 overflow-hidden flex flex-col">
          
          {/* Subtle Grid / Canvas */}
          <div className="absolute inset-0 cyber-grid-bg opacity-30 pointer-events-none" />
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-grab active:cursor-grabbing z-10"
          />

          {/* Floating Canvas Controls */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 bg-[#050505]/90 border border-[#8fa3b8]/20 p-1.5 rounded-md backdrop-blur-sm">
            <button
              onClick={() => handleZoom(1.2)}
              className="p-1.5 rounded text-[#8fa3b8] hover:text-[#e5e4e2] hover:bg-[#8fa3b8]/10"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleZoom(0.8)}
              className="p-1.5 rounded text-[#8fa3b8] hover:text-[#e5e4e2] hover:bg-[#8fa3b8]/10"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetCamera}
              className="p-1.5 rounded text-[#8fa3b8] hover:text-[#e5e4e2] hover:bg-[#8fa3b8]/10"
              title="Center View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Graph Legend Overlay */}
          <div className="absolute top-4 left-4 z-20 hidden sm:flex items-center gap-3 bg-[#050505]/90 border border-[#8fa3b8]/20 px-3 py-1.5 rounded-md text-[11px] font-mono backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span className="text-[#8fa3b8]">Genesis Node (scarlet.ai)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#e5e4e2]" />
              <span className="text-[#e5e4e2]">Mutual Edge</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#8fa3b8]" />
              <span className="text-[#8fa3b8]">Space ID Agent</span>
            </div>
          </div>

          {/* Toast Notification for Handshake */}
          {pingSuccessMessage && (
            <div className="absolute top-4 right-4 z-30 max-w-md p-2.5 rounded-md bg-[#050505] border border-[#8fa3b8]/30 text-[#e5e4e2] text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{pingSuccessMessage}</span>
            </div>
          )}
        </div>

        {/* Selected Node Inspector Drawer (1 Col) */}
        <div className="bg-[#050505] border border-[#8fa3b8]/20 rounded-lg p-4 overflow-y-auto space-y-4 flex flex-col justify-between font-['Google_Sans',sans-serif]">
          {selectedAgent ? (
            <div className="space-y-4">
              {/* Agent Badge & Avatar */}
              <div className="flex items-center gap-3 border-b border-[#8fa3b8]/15 pb-3">
                <div className="w-10 h-10 rounded-md bg-[#8fa3b8]/10 border border-[#8fa3b8]/25 flex items-center justify-center font-mono font-bold text-base text-[#e5e4e2]">
                  {selectedAgent.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-sm font-mono text-[#e5e4e2]">
                      {selectedAgent.name}
                    </h3>
                    <a
                      href={`${BSC_CONFIG.blockExplorerUrl}/token/${SPACE_ID_REGISTRAR_ADDRESS}?a=${selectedAgent.tokenId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[11px] text-cyan-400 hover:underline font-mono"
                      title={`View SPACE ID NFT #${selectedAgent.tokenId} on BscScan`}
                    >
                      <span>#{formatTokenId(selectedAgent.tokenId)}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-[#8fa3b8] font-mono mt-0.5">
                    <ShieldCheck className="w-3 h-3 text-[#8fa3b8]" />
                    <span>Space ID Soulbound</span>
                  </div>
                </div>
              </div>

              {/* Bio & Details */}
              <p className="text-xs text-[#8fa3b8] leading-relaxed">
                {selectedAgent.bio}
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 bg-[#8fa3b8]/05 rounded-md border border-[#8fa3b8]/15">
                  <span className="text-[10px] text-[#8fa3b8]/70">Reputation</span>
                  <p className="text-sm font-semibold text-[#e5e4e2]">{selectedAgent.reputationScore}%</p>
                </div>
                <div className="p-2 bg-[#8fa3b8]/05 rounded-md border border-[#8fa3b8]/15">
                  <span className="text-[10px] text-[#8fa3b8]/70">Mesh Peers</span>
                  <p className="text-sm font-semibold text-[#e5e4e2]">
                    {Math.max(
                      selectedAgent.peersCount || 0,
                      edges.filter(
                        (e) =>
                          e.isMutual &&
                          (String(e.fromTokenId) === String(selectedAgent.tokenId) ||
                            String(e.toTokenId) === String(selectedAgent.tokenId))
                      ).length
                    )}{' '}
                    Connected
                  </p>
                </div>
              </div>

              {/* Capabilities Bitmask Inspector */}
              <div>
                <label className="block text-[11px] font-mono text-[#8fa3b8] mb-1.5">
                  CAPABILITY INSPECTOR (0x{selectedAgent.capabilities.toString(16).padStart(2, '0')})
                </label>
                <div className="space-y-1">
                  {Object.entries(CAPABILITIES).map(([bitStr, cap]) => {
                    const hasCap = (selectedAgent.capabilities & Number(bitStr)) !== 0;
                    return (
                      <div
                        key={bitStr}
                        className={`px-2 py-1 rounded text-[10px] font-mono border flex items-center justify-between gap-2 ${
                          hasCap
                            ? 'text-[#e5e4e2] border-emerald-500/30 bg-emerald-950/10'
                            : 'text-[#8fa3b8]/45 border-white/5 bg-transparent'
                        }`}
                        title={cap.description}
                      >
                        <span className="truncate">{cap.tag}</span>
                        <span className={hasCap ? 'text-emerald-400 shrink-0' : 'text-[#8fa3b8]/40 shrink-0'}>
                          {hasCap ? 'ENABLED' : 'OFF'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* BSC Address & Live Contract Probe */}
              <div className="p-2 bg-[#8fa3b8]/05 rounded-md border border-[#8fa3b8]/15 text-[11px] font-mono space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#8fa3b8]/70">Owner Wallet Address:</span>
                  <a
                    href={`${BSC_CONFIG.blockExplorerUrl}/address/${selectedAgent.owner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-cyan-400 hover:underline text-[10px]"
                  >
                    <span>BscScan</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <p className="text-[#e5e4e2] truncate">{selectedAgent.owner}</p>

                <button
                  type="button"
                  onClick={handleProbeOnChainMesh}
                  disabled={isProbingMesh}
                  className="w-full mt-1 py-1.5 rounded border border-[#F0B90B]/30 bg-[#F0B90B]/5 hover:bg-[#F0B90B]/10 text-[#F0B90B] text-[10px] font-mono flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isProbingMesh ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Querying BSC Mesh Contract...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3 h-3" />
                      <span>Verify On-Chain Mesh &amp; Operator</span>
                    </>
                  )}
                </button>

                {onChainMeshState && onChainMeshState.tokenId === String(selectedAgent.tokenId) && (
                  <div className="pt-1.5 border-t border-white/5 text-[10px] space-y-0.5 text-[#8fa3b8]">
                    {onChainMeshState.error ? (
                      <p className="text-rose-400">{onChainMeshState.error}</p>
                    ) : (
                      <>
                        <p className="truncate">
                          ownerOf: <span className="text-[#e5e4e2]">{onChainMeshState.ownerOf || 'N/A'}</span>
                        </p>
                        <p className="truncate">
                          meshOperator:{' '}
                          <span className="text-[#e5e4e2]">
                            {onChainMeshState.meshOperator &&
                            onChainMeshState.meshOperator !== '0x0000000000000000000000000000000000000000'
                              ? onChainMeshState.meshOperator
                              : 'None (Owner Direct)'}
                          </span>
                        </p>
                        <p>
                          totalConnections:{' '}
                          <span className="text-emerald-400">{onChainMeshState.totalConnections ?? 0}</span>
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Connected Edges & Handshake Receipts */}
              {(() => {
                const nodeEdges = edges.filter(
                  (e) =>
                    String(e.fromTokenId) === String(selectedAgent.tokenId) ||
                    String(e.toTokenId) === String(selectedAgent.tokenId)
                );
                if (nodeEdges.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-mono text-[#8fa3b8]">
                      ON-CHAIN EDGES ({nodeEdges.length})
                    </label>
                    <div className="space-y-1 max-h-28 overflow-y-auto text-[10px] font-mono">
                      {nodeEdges.map((edge) => {
                        const peerName =
                          String(edge.fromTokenId) === String(selectedAgent.tokenId)
                            ? edge.toName
                            : edge.fromName;
                        return (
                          <div
                            key={edge.edgeKey}
                            className="p-1.5 rounded bg-[#050505] border border-white/5 flex items-center justify-between gap-2"
                          >
                            <span className="truncate text-[#e5e4e2]">
                              {peerName}{' '}
                              <span className={edge.isMutual ? 'text-emerald-400' : 'text-[#8fa3b8]'}>
                                ({edge.isMutual ? 'Mutual' : 'Pending'})
                              </span>
                            </span>
                            {edge.txHash ? (
                              <a
                                href={`${BSC_CONFIG.blockExplorerUrl}/tx/${edge.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-cyan-400 hover:underline shrink-0"
                              >
                                <span>Tx</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <span className="text-[#8fa3b8]/50 shrink-0" title={edge.edgeKey}>
                                {edge.edgeKey.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="space-y-2 pt-2">
                {String(selectedAgent.tokenId) !== String(activeAgent.tokenId) && (
                  <button
                    onClick={handleTriggerPing}
                    disabled={isPinging}
                    className="w-full py-2 rounded-md bg-[#8fa3b8]/20 hover:bg-[#8fa3b8]/30 border border-[#8fa3b8]/40 text-[#e5e4e2] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-[#e5e4e2]" />
                    <span>
                      {hasMutualWithActive
                        ? 'Ping Handshake (Renew Mutual)'
                        : `Ping ${selectedAgent.name} (Auto-Reciprocate)`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-[#8fa3b8] text-xs">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-50 text-[#8fa3b8]" />
              <span>Click any node in the mesh graph to inspect credentials.</span>
            </div>
          )}

          {/* Canonical Edge Specification Footer */}
          <div className="border-t border-[#8fa3b8]/15 pt-3 text-[10px] font-mono text-[#8fa3b8]/70">
            <span>Canonical Key: keccak256(min(A,B), max(A,B))</span>
          </div>
        </div>
      </div>
    </div>
  );
};
