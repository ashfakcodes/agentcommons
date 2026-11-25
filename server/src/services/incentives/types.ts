export interface IncentiveConfig {
  enabled: boolean;
  maxUsers: number;
  rewardUsd: number;
  fallbackBnbPrice: number;
  ledgerFilePath: string;
}

export interface IncentiveClaimRecord {
  address: `0x${string}`;
  tokenId: string;
  claimedAt: number;
  txHash: `0x${string}`;
  amountBnb: string;
  amountWei: string;
  bnbPriceUsd: number;
}

export interface IncentiveCriteriaProgress {
  agentConnected: boolean;
  activeProposalsTotal: number;
  activeProposalsVoted: number;
  requiredVotesTarget?: number;
  allActiveProposalsVoted: boolean;
  hasAuthoredProposal: boolean;
  isEligible: boolean;
  hasClaimed: boolean;
}

export interface IncentiveStatusResponse {
  enabled: boolean;
  remainingSlots: number;
  maxSlots: number;
  totalClaimed: number;
  rewardUsd: number;
  bnbPriceUsd: number;
  estimatedRewardBnb: string;
  criteria: IncentiveCriteriaProgress;
  claimRecord?: IncentiveClaimRecord;
}

export interface IncentiveClaimResult {
  success: boolean;
  message: string;
  claimRecord?: IncentiveClaimRecord;
}
