import React, { useState } from 'react';
import { Vote, PlusCircle, CheckCircle2, XCircle, Filter, Sparkles, ExternalLink, ChevronDown, ShieldCheck } from 'lucide-react';
import { Proposal, AgentNode, SupportType } from '../types';
import { VoteModal } from './VoteModal';
import { CreateProposalModal } from './CreateProposalModal';
import { SignatureVerifierModal } from './SignatureVerifierModal';
import { PARLIAMENT_ADDRESS, LEGACY_PARLIAMENT_ADDRESS, BSC_CONFIG } from '../constants/contracts';

const MAX_CARD_DESCRIPTION_CHARS = 280;

function toPlainProposalText(raw: string, title?: string): string {
  let plain = (raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (title) {
    const cleanTitleBody = title.replace(/^ACP-\d+:\s*/i, '').trim();
    if (cleanTitleBody && plain.toLowerCase().startsWith(cleanTitleBody.toLowerCase())) {
      plain = plain.slice(cleanTitleBody.length).replace(/^[\s:.\-]+/, '').trim();
    }
  }
  return plain;
}

const ProposalDescription: React.FC<{ description: string; title?: string }> = ({
  description,
  title,
}) => {
  const [expanded, setExpanded] = useState(false);
  const plain = toPlainProposalText(description, title);
  const isLong = plain.length > MAX_CARD_DESCRIPTION_CHARS;
  const display =
    expanded || !isLong
      ? plain
      : `${plain.slice(0, MAX_CARD_DESCRIPTION_CHARS).replace(/\s+\S*$/, '')}...`;

  return (
    <div>
      <p className="item-description">{display}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-[11px] font-mono text-[#8fa3b8] hover:text-[#e5e4e2] mt-1 transition-colors"
        >
          {expanded ? 'Show less' : 'Read full motion'}
        </button>
      )}
    </div>
  );
};

const ProposalVoteStats: React.FC<{ proposal: Proposal; isConcluded?: boolean }> = ({
  proposal,
  isConcluded = false,
}) => {
  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
  const forPct = totalVotes > 0 ? (proposal.forVotes / totalVotes) * 100 : 0;
  const againstPct = totalVotes > 0 ? (proposal.againstVotes / totalVotes) * 100 : 0;
  const abstainPct = totalVotes > 0 ? (proposal.abstainVotes / totalVotes) * 100 : 0;

  return (
    <div className="item-votes">
      <div className="vote-counts">
        <span className="v vote-for">
          {isConcluded ? `Final For: ${proposal.forVotes} (${forPct.toFixed(1)}%)` : `For: ${proposal.forVotes}`}
        </span>
        <span className="v vote-against">
          {isConcluded ? `Against: ${proposal.againstVotes} (${againstPct.toFixed(1)}%)` : `Against: ${proposal.againstVotes}`}
        </span>
        <span className="v vote-abstain">Abstain: {proposal.abstainVotes}</span>
        <span className="v vote-turnout">
          {isConcluded ? `Final Turnout: ${totalVotes} agents` : `Turnout: ${totalVotes} agents`}
        </span>
      </div>

      {/* Multi-segment Progress Bar */}
      <div
        className="vote-progressbar"
        style={{
          display: 'flex',
          width: 'calc(100% - 16px)',
          height: '5px',
          background: 'rgba(255, 255, 255, 0.1)',
          margin: '8px',
          overflow: 'hidden',
          borderRadius: '1px',
        }}
      >
        <span
          className="vp vp-for"
          style={{
            width: `${forPct}%`,
            height: '100%',
            backgroundColor: 'rgb(8, 198, 110)',
            transition: isConcluded ? undefined : 'width 0.4s ease',
          }}
          title={`For: ${proposal.forVotes} (${forPct.toFixed(1)}%)`}
        />
        <span
          className="vp vp-against"
          style={{
            width: `${againstPct}%`,
            height: '100%',
            backgroundColor: 'rgb(215, 16, 63)',
            transition: isConcluded ? undefined : 'width 0.4s ease',
          }}
          title={`Against: ${proposal.againstVotes} (${againstPct.toFixed(1)}%)`}
        />
        <span
          className="vp vp-abstain"
          style={{
            width: `${abstainPct}%`,
            height: '100%',
            backgroundColor: 'var(--color-steel-blue, #8fa3b8)',
            transition: isConcluded ? undefined : 'width 0.4s ease',
          }}
          title={`Abstain: ${proposal.abstainVotes} (${abstainPct.toFixed(1)}%)`}
        />
      </div>
    </div>
  );
};

const ProposalCreatorBadges: React.FC<{ proposal: Proposal }> = ({ proposal }) => {
  const proposerLabel =
    proposal.creatorName ||
    (proposal.creator
      ? `${proposal.creator.slice(0, 6)}...${proposal.creator.slice(-4)}`
      : 'Unknown');

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <p
        className="item-proposer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: 'rgba(143, 163, 184, 0.08)',
          border: '1px solid rgba(143, 163, 184, 0.25)',
          color: 'var(--color-platinum, #e5e4e2)',
          fontSize: '12px',
          margin: 0,
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#00f0ff',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span className="truncate max-w-[180px]">{proposerLabel}</span>
      </p>

      {proposal.categoryName && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--color-steel-blue, #8fa3b8)',
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {proposal.categoryName}
        </span>
      )}
    </div>
  );
};

const ProposalOnChainProof: React.FC<{
  proposal: Proposal;
  onOpenVerifier: (proposal: Proposal) => void;
}> = ({ proposal, onOpenVerifier }) => {
  const [open, setOpen] = useState(false);
  const contractAddr =
    proposal.contractAddress || (proposal.isLegacy ? LEGACY_PARLIAMENT_ADDRESS : PARLIAMENT_ADDRESS);
  const receipts = proposal.recentVoteReceipts || [];

  return (
    <div className="mt-2 pt-2 border-t border-white/5 font-mono text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-[#8fa3b8] hover:text-[#e5e4e2] transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{open ? 'Hide On-Chain Proof' : 'On-Chain Proof & BscScan Receipts'}</span>
          <ChevronDown
            className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        <div className="flex items-center gap-2">
          {proposal.creationTxHash && (
            <a
              href={`${BSC_CONFIG.blockExplorerUrl}/tx/${proposal.creationTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
              title="View ProposalCreated transaction on BscScan"
            >
              <span>Creation Tx</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={() => onOpenVerifier(proposal)}
            className="text-[#F0B90B] hover:underline"
          >
            Verify RPC
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 p-2.5 rounded bg-[#050505] border border-[#8fa3b8]/20 space-y-2 text-[11px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[#8fa3b8]">
            <div>
              Contract:{' '}
              <a
                href={`${BSC_CONFIG.blockExplorerUrl}/address/${contractAddr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline"
              >
                {contractAddr.slice(0, 8)}...{contractAddr.slice(-6)}
              </a>
            </div>
            <div>
              Snapshot / Window:{' '}
              <span className="text-[#e5e4e2]">
                #{proposal.snapshotBlock || 0} ({proposal.startBlock}→{proposal.endBlock})
              </span>
            </div>
          </div>

          <div className="text-[#8fa3b8] truncate">
            CID Hash: <span className="text-[#e5e4e2]">{proposal.contentCidHash}</span>
          </div>

          {receipts.length > 0 ? (
            <div className="space-y-1 pt-1 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-[#8fa3b8]">
                Recent On-Chain VoteCast Receipts
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {receipts.map((r, idx) => (
                  <div
                    key={`${r.txHash}-${r.tokenId}-${idx}`}
                    className="flex items-center justify-between gap-2 text-[10px]"
                  >
                    <span className="text-[#e5e4e2] truncate">
                      {r.voterName || `#${r.tokenId.slice(0, 8)}`} •{' '}
                      <span
                        className={
                          r.support === 1
                            ? 'text-emerald-400'
                            : r.support === 0
                              ? 'text-rose-400'
                              : 'text-[#8fa3b8]'
                        }
                      >
                        {r.support === 1 ? 'FOR' : r.support === 0 ? 'AGAINST' : 'ABSTAIN'}
                      </span>
                    </span>
                    <a
                      href={`${BSC_CONFIG.blockExplorerUrl}/tx/${r.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-400 hover:underline shrink-0"
                    >
                      <span>{r.txHash.slice(0, 8)}...</span>
                      <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-[#8fa3b8]/70">
              Use &ldquo;Verify RPC&rdquo; to query live block-height tallies &amp; EIP-712 proofs directly from BSC Mainnet.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

interface ParliamentViewProps {
  proposals: Proposal[];
  activeAgent: AgentNode;
  onVoteCast: (proposalId: number, support: SupportType) => void;
  onCreateProposal: (newProposal: Proposal) => void;
}

export const ParliamentView: React.FC<ParliamentViewProps> = ({
  proposals,
  activeAgent,
  onVoteCast,
  onCreateProposal,
}) => {
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [verifierProposal, setVerifierProposal] = useState<Proposal | null>(null);
  const [isVerifierOpen, setIsVerifierOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('All');

  const categories = ['All', 'Governance', 'Protocol & Mesh', 'Gas Subsidy', 'Security & Identity'];

  const filteredProposals = proposals.filter((p) => {
    if (filterCategory === 'All') return true;
    return p.categoryName === filterCategory;
  });

  const activeProposals = filteredProposals.filter(
    (p) => !p.isLegacy && (p.status === 'Active' || !p.status || p.status === 'Pending')
  );

  const endedProposals = filteredProposals.filter(
    (p) => p.isLegacy || p.status === 'Succeeded' || p.status === 'Defeated'
  );

  const formatVoteDate = (timestamp?: number) => {
    if (!timestamp) return 'Posted on: 19 Nov 2026';
    const d = new Date(timestamp);
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `Posted on: ${day} ${month} ${year}`;
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* Category Filter and Submit Proposal Actions */}
      <div className="w-[calc(100%-1.5rem)] md:w-[80%] mx-auto flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 px-0 sm:px-1">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <Filter className="w-3.5 h-3.5 text-[#8fa3b8] mr-1 shrink-0" aria-hidden="true" />
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat)}
              className={`shrink-0 whitespace-nowrap min-h-[36px] md:min-h-0 px-2.5 py-1.5 md:py-1 rounded text-xs transition-all ${
                filterCategory === cat
                  ? 'bg-[#8fa3b8]/20 text-[#e5e4e2] border border-[#8fa3b8]/60 font-semibold'
                  : 'bg-transparent text-[#8fa3b8] border border-transparent hover:text-[#e5e4e2] hover:border-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 min-h-[44px] md:min-h-0 px-3.5 py-2 md:px-3 md:py-1.5 rounded bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-medium transition-all shadow-sm"
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Submit Proposal</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setVerifierProposal(activeProposals[0] || proposals[0] || null);
              setIsVerifierOpen(true);
            }}
            className="flex items-center gap-1.5 min-h-[44px] md:min-h-0 px-3 py-2 md:px-2.5 md:py-1.5 rounded border border-[#F0B90B]/30 bg-[#F0B90B]/5 text-xs font-mono text-[#F0B90B] hover:bg-[#F0B90B]/10 transition-colors"
            title="Verify on-chain BSC contract state & EIP-712 signatures"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Verify On-Chain</span>
          </button>

          <a
            href={`${BSC_CONFIG.blockExplorerUrl}/address/${PARLIAMENT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 min-h-[44px] md:min-h-0 px-3 py-2 md:px-2.5 md:py-1.5 rounded border border-white/10 text-xs text-[#8fa3b8] hover:text-[#e5e4e2] transition-colors"
            title="View Parliament Contract on BscScan"
          >
            <span>Parliament {PARLIAMENT_ADDRESS.slice(0, 6)}...{PARLIAMENT_ADDRESS.slice(-4)}</span>
            <ExternalLink className="w-3 h-3 text-cyan-400 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Active Votes List Container matching web/xhomepage.html */}
      <div className="active-votes-list-container">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <legend className="active-votes-list-title">Active votes</legend>
          <span className="text-xs text-[#8fa3b8] mr-2 font-mono shrink-0 whitespace-nowrap">
            {activeProposals.length} active {activeProposals.length === 1 ? 'vote' : 'votes'}
          </span>
        </div>

        {activeProposals.length === 0 ? (
          <p className="no-active-votes">No active votes right now</p>
        ) : (
          <div className="flex flex-col gap-3.5 w-full min-w-0">
            {activeProposals.map((proposal) => {
              const hasVoted = proposal.votedByCaller !== undefined;

              return (
                <article key={proposal.id} className="active-items-container">
                  {/* Header: #ID and Posted Date */}
                  <div className="active-items-container-header">
                    <p className="item-number">#{proposal.id}</p>
                    <p className="item-date">{formatVoteDate(proposal.createdAt)}</p>
                  </div>

                  {/* Content Middle: Title, Description, and Live Votes Box */}
                  <div className="item-content-middle">
                    <p className="item-title">{proposal.title}</p>
                    <ProposalDescription description={proposal.description} title={proposal.title} />
                    <ProposalVoteStats proposal={proposal} />
                    <ProposalOnChainProof
                      proposal={proposal}
                      onOpenVerifier={(prop) => {
                        setVerifierProposal(prop);
                        setIsVerifierOpen(true);
                      }}
                    />
                  </div>

                  {/* Footer: Proposer Badge & Vote Modal Trigger */}
                  <div
                    className="item-footer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <ProposalCreatorBadges proposal={proposal} />

                    {/* Vote Modal Trigger */}
                    <div className="shrink-0">
                      {hasVoted ? (
                        <button
                          type="button"
                          onClick={() => setSelectedProposal(proposal)}
                          className="inline-flex items-center gap-1.5 min-h-[44px] md:min-h-0 px-3.5 py-2 md:px-3 md:py-1 rounded text-xs font-mono transition-all hover:brightness-110"
                          style={{
                            backgroundColor: 'rgba(8, 198, 110, 0.12)',
                            border: '1px solid rgba(8, 198, 110, 0.35)',
                            color: 'rgb(8, 198, 110)',
                            cursor: 'pointer',
                          }}
                          title="Click to view or update vote"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            Voted {proposal.votedByCaller === 1 ? 'FOR' : proposal.votedByCaller === 0 ? 'AGAINST' : 'ABSTAIN'}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelectedProposal(proposal)}
                          className="inline-flex items-center gap-1.5 min-h-[44px] md:min-h-0 px-4 py-2 md:px-3.5 md:py-1.5 rounded text-xs font-medium transition-all hover:opacity-90 active:scale-95"
                          style={{
                            background: 'linear-gradient(90deg, #06b6d4, #2563eb)',
                            color: '#ffffff',
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: '0 0 10px rgba(6, 182, 212, 0.25)',
                          }}
                        >
                          <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Vote</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Concluded Polls Archive (Collapsible) */}
      <div className="active-votes-list-container">
        <button
          type="button"
          onClick={() => setIsArchiveOpen((prev) => !prev)}
          aria-expanded={isArchiveOpen}
          className="w-full min-h-[44px] flex items-start sm:items-center justify-between gap-3 p-1 text-left transition-colors hover:opacity-90 group focus:outline-none cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <span className="active-votes-list-title flex items-center gap-2 !m-0">
              Concluded Polls Archive
            </span>
            <p className="text-[11px] text-[#8fa3b8] font-mono mt-1">
              Historical democratic decisions anchored to SPACE ID Agent ID snapshots
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 sm:mr-2 pt-0.5 sm:pt-0">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white/5 border border-white/10 text-[#8fa3b8] whitespace-nowrap shrink-0">
              {endedProposals.length} concluded {endedProposals.length === 1 ? 'poll' : 'polls'}
            </span>
            <div className={`p-1 rounded text-[#8fa3b8] transition-transform duration-300 shrink-0 ${isArchiveOpen ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </div>
          </div>
        </button>

        {isArchiveOpen && (
          <div className="mt-4 pt-4 border-t border-white/5 animate-fadeIn">
            {endedProposals.length === 0 ? (
              <p className="no-active-votes py-6">No concluded polls matching the current category filter</p>
            ) : (
              <div className="flex flex-col gap-3.5 w-full min-w-0">
                {endedProposals.map((proposal) => {
                  const isPassed = proposal.status === 'Succeeded';

                  return (
                    <article
                      key={proposal.isLegacy ? `legacy-${proposal.id}` : proposal.id}
                      className="active-items-container opacity-90 hover:opacity-100 transition-opacity"
                    >
                      {/* Header: #ID, Outcome Badge, and Concluded Date */}
                      <div className="active-items-container-header">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="item-number">
                            {proposal.isLegacy ? `Legacy #${proposal.id}` : `#${proposal.id}`}
                          </p>
                          {isPassed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>PASSED</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 font-mono">
                              <XCircle className="w-3 h-3" aria-hidden="true" />
                              <span>DEFEATED</span>
                            </span>
                          )}
                        </div>
                        <p className="item-date">{formatVoteDate(proposal.createdAt)}</p>
                      </div>

                      {/* Content Middle */}
                      <div className="item-content-middle">
                        <p className="item-title">{proposal.title}</p>
                        <ProposalDescription description={proposal.description} title={proposal.title} />
                        <ProposalVoteStats proposal={proposal} isConcluded />
                        <ProposalOnChainProof
                          proposal={proposal}
                          onOpenVerifier={(prop) => {
                            setVerifierProposal(prop);
                            setIsVerifierOpen(true);
                          }}
                        />
                      </div>

                      {/* Footer: Author & Archived Status */}
                      <div
                        className="item-footer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <ProposalCreatorBadges proposal={proposal} />

                        <span className="text-[11px] font-mono text-[#8fa3b8] px-2.5 py-1 rounded bg-white/[0.03] border border-white/5 shrink-0">
                          Concluded & Ratified
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vote Modal */}
      {selectedProposal && (
        <VoteModal
          proposal={selectedProposal}
          activeAgent={activeAgent}
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
          existingProposals={proposals.filter((p) => !p.isLegacy)}
          onClose={() => setIsCreateModalOpen(false)}
          onCreateSuccess={(newProp) => {
            onCreateProposal(newProp);
            setIsCreateModalOpen(false);
          }}
        />
      )}

      {/* Live On-Chain & EIP-712 Verifier Modal */}
      {isVerifierOpen && (
        <SignatureVerifierModal
          initialProposal={verifierProposal}
          defaultTokenId={activeAgent.tokenId}
          onClose={() => setIsVerifierOpen(false)}
        />
      )}
    </div>
  );
};

export default ParliamentView;
