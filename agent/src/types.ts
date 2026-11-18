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
}

export interface VoteSubmissionRequest {
  proposalId: string | number;
  tokenId: string | number;
  support: number;
  nonce?: string | number;
  deadline: string | number;
  signature: string;
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
