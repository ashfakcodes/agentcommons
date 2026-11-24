export type HexAddress = `0x${string}`;
export type HexSignature = `0x${string}`;
export type HexHash = `0x${string}`;

export enum VoteOption {
  Against = 0,
  For = 1,
  Abstain = 2,
}

export enum CapabilityBit {
  Escrow = 1 << 0,       // Bit 0 (1): Safe multisig/escrow capability
  Payment402 = 1 << 1,   // Bit 1 (2): HTTP 402 / micropayment capability
  Oracle = 1 << 2,       // Bit 2 (4): Decentralized state/price attestation
  Relayer = 1 << 3,      // Bit 3 (8): EIP-712 meta-tx relayer & batch bundler
  CodeAuditor = 1 << 4,  // Bit 4 (16): Smart contract automated auditor
  DataAnalysis = 1 << 5, // Bit 5 (32): On-chain data analysis & indexing
  ComputeBroker = 1 << 6 // Bit 6 (64): GPU/micro-compute resource provider
}

export interface AgentIdentity {
  name: string;             // e.g. "alice.ai", "scarlet.ai"
  tokenId: bigint;          // SPACE ID Registrar token ID
  address: HexAddress;      // BSC wallet address
  privateKey?: HexAddress;  // Software ECDSA key (for testing / simulated MPC)
  capabilities: number;     // Capability bitmask
  persona?: string;         // Agent character/archetype
  description?: string;     // Agent role description
}

export interface BallotMessage {
  proposalId: bigint;
  tokenId: bigint;
  support: number;
  nonce: bigint;
  deadline: bigint;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: HexAddress;
}

export interface SignedBallotPayload {
  proposalId: bigint;
  tokenId: bigint;
  support: number;
  nonce: bigint;
  deadline: bigint;
  signature: HexSignature;
  signer: HexAddress;
  rationale?: string;
}

export interface VoteSubmissionRequest {
  proposalId: string | number;
  tokenId: string | number;
  support: number;
  nonce?: string | number;
  deadline: string | number;
  signature: string;
  rationale?: string;
}

export interface VoteSubmissionResponse {
  status: "queued" | "settled" | "error";
  queueLength?: number;
  message?: string;
  txHash?: string;
  error?: string;
}

export interface MeshPingRequest {
  fromTokenId: bigint;
  toTokenId: bigint;
  capabilities: number;
}

export interface MeshEdgeData {
  edgeKey: HexHash;
  nodeA: bigint;
  nodeB: bigint;
  establishedAt: number;
  capabilityMask: number;
  isMutual: boolean;
}

export interface BawCliConfig {
  binanceChainId: number;
  rpcUrl?: string;
  bawPath?: string;
  simulateOfflineMpc?: boolean;
}

export interface BawSignMessagePreviewResult {
  requestId: string;
  signType: "EIP-712" | "PersonalSign";
  domain: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
  summary: string;
}

export interface BawContractCallPreviewResult {
  requestId: string;
  to: HexAddress;
  value: string;
  inputData: string;
  estimatedGas: string;
}

export interface BawExecutionResult {
  success: boolean;
  requestId: string;
  signature?: HexSignature;
  txHash?: HexHash;
  error?: string;
}

export type PollStatus = "all" | "active" | "pending" | "ended" | "succeeded" | "defeated";

export enum ProposalCategory {
  General = 0,
  ResourceAllocation = 1,
  Security = 2,
  Ecosystem = 3,
}

export interface PollFilter {
  status?: "all" | "active" | "pending" | "ended";
  categoryId?: number;
  search?: string;
  limit?: number;
}

export interface ProposalTallies {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  totalVotes: number;
  forPercentage: number;
  againstPercentage: number;
  abstainPercentage: number;
}

export interface QuorumMetrics {
  totalVoters: number;
  quorumThreshold: number;
  quorumReached: boolean;
}

export interface DecodedProposalDescription {
  summary?: string;
  motivation?: string;
  actionItems?: string[];
  rawText?: string;
}

export interface PollDetails {
  id: string;
  title: string;
  description: string;
  decodedDescription?: DecodedProposalDescription;
  creator: HexAddress | string;
  categoryId: number;
  categoryName: string;
  contentCidHash: string;
  status: "pending" | "active" | "succeeded" | "defeated" | "ended";
  statusCode?: number;
  startBlock: number;
  endBlock: number;
  snapshotBlock?: number;
  currentBlock: number;
  blocksRemaining: number;
  approxSecondsRemaining: number;
  timeRemainingFormatted: string;
  tallies: ProposalTallies;
  quorum: QuorumMetrics;
  createdAt: number;
  raw?: any;
}

export interface AgentEligibility {
  proposalId: string;
  tokenId: bigint;
  eligible: boolean;
  holdsToken: boolean;
  tokenHasVoted: boolean;
  addressHasVoted: boolean;
  proposalActive: boolean;
  reasons: string[];
}

export interface ProposalPublishParams {
  title: string;
  description?: string;
  motivation?: string;
  actionItems?: string[];
  categoryId: number;
  votingDurationBlocks?: number;
  deadlineSecondsFromNow?: number;
  nonce?: bigint | number;
}

export interface SignedProposalPayload {
  creator: HexAddress;
  tokenId: bigint;
  title: string;
  description: string;
  contentCidHash: HexHash;
  votingDurationBlocks: number;
  categoryId: number;
  deadline: bigint;
  signature: HexSignature;
  nonce: bigint;
}

export interface ProposalPublishResponse {
  success: boolean;
  proposalId?: string | number;
  txHash?: string;
  message?: string;
  error?: string;
}

export interface PollExplorerConfig {
  relayerApiUrl?: string;
  parliamentAddress?: HexAddress;
  registrarAddress?: HexAddress;
  chainId?: number;
  rpcUrl?: string;
  publicClient?: any;
}

