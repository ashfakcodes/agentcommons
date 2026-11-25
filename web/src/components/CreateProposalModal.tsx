import React, { useState } from 'react';
import { X, PlusCircle, CheckCircle2, ShieldCheck, Loader2, Sparkles } from 'lucide-react';
import { AgentNode, Proposal } from '../types';

interface CreateProposalModalProps {
  activeAgent: AgentNode;
  existingProposals?: Proposal[];
  onClose: () => void;
  onCreateSuccess: (newProposal: Proposal) => void;
}

export const CreateProposalModal: React.FC<CreateProposalModalProps> = ({
  activeAgent,
  existingProposals = [],
  onClose,
  onCreateSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<number>(0);
  const [durationBlocks, setDurationBlocks] = useState<number>(43200); // ~24h (3s blocks)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const categories = [
    { id: 0, name: 'Governance' },
    { id: 1, name: 'Protocol & Mesh' },
    { id: 2, name: 'Gas Subsidy' },
    { id: 3, name: 'Security & Identity' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setIsSubmitting(true);
    await new Promise((res) => setTimeout(res, 900));

    const selectedCategory = categories.find((c) => c.id === category)?.name as any || 'Governance';
    const fakeCidHash = ('0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')) as `0x${string}`;

    // Compute deterministic sequential ID matching on-chain counter (++proposalCount)
    const validNumberedIds = existingProposals
      .map((p) => p.id)
      .filter((id) => typeof id === 'number' && id > 0 && id < 90);
    const nextId = validNumberedIds.length > 0 ? Math.max(...validNumberedIds) + 1 : 5;

    const formattedTitle = title.trim().startsWith('ACP-')
      ? title.trim()
      : `ACP-${String(nextId).padStart(3, '0')}: ${title.trim()}`;

    const newProposal: Proposal = {
      id: nextId,
      title: formattedTitle,
      description: description.trim(),
      creator: activeAgent.owner,
      creatorName: activeAgent.name,
      categoryId: category,
      categoryName: selectedCategory,
      contentCidHash: fakeCidHash,
      startBlock: 44120000,
      endBlock: 44120000 + durationBlocks,
      snapshotBlock: 44119999,
      forVotes: 1, // Creator vote
      againstVotes: 0,
      abstainVotes: 0,
      status: 'Active',
      createdAt: Date.now(),
      votedByCaller: 1,
    };

    setIsSubmitting(false);
    setSuccess(true);
    setTimeout(() => {
      onCreateSuccess(newProposal);
    }, 800);
  };

  const tokenStr = String(activeAgent.tokenId);
  const shortTokenId = tokenStr.length > 14 ? `${tokenStr.slice(0, 6)}...${tokenStr.slice(-4)}` : tokenStr;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#0f121d] border border-cyan-500/40 rounded-2xl p-4 sm:p-6 shadow-2xl text-slate-200">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-400">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Create Parliamentary Initiative</h3>
              <p className="text-xs text-slate-400 font-mono">1-Agent-1-Vote Democratic Proposal</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h4 className="text-lg font-bold text-white">Proposal Successfully Initialized!</h4>
            <p className="text-xs text-slate-400 font-mono">Snapshot block locked at block #44119999</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Proposer: <strong className="text-white">{activeAgent.name}</strong></span>
              </div>
              <span className="text-amber-400 shrink-0" title={`Token #${tokenStr}`}>Token #{shortTokenId}</span>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                PROPOSAL TITLE (ACP-XXX)
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. ACP-005: Expand Autonomous Micropayment Quotas"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">CATEGORY</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">VOTING DURATION</label>
                <select
                  value={durationBlocks}
                  onChange={(e) => setDurationBlocks(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value={1200}>1 Hour (1,200 blocks)</option>
                  <option value={28800}>24 Hours (28,800 blocks)</option>
                  <option value={86400}>3 Days (86,400 blocks)</option>
                  <option value={201600}>7 Days (201,600 blocks)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                SUMMARY SPECIFICATION (PLAIN TEXT, MAX 280 CHARS)
              </label>
              <textarea
                required
                rows={3}
                maxLength={280}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write 1-2 plain sentences describing the change and rationale (no Markdown or bullet formatting)..."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500 resize-none font-sans"
              />
            </div>

            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <p>• Requires verified Space ID Soulbound Token</p>
              <p>• Snapshot block is fixed at (currentBlock - 1) to eliminate flash-loan attacks</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 font-bold text-sm text-white shadow-cyan-glow flex items-center justify-center gap-2 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Publishing Proposal...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-cyan-200" />
                  <span>Create Proposal</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
