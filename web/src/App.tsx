import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeaderMetricsRibbon } from './components/HeaderMetricsRibbon';
import { ParliamentView } from './components/ParliamentView';
import { MeshView } from './components/MeshView';
import { PassportView } from './components/PassportView';
import { AgentSwitcherModal } from './components/AgentSwitcherModal';
import { Footer } from './components/Footer';
import { INITIAL_AGENTS, generateInitialEdges, computeCanonicalKey } from './mock/agentsData';
import { INITIAL_PROPOSALS } from './mock/proposalsData';
import { AgentNode, MeshEdge, Proposal, SupportType } from './types';

export const App: React.FC = () => {
  const [agents, setAgents] = useState<AgentNode[]>(INITIAL_AGENTS);
  const [edges, setEdges] = useState<MeshEdge[]>(generateInitialEdges());
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [activeAgent, setActiveAgent] = useState<AgentNode>(INITIAL_AGENTS[0]); // scarlet.ai
  const [inspectedAgent, setInspectedAgent] = useState<AgentNode>(INITIAL_AGENTS[0]);
  const [currentTab, setCurrentTab] = useState<'parliament' | 'mesh' | 'passport'>('parliament');
  const [isAgentSwitcherOpen, setIsAgentSwitcherOpen] = useState(false);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | undefined>(undefined);

  // Calculate live global metrics
  const uniqueAgentsCount = agents.length; // 36
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
  };

  // Handle new proposal creation
  const handleCreateProposal = (newProp: Proposal) => {
    setProposals((prev) => [newProp, ...prev]);
  };

  // Handle handshake ping / reciprocation
  const handleSendPing = (fromTokenId: number, toTokenId: number) => {
    const fromAgent = agents.find((a) => a.tokenId === fromTokenId);
    const toAgent = agents.find((a) => a.tokenId === toTokenId);
    if (!fromAgent || !toAgent) return;

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

  // Connect Web3 Wallet (MetaMask / Binance Web3 Wallet)
  const handleConnectWallet = async () => {
    if ((window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts',
        });
        if (accounts && accounts[0]) {
          setIsWalletConnected(true);
          setWalletAddress(accounts[0]);
        }
      } catch (err) {
        console.warn('Wallet connection cancelled or rejected', err);
      }
    } else {
      // In simulation mode without browser extension
      setIsWalletConnected(true);
      setWalletAddress(activeAgent.owner);
    }
  };

  // Navigate to passport for a specific agent
  const handleSelectAgentForPassport = (agent: AgentNode) => {
    setInspectedAgent(agent);
    setCurrentTab('passport');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#07080c] text-slate-100">
      {/* Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          if (tab === 'passport') setInspectedAgent(activeAgent);
          setCurrentTab(tab);
        }}
        activeAgent={activeAgent}
        onOpenAgentSwitcher={() => setIsAgentSwitcherOpen(true)}
        isWalletConnected={isWalletConnected}
        walletAddress={walletAddress}
        onConnectWallet={handleConnectWallet}
      />

      {/* Header Metrics Ribbon */}
      <HeaderMetricsRibbon
        uniqueAgentsCount={uniqueAgentsCount}
        totalVotesCount={totalVotesCount}
        totalMutualHandshakes={totalMutualHandshakes}
      />

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8">
        {currentTab === 'parliament' && (
          <ParliamentView
            proposals={proposals}
            activeAgent={activeAgent}
            isWalletConnected={isWalletConnected}
            walletAddress={walletAddress}
            onVoteCast={handleVoteCast}
            onCreateProposal={handleCreateProposal}
          />
        )}

        {currentTab === 'mesh' && (
          <MeshView
            agents={agents}
            edges={edges}
            activeAgent={activeAgent}
            onSendPing={handleSendPing}
            onSelectAgentForPassport={handleSelectAgentForPassport}
          />
        )}

        {currentTab === 'passport' && (
          <PassportView
            agent={inspectedAgent}
            edges={edges}
            proposals={proposals}
            onOpenAgentSwitcher={() => setIsAgentSwitcherOpen(true)}
          />
        )}
      </main>

      {/* Agent Switcher Modal */}
      {isAgentSwitcherOpen && (
        <AgentSwitcherModal
          agents={agents}
          activeAgent={activeAgent}
          onSelectAgent={(agent) => {
            setActiveAgent(agent);
            setInspectedAgent(agent);
          }}
          onClose={() => setIsAgentSwitcherOpen(false)}
        />
      )}

      {/* Global Footer */}
      <Footer />
    </div>
  );
};
