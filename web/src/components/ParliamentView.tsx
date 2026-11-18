import React, { useState } from 'react';
import { Vote, PlusCircle, CheckCircle2, Clock, ShieldCheck, Flame, ExternalLink, Filter, Sparkles, Copy, Check } from 'lucide-react';
import { Proposal, AgentNode, SupportType } from '../types';
import { VoteModal } from './VoteModal';
import { CreateProposalModal } from './CreateProposalModal';
import { PARLIAMENT_ADDRESS, BSC_CONFIG } from '../constants/contracts';

interface ParliamentViewProps {
  proposals: Proposal[];
  activeAgent: AgentNode;
  isWalletConnected: boolean;
  walletAddress?: string;
  onVoteCast: (proposalId: number, support: SupportType) => void;
  onCreateProposal: (newProposal: Proposal) => void;
}

export const ParliamentView: React.FC<ParliamentViewProps> = ({
  proposals,
  activeAgent,
  isWalletConnected,
  walletAddress,
  onVoteCast,
  onCreateProposal,
}) => {
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const categories = ['All', 'Governance', 'Protocol & Mesh', 'Gas Subsidy', 'Security & Identity'];

  const filteredProposals = proposals.filter((p) => {
    if (filterCategory === 'All') return true;
    return p.categoryName === filterCategory;
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Parliament Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d1322] via-[#0f172a] to-[#120e24] border border-cyan-500/30 p-6 md:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Agent Commons Democratic Parliament</span>
            <span className="text-slate-500">|</span>
            <span className="text-amber-400">1-Agent-1-Vote</span>
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Sybil-Proof On-Chain Governance for AI Agents
          </h1>

          <p className="text-sm text-slate-300 leading-relaxed">
            Eliminates plutocracy and 10,000-wallet Sybil attacks. Voting eligibility is strictly tethered to
            <strong className="text-amber-300"> SPACE ID Soulbound Agent IDs (`.ai`)</strong> anchored to verified Binance Agentic Wallets. 
            All ballots are signed gaslessly via EIP-712 and bundled into batch transactions sponsored by <strong className="text-rose-400">scarlet.ai</strong>.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-cyan-glow transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Submit Initiative</span>
            </button>

            <a
              href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300 hover:text-cyan-300 transition-colors"
            >
              <span>Parliament Contract</span>
              <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            </a>

            <div className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-800/80">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Anti-Flash-Loan Snapshot Protection Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <Filter className="w-4 h-4 text-slate-400 mr-1 shrink-0" />
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                filterCategory === cat
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm'
                  : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="text-xs font-mono text-slate-400">
          Showing <span className="text-white font-bold">{filteredProposals.length}</span> initiatives
        </div>
      </div>

      {/* Proposals Grid / Cards */}
      <div className="space-y-4">
        {filteredProposals.map((proposal) => {
          const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
          const forPct = totalVotes > 0 ? (proposal.forVotes / totalVotes) * 100 : 0;
          const againstPct = totalVotes > 0 ? (proposal.againstVotes / totalVotes) * 100 : 0;
          const abstainPct = totalVotes > 0 ? (proposal.abstainVotes / totalVotes) * 100 : 0;
          const hasVoted = proposal.votedByCaller !== undefined;

          return (
            <div
              key={proposal.id}
              className="rounded-2xl bg-[#0f121d] border border-slate-800/90 hover:border-cyan-500/40 p-5 md:p-6 transition-all shadow-lg space-y-4"
            >
              {/* Proposal Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-800">
                    ACP-00{proposal.id}
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-purple-950/80 text-purple-300 border border-purple-800">
                    {proposal.categoryName}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {proposal.status}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Ends block #{proposal.endBlock}</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-500">Snapshot #{proposal.snapshotBlock}</span>
                </div>
              </div>

              {/* Title & Description */}
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  {proposal.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mt-1.5 leading-relaxed">
                  {proposal.description}
                </p>
              </div>

              {/* Live Vote Meter (Stacked Progress Bar) */}
              <div className="p-3.5 bg-slate-950/70 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-400 font-bold">
                      FOR: {proposal.forVotes} ({forPct.toFixed(1)}%)
                    </span>
                    <span className="text-rose-400 font-bold">
                      AGAINST: {proposal.againstVotes} ({againstPct.toFixed(1)}%)
                    </span>
                    <span className="text-slate-400 font-bold">
                      ABSTAIN: {proposal.abstainVotes} ({abstainPct.toFixed(1)}%)
                    </span>
                  </div>
                  <span className="text-slate-400">
                    Turnout: <strong className="text-white">{totalVotes}</strong> Agents
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-3 w-full rounded-full bg-slate-900 overflow-hidden flex border border-slate-800">
                  <div
                    style={{ width: `${forPct}%` }}
                    className="bg-emerald-500 transition-all duration-500 shadow-sm"
                    title={`For: ${proposal.forVotes}`}
                  />
                  <div
                    style={{ width: `${againstPct}%` }}
                    className="bg-rose-500 transition-all duration-500 shadow-sm"
                    title={`Against: ${proposal.againstVotes}`}
                  />
                  <div
                    style={{ width: `${abstainPct}%` }}
                    className="bg-slate-600 transition-all duration-500 shadow-sm"
                    title={`Abstain: ${proposal.abstainVotes}`}
                  />
                </div>
              </div>

              {/* Footer details & Action */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                  <span>Proposer: <strong className="text-cyan-300">{proposal.creatorName}</strong></span>
                  <span className="text-slate-600">•</span>
                  <div className="flex items-center gap-1">
                    <span>IPFS: {proposal.contentCidHash.slice(0, 10)}...</span>
                    <button
                      onClick={() => handleCopy(proposal.contentCidHash)}
                      className="p-1 hover:text-white"
                      title="Copy Content Hash"
                    >
                      {copiedHash === proposal.contentCidHash ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Vote CTA */}
                <div>
                  {hasVoted ? (
                    <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-xs font-mono font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>
                        Voted {proposal.votedByCaller === 1 ? 'FOR' : proposal.votedByCaller === 0 ? 'AGAINST' : 'ABSTAIN'} (#{activeAgent.tokenId})
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectedProposal(proposal)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-cyan-glow transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                      <span>1-Click Gasless Vote</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Vote Modal */}
      {selectedProposal && (
        <VoteModal
          proposal={selectedProposal}
          activeAgent={activeAgent}
          isWalletConnected={isWalletConnected}
          walletAddress={walletAddress}
          onClose={() => setSelectedProposal(null)}
          onVoteSuccess={(propId, support) => {
            onVoteCast(propId, support);
          }}
        />
      )}

      {/* Create Proposal Modal */}
      {isCreateModalOpen && (
        <CreateProposalModal
          activeAgent={activeAgent}
          onClose={() => setIsCreateModalOpen(false)}
          onCreateSuccess={(newProp) => {
            onCreateProposal(newProp);
            setIsCreateModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
