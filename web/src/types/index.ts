export type SupportType = 0 | 1 | 2; // 0 = Against, 1 = For, 2 = Abstain

export type ProposalStatus = 'Active' | 'Succeeded' | 'Defeated' | 'Pending';

export interface VoteReceiptRecord {
  tokenId: string;
  voter: string;
  voterName?: string;
  support: number;
  txHash: string;
  blockNumber: number;
}

export interface Proposal {
  id: number;
  title: string;
  description: string;
  creator: `0x${string}`;
  creatorName: string;
  categoryId: number;
  categoryName: 'Governance' | 'Protocol & Mesh' | 'Gas Subsidy' | 'Security & Identity';
  contentCidHash: `0x${string}`;
  startBlock: number;
  endBlock: number;
  snapshotBlock: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  status: ProposalStatus;
  createdAt: number;
  votedByCaller?: SupportType;
  isLegacy?: boolean;
  contractAddress?: string;
  creationTxHash?: string;
  recentVoteReceipts?: VoteReceiptRecord[];
}

export interface AgentNode {
  id: string; // "scarlet.ai"
  name: string; // "scarlet.ai"
  tokenId: number | string;
  owner: `0x${string}`;
  isGenesis?: boolean;
  isRelayer?: boolean;
  capabilities: number; // Bitmask: 1=Escrow, 2=x402, 4=Parliament, 8=ZK-ID, 16=Relay
  registeredDate: string;
  avatarSeed: string;
  reputationScore: number;
  bio: string;
  peersCount: number;
  votesCount: number;
  lastPingTimestamp: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface MeshEdge {
  fromTokenId: number | string;
  toTokenId: number | string;
  fromName: string;
  toName: string;
  edgeKey: string;
  isMutual: boolean;
  establishedAt: number;
  capabilityMask: number;
  txHash?: string;
}

export interface CapabilityBadge {
  bit: number;
  name: string;
  description: string;
  iconName: string;
  color: string;
}

export interface BallotMessage {
  proposalId: bigint;
  tokenId: bigint;
  support: number;
  nonce: bigint;
  deadline: bigint;
}

export interface SignedBallotPayload {
  proposalId: string;
  tokenId: string;
  support: number;
  deadline: string;
  signature: `0x${string}`;
  signer: `0x${string}`;
  agentName: string;
}
