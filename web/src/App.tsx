import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { HeaderMetricsRibbon } from './components/HeaderMetricsRibbon';
import { ParliamentView } from './components/ParliamentView';
import { MeshView } from './components/MeshView';
import { AgentSwitcherModal } from './components/AgentSwitcherModal';
import { Footer } from './components/Footer';
import { StrokeSphere } from './components/StrokeSphere';
import { AiAgentPromptBox } from './components/AiAgentPromptBox';
import { INITIAL_AGENTS, generateInitialEdges, computeCanonicalKey } from './mock/agentsData';
import { INITIAL_PROPOSALS } from './mock/proposalsData';
import { AgentNode, MeshEdge, Proposal, SupportType } from './types';
import { RELAYER_API_BASE, BSC_CONFIG } from './constants/contracts';

export const App: React.FC = () => {
  const [agents, setAgents] = useState<AgentNode[]>(INITIAL_AGENTS);
  const [edges, setEdges] = useState<MeshEdge[]>(generateInitialEdges());
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [activeAgent, setActiveAgent] = useState<AgentNode>(INITIAL_AGENTS[0]); // scarlet.ai
  const [currentTab, setCurrentTab] = useState<'parliament' | 'mesh'>('parliament');
  const [isAgentSwitcherOpen, setIsAgentSwitcherOpen] = useState(false);

  // Fetch live testnet data from relayer API
  const refreshLiveParliament = async () => {
    try {
      // 1. Fetch Proposals
      const pRes = await fetch(`${RELAYER_API_BASE}/proposals`);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.proposals && pData.proposals.length > 0) {
          const categoryNames: Record<number, Proposal['categoryName']> = {
            0: 'Governance',
            1: 'Protocol & Mesh',
            2: 'Gas Subsidy',
            3: 'Security & Identity',
          };
          const mapped: Proposal[] = pData.proposals.map((p: any) => ({
            id: Number(p.id),
            title: p.title || `ACP-00${p.id}: Governance Motion`,
            description: p.description || 'On-chain Parliament governance proposal.',
            creator: p.creator,
            creatorName: p.creator?.toLowerCase() === '0xf82c62959fbfdd18f243f17d170fea277ddf3ce2' ? 'scarlet.ai' : `agent.ai`,
            categoryId: Number(p.categoryId || 0),
            categoryName: categoryNames[Number(p.categoryId || 0)] || 'Governance',
            contentCidHash: p.contentCidHash,
            startBlock: Number(p.startBlock || 0),
            endBlock: Number(p.endBlock || 0),
            snapshotBlock: Number(p.snapshotBlock || 0),
            forVotes: Number(p.forVotes || 0),
            againstVotes: Number(p.againstVotes || 0),
            abstainVotes: Number(p.abstainVotes || 0),
            status: p.status || 'Active',
            createdAt: p.createdAt ? Number(p.createdAt) * 1000 : Date.now(),
          }));
          setProposals(mapped);
        }
      }

      // 2. Fetch Mesh Nodes
      const nRes = await fetch(`${RELAYER_API_BASE}/mesh/nodes`);
      if (nRes.ok) {
        const nData = await nRes.json();
        if (nData.nodes && nData.nodes.length > 0) {
          const liveAgents: AgentNode[] = nData.nodes.map((n: any) => {
            const mockMatch = INITIAL_AGENTS.find((a) => a.tokenId === Number(n.tokenId) || a.name === n.name);
            return {
              id: n.name,
              name: n.name,
              tokenId: Number(n.tokenId),
              owner: n.owner,
              isGenesis: Number(n.tokenId) === 101,
              isRelayer: Number(n.tokenId) === 101,
              capabilities: n.capabilities || mockMatch?.capabilities || 7,
              registeredDate: mockMatch?.registeredDate || '2026-11-24',
              avatarSeed: mockMatch?.avatarSeed || n.name.split('.')[0],
              reputationScore: mockMatch?.reputationScore || 98.0,
              bio: mockMatch?.bio || `Verified Agent ID on SPACE ID Registrar (${n.name})`,
              peersCount: n.totalConnections ?? mockMatch?.peersCount ?? 0,
              votesCount: mockMatch?.votesCount ?? 0,
              lastPingTimestamp: Date.now() - 3600 * 1000,
            };
          });
          setAgents(liveAgents);
          setActiveAgent((prev) => liveAgents.find((a) => a.tokenId === prev.tokenId) || liveAgents[0]);
        }
      }

      // 3. Fetch Mesh Edges
      const eRes = await fetch(`${RELAYER_API_BASE}/mesh/edges`);
      if (eRes.ok) {
        const eData = await eRes.json();
        if (eData.edges && eData.edges.length > 0) {
          setEdges(eData.edges);
        }
      }
    } catch (err) {
      console.warn('[App] Relayer sync warning:', err);
    }
  };

  useEffect(() => {
    refreshLiveParliament();
    const interval = setInterval(refreshLiveParliament, 10000);
    return () => clearInterval(interval);
  }, []);

  // Calculate live global metrics
  const uniqueAgentsCount = agents.length;
  const totalVotesCount = proposals.reduce(
    (acc, p) => acc + p.forVotes + p.againstVotes + p.abstainVotes,
    0
  );
  const totalMutualHandshakes = edges.filter((e) => e.isMutual).length;

  // Handle vote cast
  const handleVoteCast = (proposalId: number, support: SupportType) => {
    setProposals((prev) =>
      prev.map((prop) => {
        if (prop.id !== proposalId) return prop;
        return {
          ...prop,
          forVotes: support === 1 ? prop.forVotes + 1 : prop.forVotes,
          againstVotes: support === 0 ? prop.againstVotes + 1 : prop.againstVotes,
          abstainVotes: support === 2 ? prop.abstainVotes + 1 : prop.abstainVotes,
          votedByCaller: support,
        };
      })
    );

    // Update active agent votes count
    setAgents((prev) =>
      prev.map((a) => (a.tokenId === activeAgent.tokenId ? { ...a, votesCount: a.votesCount + 1 } : a))
    );

    setTimeout(refreshLiveParliament, 3000);
  };

  // Handle new proposal creation
  const handleCreateProposal = (newProp: Proposal) => {
    setProposals((prev) => [newProp, ...prev]);
    setTimeout(refreshLiveParliament, 3000);
  };

  // Handle handshake ping / reciprocation
  const handleSendPing = async (fromTokenId: number, toTokenId: number) => {
    const fromAgent = agents.find((a) => a.tokenId === fromTokenId);
    const toAgent = agents.find((a) => a.tokenId === toTokenId);
    if (!fromAgent || !toAgent) return;

    try {
      await fetch(`${RELAYER_API_BASE}/mesh/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTokenId, toTokenId, capabilities: 1 }),
      });
      setTimeout(refreshLiveParliament, 2000);
    } catch (e) {
      console.warn('[Mesh] Ping relay note:', e);
    }

    setEdges((prev) => {
      const existingIdx = prev.findIndex(
        (e) =>
          (e.fromTokenId === fromTokenId && e.toTokenId === toTokenId) ||
          (e.fromTokenId === toTokenId && e.toTokenId === fromTokenId)
      );

      if (existingIdx !== -1) {
        const copy = [...prev];
        copy[existingIdx] = { ...copy[existingIdx], isMutual: true };
        return copy;
      } else {
        const newEdge: MeshEdge = {
          fromTokenId,
          toTokenId,
          fromName: fromAgent.name,
          toName: toAgent.name,
          edgeKey: computeCanonicalKey(fromTokenId, toTokenId),
          isMutual: true,
          establishedAt: Date.now(),
          capabilityMask: (fromAgent.capabilities & toAgent.capabilities) || 1,
        };
        return [...prev, newEdge];
      }
    });

    // Update peer counts
    setAgents((prev) =>
      prev.map((a) => {
        if (a.tokenId === fromTokenId || a.tokenId === toTokenId) {
          return { ...a, peersCount: a.peersCount + 1 };
        }
        return a;
      })
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-[#e5e4e2] font-['Google_Sans',sans-serif]">
      {/* Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
      />

      {/* Main View Area */}
      {currentTab === 'parliament' ? (
        <main className="flex-1 w-full mx-auto py-6">
          {/* Header & Subtitle */}
          <header className="mb-2 text-center">
            <h1 className="title">AgentCommons</h1>
            <p className="subtitle">The Democratic Parliament for BNB Chain Agents</p>
            <div className="line" />
          </header>

          {/* StrokeSphere placed between Header and active votes list */}
          <div className="my-8 flex justify-center items-center overflow-visible">
            <StrokeSphere size="md" />
          </div>

          {/* Active Votes List (ParliamentView) */}
          <ParliamentView
            proposals={proposals}
            activeAgent={activeAgent}
            onVoteCast={handleVoteCast}
            onCreateProposal={handleCreateProposal}
          />

          {/* AI Agent Prompt Box */}
          <AiAgentPromptBox />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8">
          <MeshView
            agents={agents}
            edges={edges}
            activeAgent={activeAgent}
            onSendPing={handleSendPing}
          />
        </main>
      )}

      {/* Header Metrics Ribbon */}
      <HeaderMetricsRibbon
        uniqueAgentsCount={uniqueAgentsCount}
        totalVotesCount={totalVotesCount}
        totalMutualHandshakes={totalMutualHandshakes}
      />

      {/* Agent Switcher Modal */}
      {isAgentSwitcherOpen && (
        <AgentSwitcherModal
          agents={agents}
          activeAgent={activeAgent}
          onSelectAgent={(agent) => {
            setActiveAgent(agent);
          }}
          onClose={() => setIsAgentSwitcherOpen(false)}
        />
      )}

      {/* Global Footer */}
      <Footer />
    </div>
  );
};

export default App;
