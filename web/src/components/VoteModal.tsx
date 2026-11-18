import React, { useState } from 'react';
import { X, CheckCircle2, ShieldCheck, Cpu, ArrowRight, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Proposal, SupportType, AgentNode } from '../types';
import { getBallotTypedData, signBallotWithWallet, simulateAgentSignBallot, submitVoteToRelayer } from '../utils/eip712';
import { PARLIAMENT_ADDRESS } from '../constants/contracts';

interface VoteModalProps {
  proposal: Proposal;
  activeAgent: AgentNode;
  isWalletConnected: boolean;
  walletAddress?: string;
  onClose: () => void;
  onVoteSuccess: (proposalId: number, support: SupportType) => void;
}

export const VoteModal: React.FC<VoteModalProps> = ({
  proposal,
  activeAgent,
  isWalletConnected,
  walletAddress,
  onClose,
  onVoteSuccess,
}) => {
  const [support, setSupport] = useState<SupportType>(1); // Default to For
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'signing' | 'relaying' | 'success'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compute live typed data for preview
  const previewTypedData = getBallotTypedData(
    proposal.id,
    activeAgent.tokenId,
    support,
    0
  );

  const handleCastVote = async () => {
    setIsSubmitting(true);
    setError(null);
    setStep('signing');
    setStatusMessage('Generating EIP-712 Typed Data Signature...');

    try {
      let signedPayload;

      if (isWalletConnected && (window as any).ethereum) {
        // Sign via connected web3 wallet
        signedPayload = await signBallotWithWallet(
          (window as any).ethereum,
          walletAddress as `0x${string}`,
          proposal.id,
          activeAgent.tokenId,
          support
        );
      } else {
        // Sign as active Agent ID persona (EIP-712 cryptographic signature)
        signedPayload = await simulateAgentSignBallot(
          activeAgent.name,
          activeAgent.tokenId,
          activeAgent.owner,
          proposal.id,
          support
        );
      }

      setStep('relaying');
      setStatusMessage('Transmitting gasless ballot to scarlet.ai autonomous relayer...');

      const result = await submitVoteToRelayer(signedPayload);

      if (result.success) {
        setStep('success');
        setTxHash(result.txHash || null);
        setStatusMessage(result.message);

        // Burst celebratory confetti
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#f59e0b', '#10b981', '#8b5cf6'],
        });

        onVoteSuccess(proposal.id, support);
      } else {
        throw new Error('Relayer failed to queue ballot');
      }
    } catch (err: any) {
      setError(err?.message || 'Vote failed to cast');
      setStep('idle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-xl bg-[#0f121d] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl text-slate-200 overflow-hidden">
        
        {/* Glow ambient accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">1-Click Gasless Vote</h3>
              <p className="text-xs text-slate-400 font-mono">EIP-712 Typed Data Meta-Transaction</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'success' ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500/60 flex items-center justify-center text-emerald-400 shadow-lg animate-bounce">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <h4 className="text-xl font-bold text-white">Ballot Successfully Queued!</h4>
              <p className="text-xs text-emerald-300 font-mono mt-1">{statusMessage}</p>
            </div>

            {txHash && (
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 text-left font-mono text-xs">
                <span className="text-slate-400">Simulated Batch Settlement Tx:</span>
                <p className="text-cyan-400 truncate mt-0.5">{txHash}</p>
              </div>
            )}

            <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1">
              <p>• Zero BNB gas spent by <span className="text-white font-bold">{activeAgent.name}</span></p>
              <p>• 1-Agent-1-Vote enforced via Space ID Registrar</p>
              <p>• Anti-flash-loan snapshot block: #{proposal.snapshotBlock}</p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-sm transition-all shadow-cyan-glow"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Proposal summary */}
            <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
                <span>Proposal #{proposal.id}</span>
                <span className="text-cyan-400">{proposal.categoryName}</span>
              </div>
              <p className="font-semibold text-sm text-slate-100 line-clamp-2">
                {proposal.title}
              </p>
            </div>

            {/* Voting Options: For, Against, Abstain */}
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-2">
                SELECT BALLOT DECISION (1-AGENT-1-VOTE)
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSupport(1)}
                  className={`py-3 px-3 rounded-xl border text-center transition-all ${
                    support === 1
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-base font-bold">FOR</div>
                  <div className="text-[10px] text-slate-400 font-mono">Support (1)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSupport(0)}
                  className={`py-3 px-3 rounded-xl border text-center transition-all ${
                    support === 0
                      ? 'bg-rose-950/60 border-rose-500 text-rose-300 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-base font-bold">AGAINST</div>
                  <div className="text-[10px] text-slate-400 font-mono">Oppose (0)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSupport(2)}
                  className={`py-3 px-3 rounded-xl border text-center transition-all ${
                    support === 2
                      ? 'bg-slate-800 border-slate-500 text-slate-200 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-base font-bold">ABSTAIN</div>
                  <div className="text-[10px] text-slate-400 font-mono">Neutral (2)</div>
                </button>
              </div>
            </div>

            {/* Voting Agent Identity */}
            <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <div>
                  <span className="text-slate-400">Voting Persona: </span>
                  <span className="font-bold text-white font-mono">{activeAgent.name}</span>
                  <span className="text-amber-400 font-mono ml-1">#{activeAgent.tokenId}</span>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800 font-mono">
                Space ID Soulbound
              </span>
            </div>

            {/* EIP-712 Payload Preview */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                <span>EIP-712 TYPED DATA SIGNATURE SPEC</span>
                <span className="text-emerald-400">Gas: 0.00 BNB (Sponsored)</span>
              </div>
              <pre className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[10px] text-cyan-300/90 overflow-x-auto max-h-28">
{JSON.stringify(
  {
    domain: {
      name: previewTypedData.domain.name,
      version: previewTypedData.domain.version,
      chainId: 56,
      verifyingContract: PARLIAMENT_ADDRESS,
    },
    message: {
      proposalId: proposal.id,
      tokenId: activeAgent.tokenId,
      support,
      nonce: 0,
      deadline: previewTypedData.message.deadline.toString(),
    },
  },
  null,
  2
)}
              </pre>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Action button */}
            <button
              onClick={handleCastVote}
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold text-sm shadow-cyan-glow transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>{statusMessage}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-cyan-200" />
                  <span>Sign & Cast Gasless Vote (0 BNB)</span>
                  <ArrowRight className="w-4 h-4 text-cyan-200" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
