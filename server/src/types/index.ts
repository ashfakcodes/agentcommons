export interface QueuedVote {
  proposalId: bigint;
  tokenId: bigint;
  support: number;
  nonce: bigint;
  deadline: bigint;
  signature: `0x${string}`;
  signer: `0x${string}`;
  queuedAt: number;
}

export interface BallotMessage {
  proposalId: bigint;
  tokenId: bigint;
  support: number;
  nonce: bigint;
  deadline: bigint;
}

export interface VoteSubmitRequest {
  proposalId: string | number;
  tokenId: string | number;
  support: number;
  deadline: string | number;
  signature: string;
  nonce?: string | number;
}

export enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Succeeded = 2,
  Defeated = 3,
}

export interface ProposalCore {
  startBlock: number;
  endBlock: number;
  snapshotBlock: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  status: ProposalStatus;
  createdAt: number;
}

export interface ProposalMeta {
  creator: string;
  categoryId: number;
  contentCidHash: string;
}

export interface ProposalView {
  id: string;
  title?: string;
  description?: string;
  creator: string;
  categoryId: number;
  contentCidHash: string;
  startBlock: number;
  endBlock: number;
  snapshotBlock: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  totalVotes: number;
  status: string;
  statusCode: number;
  createdAt: number;
}

export interface MeshNode {
  tokenId: string;
  name: string;
  owner: string;
  totalConnections: number;
  capabilities: number;
}

export interface MeshEdge {
  edgeKey: string;
  nodeA: string;
  nodeB: string;
  isMutual: boolean;
  capabilityMask: number;
  establishedAt: number;
}

export interface MeshTopology {
  nodes: MeshNode[];
  edges: MeshEdge[];
  totalNodes: number;
  totalEdges: number;
  mutualConnections: number;
}

export interface RelayerHealth {
  status: "ok" | "degraded" | "error";
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  chainId: number;
  mockMode: boolean;
  scarletTokenId: string;
  scarletAddress: string;
  scarletBalanceBnb: string;
  queuedVotesCount: number;
  contracts: {
    parliament: string;
    mesh: string;
    registrar: string;
  };
  stats: {
    totalBatchesProcessed: number;
    totalVotesRelayed: number;
    totalFailedVotes: number;
    totalHandshakesReciprocated: number;
  };
}

export interface BatchExecutionResult {
  txHash: string;
  proposalId: bigint;
  batchSize: number;
  successfulVotes: number;
  failedVotes: number;
}
