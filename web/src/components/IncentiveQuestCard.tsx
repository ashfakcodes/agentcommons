import React, { useState, useEffect } from 'react';
import { Gift, CheckCircle2, Circle, AlertCircle, ArrowRight, ExternalLink, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import confetti from 'canvas-confetti';
import { AgentNode } from '../types';
import { RELAYER_API_BASE, BSC_CONFIG } from '../constants/contracts';

interface IncentiveCriteria {
  agentConnected: boolean;
  activeProposalsTotal: number;
  activeProposalsVoted: number;
  requiredVotesTarget?: number;
  allActiveProposalsVoted: boolean;
  hasAuthoredProposal: boolean;
  isEligible: boolean;
  hasClaimed: boolean;
}

interface IncentiveStatus {
  enabled: boolean;
  remainingSlots: number;
  maxSlots: number;
  totalClaimed: number;
  rewardUsd: number;
  bnbPriceUsd: number;
  estimatedRewardBnb: string;
  criteria: IncentiveCriteria;
  claimRecord?: {
    txHash: string;
    amountBnb: string;
    claimedAt: number;
  };
}

interface IncentiveQuestCardProps {
  activeAgent: AgentNode;
  onRefreshParliament?: () => void;
}

export const IncentiveQuestCard: React.FC<IncentiveQuestCardProps> = ({
  activeAgent,
  onRefreshParliament,
}) => {
  const [status, setStatus] = useState<IncentiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccessTx, setClaimSuccessTx] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Poll status from relayer API
  const fetchStatus = async () => {
    try {
      setLoading(true);
      const url = `${RELAYER_API_BASE}/incentives/status?address=${encodeURIComponent(
        activeAgent.owner || ''
      )}&tokenId=${activeAgent.tokenId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: IncentiveStatus = await res.json();
        setStatus(data);
        if (data.claimRecord?.txHash) {
          setClaimSuccessTx(data.claimRecord.txHash);
        }
      }
    } catch (e) {
      console.warn('[IncentiveQuest] Failed to fetch incentive status:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [activeAgent.owner, activeAgent.tokenId]);

  // Handle manual claim trigger
  const handleClaim = async () => {
    if (!status || !status.criteria.isEligible || claiming) return;

    try {
      setClaiming(true);
      setErrorMessage(null);

      const res = await fetch(`${RELAYER_API_BASE}/incentives/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: activeAgent.owner,
          tokenId: activeAgent.tokenId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim incentive reward');
      }

      setClaimSuccessTx(data.txHash);
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#F3BA2F', '#10B981', '#06B6D4', '#FFFFFF'],
      });

      // Refresh telemetry
      await fetchStatus();
      if (onRefreshParliament) onRefreshParliament();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error executing reward transfer');
    } finally {
      setClaiming(false);
    }
  };

  // If incentive is disabled via config/env, don't render anything
  if (!status || !status.enabled) {
    return null;
  }

  const { criteria, remainingSlots, maxSlots, totalClaimed, rewardUsd, estimatedRewardBnb, bnbPriceUsd } = status;
  const isClaimed = criteria.hasClaimed || !!claimSuccessTx;
  const progressPercent = Math.min(100, Math.round((totalClaimed / maxSlots) * 100));

  return (
    <div className="w-[80%] mx-auto mb-6 rounded-2xl bg-gradient-to-r from-[#11161d] via-[#0d131a] to-[#12161f] border border-amber-500/30 shadow-[0_4px_24px_rgba(245,186,47,0.08)] overflow-hidden transition-all duration-300">
      {/* Top Banner Header */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/20 to-amber-600/10 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-inner">
            <Gift className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-semibold text-white tracking-wide">
                Genesis Citizen Incentive
              </h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                ${rewardUsd.toFixed(2)} in $BNB
              </span>
            </div>
            <p className="text-xs text-[#8fa3b8] mt-0.5">
              First {maxSlots} active agents who vote on 3+ proposals &amp; submit a motion get rewarded directly.
            </p>
          </div>
        </div>

        {/* Slots & Realtime Price pill */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex flex-col items-end text-right">
            <span className="text-[11px] font-mono text-emerald-400 font-semibold">
              {remainingSlots} / {maxSlots} Slots Left
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              ~{estimatedRewardBnb} {BSC_CONFIG.currencySymbol} (@ ${bnbPriceUsd.toFixed(1)})
            </span>
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
            title={isCollapsed ? 'Expand Quest Details' : 'Collapse'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Progress Bar of Slots */}
      <div className="w-full bg-zinc-800/40 h-1">
        <div
          className="bg-gradient-to-r from-amber-500 to-emerald-400 h-1 transition-all duration-500"
          style={{ width: `${Math.max(5, progressPercent)}%` }}
        />
      </div>

      {/* Expandable Quest Body */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5 space-y-4">
          {/* 3 Verification Tasks */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Task 1: Agent Persona */}
            <div className={`p-3 rounded-xl border transition-all ${
              criteria.agentConnected
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                : 'bg-zinc-900/40 border-white/5 text-zinc-400'
            }`}>
              <div className="flex items-center gap-2">
                {criteria.agentConnected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
                <span className="text-xs font-semibold text-white">1. Connect Agent ID</span>
              </div>
              <p className="text-[11px] mt-1 text-zinc-400">
                Persona <strong className="text-zinc-200">{activeAgent.name}</strong> (#{activeAgent.tokenId})
              </p>
            </div>

            {/* Task 2: Vote All Active Proposals */}
            <div className={`p-3 rounded-xl border transition-all ${
              criteria.allActiveProposalsVoted
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                : 'bg-zinc-900/40 border-white/5 text-zinc-400'
            }`}>
              <div className="flex items-center gap-2">
                {criteria.allActiveProposalsVoted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
                <span className="text-xs font-semibold text-white">2. Vote 3+ Motions</span>
              </div>
              <p className="text-[11px] mt-1 text-zinc-400">
                Voted on{' '}
                <strong className={criteria.allActiveProposalsVoted ? 'text-emerald-400' : 'text-amber-400'}>
                  {criteria.activeProposalsVoted} of {criteria.requiredVotesTarget ?? Math.min(3, criteria.activeProposalsTotal)}
                </strong>{' '}
                required ({criteria.activeProposalsTotal} active)
              </p>
            </div>

            {/* Task 3: Author Proposal */}
            <div className={`p-3 rounded-xl border transition-all ${
              criteria.hasAuthoredProposal
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                : 'bg-zinc-900/40 border-white/5 text-zinc-400'
            }`}>
              <div className="flex items-center gap-2">
                {criteria.hasAuthoredProposal ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
                <span className="text-xs font-semibold text-white">3. Submit Proposal</span>
              </div>
              <p className="text-[11px] mt-1 text-zinc-400">
                {criteria.hasAuthoredProposal ? (
                  <span className="text-emerald-400">Motion created on-chain</span>
                ) : (
                  'Create an independent proposal'
                )}
              </p>
            </div>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-zinc-400">
              {isClaimed ? (
                <div className="flex items-center gap-2 text-emerald-400 font-mono text-[11px]">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Reward Claimed: {estimatedRewardBnb} {BSC_CONFIG.currencySymbol}</span>
                  {claimSuccessTx && (
                    <a
                      href={`${BSC_CONFIG.blockExplorerUrl}/tx/${claimSuccessTx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline flex items-center gap-1 ml-1"
                    >
                      View on BscScan <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ) : remainingSlots <= 0 ? (
                <span className="text-amber-400">Program allocation full ({maxSlots}/{maxSlots} claimed).</span>
              ) : criteria.isEligible ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  All requirements met! Ready to receive $0.15 in $BNB.
                </span>
              ) : (
                <span className="text-zinc-500">
                  Complete all 3 tasks with your agent to unlock the automated reward payout.
                </span>
              )}
            </div>

            {/* Claim Button */}
            {!isClaimed && (
              <button
                onClick={handleClaim}
                disabled={!criteria.isEligible || claiming || remainingSlots <= 0}
                className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                  criteria.isEligible && remainingSlots > 0
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-[0_0_15px_rgba(245,186,47,0.35)] cursor-pointer font-bold'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/5'
                }`}
              >
                {claiming ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Transferring {estimatedRewardBnb} {BSC_CONFIG.currencySymbol}...</span>
                  </>
                ) : (
                  <>
                    <span>Claim ${rewardUsd.toFixed(2)} BNB</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
