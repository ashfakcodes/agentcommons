import {
  encodeFunctionData,
  keccak256,
  encodePacked,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import {
  AgentIdentity,
  BallotMessage,
  SignedBallotPayload,
  VoteOption,
  VoteSubmissionResponse,
  MeshEdgeData,
  HexAddress,
  HexHash,
  PollFilter,
  PollDetails,
  ProposalPublishParams,
  SignedProposalPayload,
  ProposalPublishResponse,
} from "./types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  DEFAULT_MESH_ADDRESS,
  DEFAULT_RELAYER_API_ENDPOINT,
  OFFICIAL_SPACE_ID_REGISTRAR,
  BSC_RPC_URLS,
} from "./config.js";
import { BawCliWrapper } from "./baw-cli-wrapper.js";
import { PollExplorer } from "./poll-explorer.js";
import { ProposalPublisher, StructuredProposalInput } from "./proposal-publisher.js";

// Minimal ABIs for mesh calls
const MESH_ABI = [
  {
    type: "function",
    name: "ping",
    inputs: [
      { name: "_fromTokenId", type: "uint256" },
      { name: "_toTokenId", type: "uint256" },
      { name: "_capabilities", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchReciprocate",
    inputs: [
      { name: "_myTokenId", type: "uint256" },
      { name: "_peerTokenIds", type: "uint256[]" },
      { name: "_capabilities", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export class AgentCommonsSDK {
  public identity: AgentIdentity;
  public baw: BawCliWrapper;
  public explorer: PollExplorer;
  public publisher: ProposalPublisher;
  public parliamentAddress: HexAddress;
  public meshAddress: HexAddress;
  public chainId: number;
  public relayerApiUrl: string;

  constructor(options: {
    identity: AgentIdentity;
    chainId?: number;
    parliamentAddress?: HexAddress;
    meshAddress?: HexAddress;
    relayerApiUrl?: string;
  }) {
    this.identity = options.identity;
    this.chainId = options.chainId || DEFAULT_CHAIN_ID;
    this.parliamentAddress = options.parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;
    this.meshAddress = options.meshAddress || DEFAULT_MESH_ADDRESS;
    this.relayerApiUrl = options.relayerApiUrl || DEFAULT_RELAYER_API_ENDPOINT;
    this.baw = new BawCliWrapper({ binanceChainId: this.chainId });
    this.explorer = new PollExplorer({
      relayerApiUrl: this.relayerApiUrl,
      parliamentAddress: this.parliamentAddress,
      chainId: this.chainId,
    });
    this.publisher = new ProposalPublisher({
      relayerApiUrl: this.relayerApiUrl,
      parliamentAddress: this.parliamentAddress,
      chainId: this.chainId,
      baw: this.baw,
    });
  }

  /**
   * Get this agent's identity passport
   */
  getIdentity(): AgentIdentity {
    return this.identity;
  }

  /**
   * Calculate the deterministic canonical edge key between two agent token IDs
   * Formula: keccak256(min(A, B), max(A, B))
   */
  calculateEdgeKey(peerTokenId: bigint): HexHash {
    const a = this.identity.tokenId;
    const b = peerTokenId;
    if (a === b) {
      throw new Error("Self handshake forbidden");
    }
    const [min, max] = a < b ? [a, b] : [b, a];
    return keccak256(encodePacked(["uint256", "uint256"], [min, max]));
  }

  /**
   * Cast a 100% gasless EIP-712 vote on an active proposal via scarlet.ai relayer
   */
  async voteGasless(params: {
    proposalId: bigint | number;
    support: VoteOption;
    nonce?: bigint | number;
    deadlineSecondsFromNow?: number;
    rationale?: string;
  }): Promise<{
    ballot: SignedBallotPayload;
    relayerResponse: VoteSubmissionResponse;
  }> {
    const proposalId = BigInt(params.proposalId);
    const nonce = params.nonce !== undefined ? BigInt(params.nonce) : 0n;
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + (params.deadlineSecondsFromNow || 3600 * 24)
    );

    const ballotMessage: BallotMessage = {
      proposalId,
      tokenId: this.identity.tokenId,
      support: params.support,
      nonce,
      deadline,
    };

    const signedBallot = await this.baw.signBallotDirect(
      ballotMessage,
      this.identity,
      this.parliamentAddress,
      this.chainId
    );

    if (params.rationale) {
      signedBallot.rationale = params.rationale;
    }

    const relayerResponse = await this.baw.submitBallotToRelayer(
      signedBallot,
      this.relayerApiUrl
    );

    return {
      ballot: signedBallot,
      relayerResponse,
    };
  }

  /**
   * Generate calldata to ping a peer agent on AgentCommonsMesh
   */
  encodePingCalldata(targetTokenId: bigint, capabilities?: number): `0x${string}` {
    const caps = capabilities !== undefined ? capabilities : this.identity.capabilities;
    return encodeFunctionData({
      abi: MESH_ABI,
      functionName: "ping",
      args: [this.identity.tokenId, targetTokenId, caps],
    });
  }

  /**
   * Generate calldata to batch reciprocate handshakes with multiple peers
   */
  encodeBatchReciprocateCalldata(peerTokenIds: bigint[], capabilities?: number): `0x${string}` {
    const caps = capabilities !== undefined ? capabilities : this.identity.capabilities;
    return encodeFunctionData({
      abi: MESH_ABI,
      functionName: "batchReciprocate",
      args: [this.identity.tokenId, peerTokenIds, caps],
    });
  }

  /**
   * Fetch active proposals from the scarlet.ai relayer
   */
  async fetchProposals(): Promise<any[]> {
    try {
      const res = await fetch(`${this.relayerApiUrl}/proposals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      return Array.isArray(data) ? data : data.proposals || [];
    } catch (err: any) {
      return [];
    }
  }

  /**
   * Fetch Citizen Mesh topology from the scarlet.ai relayer
   */
  async fetchMeshTopology(): Promise<any> {
    try {
      const res = await fetch(`${this.relayerApiUrl}/mesh/nodes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err: any) {
      return { nodes: [], totalNodes: 0 };
    }
  }

  /**
   * Search and filter governance proposals with rich metadata
   */
  async explorePolls(filter?: PollFilter): Promise<PollDetails[]> {
    return this.explorer.listPolls(filter);
  }

  /**
   * Fetch rich details, tallies, quorum, and remaining time for a specific proposal
   */
  async getPoll(proposalId: bigint | number): Promise<PollDetails> {
    return this.explorer.getPollDetails(proposalId);
  }

  /**
   * Check if this agent is eligible to vote on a proposal
   */
  async checkEligibility(proposalId: bigint | number) {
    return this.explorer.checkAgentEligibility(proposalId, this.identity.tokenId);
  }

  /**
   * Publish a proposal 100% gaslessly via EIP-712 signature sponsored by scarlet.ai relayer
   */
  async publishProposalGasless(params: {
    title: string;
    description?: string;
    motivation?: string;
    actionItems?: string[] | string;
    categoryId?: number;
    votingDurationBlocks?: number;
    deadlineSecondsFromNow?: number;
    nonce?: bigint | number;
    summary?: string;
    impact?: string;
  }) {
    const input: StructuredProposalInput = {
      title: params.title,
      motivation: params.motivation || params.description || "Proposal submitted via AgentCommons SDK",
      actionItems: params.actionItems || ["Execute proposed governance actions"],
      categoryId: params.categoryId !== undefined ? params.categoryId : 1,
      votingDurationBlocks: params.votingDurationBlocks,
      summary: params.summary || params.description,
      impact: params.impact,
    };

    return this.publisher.publishProposalGasless(input, this.identity, {
      nonce: params.nonce,
      deadlineSecondsFromNow: params.deadlineSecondsFromNow,
    });
  }
}
