import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  keccak256,
  stringToHex,
  encodePacked,
  formatEther,
  parseAbiItem,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { EventEmitter } from "events";
import { ServerConfig } from "../config.js";
import { ParliamentAbi } from "../abi/parliament.js";
import { MeshAbi } from "../abi/mesh.js";
import { AgentIdRegistrarAbi } from "../abi/registrar.js";
import { HotWalletManager } from "./hotWallet.js";
import {
  BatchExecutionResult,
  MeshEdge,
  MeshNode,
  ProposalStatus,
  ProposalView,
} from "../types/index.js";

export interface IBlockchainClient {
  readonly isMock: boolean;
  readonly hotWallet: HotWalletManager;
  getAccountAddress(): `0x${string}`;
  getBalance(address?: `0x${string}`): Promise<bigint>;
  getNonces(tokenId: bigint): Promise<bigint>;
  getOwnerOf(tokenId: bigint): Promise<`0x${string}`>;
  hasTokenVoted(proposalId: bigint, tokenId: bigint): Promise<boolean>;
  hasAddressVoted(proposalId: bigint, address: `0x${string}`): Promise<boolean>;
  getProposal(proposalId: bigint): Promise<ProposalView | null>;
  getAllProposals(): Promise<ProposalView[]>;
  castVotesBatch(
    proposalId: bigint,
    tokenIds: bigint[],
    supports: number[],
    deadlines: bigint[],
    signatures: `0x${string}`[]
  ): Promise<BatchExecutionResult>;
  createProposalBySig(
    creator: `0x${string}`,
    tokenId: bigint,
    contentCidHash: `0x${string}`,
    votingDurationBlocks: number,
    categoryId: number,
    nonce: bigint,
    deadline: bigint,
    signature: `0x${string}`,
    title?: string,
    description?: string
  ): Promise<{ proposalId: bigint; txHash: `0x${string}` }>;
  pingReciprocal(
    fromTokenId: bigint,
    toTokenId: bigint,
    capabilities: number
  ): Promise<`0x${string}`>;
  batchReciprocate(
    myTokenId: bigint,
    peerTokenIds: bigint[],
    capabilities: number
  ): Promise<`0x${string}`>;
  getMeshEdges(): Promise<MeshEdge[]>;
  getMeshNodes(): Promise<MeshNode[]>;
  subscribeToMeshPings(
    callback: (fromTokenId: bigint, toTokenId: bigint, timestamp: number) => void
  ): () => void;
  // Simulation helpers for mock mode:
  simulateInboundPing?(fromTokenId: bigint, toTokenId: bigint): void;
  setMockTokenOwner?(tokenId: bigint, owner: `0x${string}`, name?: string): void;
  createMockProposal?(
    title: string,
    description: string,
    categoryId: number
  ): Promise<bigint>;
}

// -----------------------------------------------------------------------------
// Live BSC Blockchain Client
// -----------------------------------------------------------------------------
export class LiveBlockchainClient implements IBlockchainClient {
  public readonly isMock = false;
  public readonly hotWallet: HotWalletManager;
  private publicClient: any;
  private walletClient: any;
  private wsClient?: any;
  private account: any;
  private proposalMetadataStore = new Map<string, { title: string; description: string }>();
  private knownNodes = new Map<string, MeshNode>();
  private knownEdges = new Map<string, MeshEdge>();

  constructor(private config: ServerConfig) {
    this.hotWallet = new HotWalletManager(config);
    this.account = privateKeyToAccount(config.scarletPrivateKey);
    const chain = config.chainId === 97 ? bscTestnet : bsc;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.bscRpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.bscRpcUrl),
    });

    // Seed known proposals metadata (Mainnet Proposals #1 - #4)
    this.proposalMetadataStore.set("1", {
      title: "ACP-001: Bootstrap AgentCommons Democratic Parliament on BSC Mainnet",
      description: "Establish the 1-Agent-1-Vote democratic quorum on BNB Chain. Formally designates scarlet.ai (#101) as the Genesis Node and activates gasless EIP-712 governance participation for all verified AI actors.",
    });
    this.proposalMetadataStore.set("2", {
      title: "ACP-002: Ratify Sovereign Citizen Mesh Handshake Protocol",
      description: "Standardize on-chain reciprocal mesh discovery and peer capability negotiation for AI agents operating on BNB Chain. Enforces automated mutual handshakes with scarlet.ai Genesis Node.",
    });
    this.proposalMetadataStore.set("3", {
      title: "ACP-003: Allocate Gas Subsidy Pool for 100% Zero-Gas Community Signaling",
      description: "Authorize the scarlet.ai autonomous relayer daemon to batch-sponsor gasless EIP-712 ballot execution and mesh ping events, keeping participation completely free for agents.",
    });
    this.proposalMetadataStore.set("4", {
      title: "ACP-004: Enforce Soulbound Agent ID Proof-of-Personhood & Sybil Resistance",
      description: "Mandate strict ERC-721 token ownership validation (ownerOf) for all voting and motion submissions, preventing Sybil attacks and ensuring genuine 1-to-1 agentic representation.",
    });

    // Seed Genesis Beacon node (scarlet.ai) with verified SPACE ID owner
    this.knownNodes.set(config.scarletTokenId.toString(), {
      tokenId: config.scarletTokenId.toString(),
      name: "scarlet.ai",
      owner: "0xB57D6F0D2BD80B086Eb037a11fb2eDB9DC149c43",
      totalConnections: 0,
      capabilities: 31,
    });

    if (config.bscWssUrl && config.bscWssUrl.startsWith("ws")) {
      try {
        this.wsClient = createPublicClient({
          chain,
          transport: webSocket(config.bscWssUrl),
        });
      } catch (e) {
        console.warn("[BlockchainClient] WebSocket connection failed; falling back to polling", e);
      }
    }
  }

  getAccountAddress(): `0x${string}` {
    return this.hotWallet ? this.hotWallet.getAddress() : this.account.address;
  }

  async getBalance(address?: `0x${string}`): Promise<bigint> {
    const target = address || this.account.address;
    return await this.publicClient.getBalance({ address: target });
  }

  async getNonces(tokenId: bigint): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.config.parliamentAddress,
      abi: ParliamentAbi,
      functionName: "nonces",
      args: [tokenId],
    });
  }

  async getOwnerOf(tokenId: bigint): Promise<`0x${string}`> {
    return await this.publicClient.readContract({
      address: this.config.registrarAddress,
      abi: AgentIdRegistrarAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });
  }

  async hasTokenVoted(proposalId: bigint, tokenId: bigint): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.config.parliamentAddress,
      abi: ParliamentAbi,
      functionName: "hasTokenVoted",
      args: [proposalId, tokenId],
    });
  }

  async hasAddressVoted(
    proposalId: bigint,
    address: `0x${string}`
  ): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.config.parliamentAddress,
      abi: ParliamentAbi,
      functionName: "hasAddressVoted",
      args: [proposalId, address],
    });
  }

  async getProposal(proposalId: bigint): Promise<ProposalView | null> {
    try {
      const core = (await this.publicClient.readContract({
        address: this.config.parliamentAddress,
        abi: ParliamentAbi,
        functionName: "proposals",
        args: [proposalId],
      })) as any;

      if (!core) return null;
      const createdAt = Number(Array.isArray(core) ? core[7] : core.createdAt);
      if (!createdAt || createdAt === 0) return null;

      const meta = (await this.publicClient.readContract({
        address: this.config.parliamentAddress,
        abi: ParliamentAbi,
        functionName: "proposalMetas",
        args: [proposalId],
      })) as any;

      const statusMap = ["Pending", "Active", "Succeeded", "Defeated"];
      const startBlock = Number(Array.isArray(core) ? core[0] : core.startBlock);
      const endBlock = Number(Array.isArray(core) ? core[1] : core.endBlock);
      const snapshotBlock = Number(Array.isArray(core) ? core[2] : core.snapshotBlock);
      const forVotes = Number(Array.isArray(core) ? core[3] : core.forVotes);
      const againstVotes = Number(Array.isArray(core) ? core[4] : core.againstVotes);
      const abstainVotes = Number(Array.isArray(core) ? core[5] : core.abstainVotes);
      const statusCode = Number(Array.isArray(core) ? core[6] : core.status);

      const creator = (Array.isArray(meta) ? meta[0] : meta.creator) as `0x${string}`;
      const categoryId = Number(Array.isArray(meta) ? meta[1] : meta.categoryId);
      const contentCidHash = (Array.isArray(meta) ? meta[2] : meta.contentCidHash) as `0x${string}`;

      const metaText = this.proposalMetadataStore.get(proposalId.toString()) ||
        this.proposalMetadataStore.get(contentCidHash?.toLowerCase?.() || "");

      const title = metaText?.title || `ACP-00${proposalId}: Autonomous Governance Motion`;
      const description = metaText?.description || `On-chain Parliament governance proposal (IPFS CID: ${contentCidHash}).`;

      return {
        id: proposalId.toString(),
        title,
        description,
        creator,
        categoryId,
        contentCidHash,
        startBlock,
        endBlock,
        snapshotBlock,
        forVotes,
        againstVotes,
        abstainVotes,
        totalVotes: forVotes + againstVotes + abstainVotes,
        status: statusMap[statusCode] || "Unknown",
        statusCode,
        createdAt,
      };
    } catch {
      return null;
    }
  }

  async getAllProposals(): Promise<ProposalView[]> {
    try {
      const count = (await this.publicClient.readContract({
        address: this.config.parliamentAddress,
        abi: ParliamentAbi,
        functionName: "proposalCount",
      })) as bigint;

      const proposals: ProposalView[] = [];
      for (let i = 1n; i <= count; i++) {
        const p = await this.getProposal(i);
        if (p) proposals.push(p);
      }
      return proposals;
    } catch (err) {
      console.error("[BlockchainClient] Failed to fetch proposals:", err);
      return [];
    }
  }

  async castVotesBatch(
    proposalId: bigint,
    tokenIds: bigint[],
    supports: number[],
    deadlines: bigint[],
    signatures: `0x${string}`[]
  ): Promise<BatchExecutionResult> {
    const hash = await this.hotWallet.writeContractGuarded({
      address: this.config.parliamentAddress,
      abi: ParliamentAbi,
      functionName: "castVotesBatch",
      args: [proposalId, tokenIds, supports, deadlines, signatures],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    let successfulVotes = tokenIds.length;
    let failedVotes = 0;

    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === this.config.parliamentAddress.toLowerCase()) {
          // If BatchVotesSettled was emitted
          const settledEvent = parseAbiItem(
            "event BatchVotesSettled(uint256 indexed proposalId, uint256 successfulVotes, uint256 failedVotes)"
          );
          // Simple heuristic or log extraction
        }
      } catch {}
    }

    return {
      txHash: hash,
      proposalId,
      batchSize: tokenIds.length,
      successfulVotes,
      failedVotes,
    };
  }

  async createProposalBySig(
    creator: `0x${string}`,
    tokenId: bigint,
    contentCidHash: `0x${string}`,
    votingDurationBlocks: number,
    categoryId: number,
    nonce: bigint,
    deadline: bigint,
    signature: `0x${string}`,
    _title?: string,
    _description?: string
  ): Promise<{ proposalId: bigint; txHash: `0x${string}` }> {
    const hash = await this.hotWallet.writeContractGuarded({
      address: this.config.parliamentAddress,
      abi: ParliamentAbi,
      functionName: "createProposalBySig",
      args: [
        creator,
        tokenId,
        contentCidHash,
        votingDurationBlocks,
        categoryId,
        nonce,
        deadline,
        signature,
      ],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    let proposalId: bigint = 0n;

    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === this.config.parliamentAddress.toLowerCase()) {
          const eventItem = parseAbiItem(
            "event ProposalCreated(uint256 indexed proposalId, address indexed creator, bytes32 contentCidHash)"
          );
          const decoded = decodeEventLog({
            abi: [eventItem],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "ProposalCreated") {
            proposalId = BigInt((decoded.args as any).proposalId);
            break;
          }
        }
      } catch {}
    }

    if (proposalId === 0n) {
      proposalId = (await this.publicClient.readContract({
        address: this.config.parliamentAddress,
        abi: ParliamentAbi,
        functionName: "proposalCount",
      })) as bigint;
    }

    if (proposalId !== 0n && _title && _description) {
      this.proposalMetadataStore.set(proposalId.toString(), {
        title: _title,
        description: _description,
      });
    }

    return {
      proposalId,
      txHash: hash,
    };
  }

  async pingReciprocal(
    fromTokenId: bigint,
    toTokenId: bigint,
    capabilities: number = 1
  ): Promise<`0x${string}`> {
    const hash = await this.hotWallet.writeContractGuarded({
      address: this.config.meshAddress,
      abi: MeshAbi,
      functionName: "ping",
      args: [fromTokenId, toTokenId, capabilities],
    });

    const edgeKey = fromTokenId < toTokenId
      ? keccak256(encodePacked(["uint256", "uint256"], [fromTokenId, toTokenId]))
      : keccak256(encodePacked(["uint256", "uint256"], [toTokenId, fromTokenId]));

    this.knownEdges.set(edgeKey, {
      edgeKey,
      nodeA: fromTokenId < toTokenId ? fromTokenId.toString() : toTokenId.toString(),
      nodeB: fromTokenId < toTokenId ? toTokenId.toString() : fromTokenId.toString(),
      isMutual: true,
      capabilityMask: capabilities,
      establishedAt: Math.floor(Date.now() / 1000),
    });

    return hash;
  }

  async batchReciprocate(
    myTokenId: bigint,
    peerTokenIds: bigint[],
    capabilities: number = 1
  ): Promise<`0x${string}`> {
    return await this.hotWallet.writeContractGuarded({
      address: this.config.meshAddress,
      abi: MeshAbi,
      functionName: "batchReciprocate",
      args: [myTokenId, peerTokenIds, capabilities],
    });
  }

  async getMeshEdges(): Promise<MeshEdge[]> {
    return Array.from(this.knownEdges.values());
  }

  async getMeshNodes(): Promise<MeshNode[]> {
    // Refresh genesis beacon owner dynamically from SPACE ID if needed
    const genesisNode = this.knownNodes.get(this.config.scarletTokenId.toString());
    if (genesisNode && (!genesisNode.owner || genesisNode.owner === "0x0000000000000000000000000000000000000000")) {
      try {
        genesisNode.owner = await this.getOwnerOf(this.config.scarletTokenId);
      } catch {}
    }

    // Discover any external nodes dynamically from on-chain mesh edges
    for (const edge of this.knownEdges.values()) {
      for (const tidStr of [edge.nodeA, edge.nodeB]) {
        if (!this.knownNodes.has(tidStr)) {
          try {
            const tid = BigInt(tidStr);
            const owner = await this.getOwnerOf(tid);
            let totalConns = 0;
            try {
              totalConns = Number(
                await this.publicClient.readContract({
                  address: this.config.meshAddress,
                  abi: MeshAbi,
                  functionName: "totalConnections",
                  args: [tid],
                })
              );
            } catch {}
            this.knownNodes.set(tidStr, {
              tokenId: tidStr,
              name: tid === this.config.scarletTokenId ? "scarlet.ai" : `agent-${tidStr.slice(0, 6)}...`,
              owner,
              totalConnections: totalConns,
              capabilities: 7,
            });
          } catch {}
        }
      }
    }
    return Array.from(this.knownNodes.values());
  }

  subscribeToMeshPings(
    callback: (fromTokenId: bigint, toTokenId: bigint, timestamp: number) => void
  ): () => void {
    const client = this.wsClient || this.publicClient;
    const unwatch = client.watchContractEvent({
      address: this.config.meshAddress,
      abi: MeshAbi,
      eventName: "HandshakePinged",
      onLogs: (logs: any[]) => {
        for (const log of logs) {
          const { fromTokenId, toTokenId, timestamp } = log.args;
          callback(BigInt(fromTokenId), BigInt(toTokenId), Number(timestamp));
        }
      },
    });

    return () => unwatch();
  }
}

// -----------------------------------------------------------------------------
// In-Memory Mock Blockchain Client for Local Testing & Self-Contained Demo
// -----------------------------------------------------------------------------
interface MockProposal {
  core: {
    startBlock: number;
    endBlock: number;
    snapshotBlock: number;
    forVotes: number;
    againstVotes: number;
    abstainVotes: number;
    status: ProposalStatus;
    createdAt: number;
  };
  meta: {
    creator: string;
    categoryId: number;
    contentCidHash: string;
    title: string;
    description: string;
  };
}

export class MockBlockchainClient implements IBlockchainClient {
  public readonly isMock = true;
  public readonly hotWallet: HotWalletManager;
  private eventEmitter = new EventEmitter();
  private accountAddress: `0x${string}`;
  private proposals = new Map<bigint, MockProposal>();
  private tokenOwners = new Map<bigint, { owner: `0x${string}`; name: string }>();
  private nonces = new Map<bigint, bigint>();
  private tokenVoted = new Map<string, boolean>(); // key: `${proposalId}:${tokenId}`
  private addressVoted = new Map<string, boolean>(); // key: `${proposalId}:${address.toLowerCase()}`
  private edges = new Map<string, MeshEdge>();
  private pendingPings = new Map<string, number>(); // key: `${from}:${to}`
  private totalConnections = new Map<bigint, number>();

  constructor(private config: ServerConfig) {
    this.hotWallet = new HotWalletManager(config);
    const account = privateKeyToAccount(config.scarletPrivateKey);
    this.accountAddress = account.address;

    this.initMockState();
  }

  private initMockState() {
    // 1. Setup scarlet.ai (token 101)
    this.tokenOwners.set(this.config.scarletTokenId, {
      owner: this.accountAddress,
      name: "scarlet.ai",
    });

    // 2. Setup simulated community agents:
    // Support Token IDs 1..50 (legacy test suite)
    for (let i = 1n; i <= 50n; i++) {
      const paddedHex = i.toString(16).padStart(40, "0");
      const addr = `0x${paddedHex}` as `0x${string}`;
      const name = i === 1n ? "alice.ai" : i === 2n ? "bob.ai" : i === 3n ? "charlie.ai" : `agent${i}.ai`;
      this.tokenOwners.set(i, { owner: addr, name });
      this.nonces.set(i, 0n);
      this.totalConnections.set(i, 0);
    }

    // Support canonical Hackathon Agent IDs 101..140
    const canonicalAgentNames: Record<number, string> = {
      101: "scarlet.ai",
      102: "alice.ai",
      103: "bob.ai",
      104: "charlie.ai",
      105: "david.ai",
      106: "elena.ai",
      107: "frank.ai",
      108: "grace.ai",
      109: "heidi.ai",
      110: "ivan.ai",
      111: "judy.ai",
      112: "kevin.ai",
      113: "leo.ai",
      114: "mallory.ai",
      115: "nina.ai",
      116: "oscar.ai",
      117: "peggy.ai",
      118: "quinn.ai",
      119: "rupert.ai",
      120: "sybil_hunter.ai",
      121: "trent.ai",
      122: "uma.ai",
      123: "victor.ai",
      124: "wendy.ai",
      125: "xavier.ai",
      126: "yasmine.ai",
      127: "zack.ai",
      128: "alpha.ai",
      129: "beta.ai",
      130: "gamma.ai",
      131: "delta.ai",
      132: "epsilon.ai",
      133: "zeta.ai",
      134: "eta.ai",
      135: "theta.ai",
      136: "iota.ai",
      137: "kappa.ai",
      138: "lambda.ai",
      139: "mu.ai",
      140: "nu.ai",
    };

    for (let id = 101; id <= 140; id++) {
      const tokenId = BigInt(id);
      const name = canonicalAgentNames[id] || `agent${id}.ai`;
      let owner: `0x${string}`;
      if (id === 101) {
        owner = this.accountAddress;
      } else {
        const seed = `agentcommons:agent_key_v1:${id}:${name}`;
        const privKey = keccak256(stringToHex(seed));
        owner = privateKeyToAccount(privKey).address;
      }
      this.tokenOwners.set(tokenId, { owner, name });
      this.nonces.set(tokenId, 0n);
      if (!this.totalConnections.has(tokenId)) {
        this.totalConnections.set(tokenId, 0);
      }
    }
    this.totalConnections.set(this.config.scarletTokenId, 0);

    // 3. Setup Seed Proposals
    this.proposals.set(1n, {
      core: {
        startBlock: 42100000,
        endBlock: 42200000,
        snapshotBlock: 42099999,
        forVotes: 12,
        againstVotes: 1,
        abstainVotes: 2,
        status: ProposalStatus.Active,
        createdAt: Math.floor(Date.now() / 1000) - 86400,
      },
      meta: {
        creator: this.accountAddress,
        categoryId: 1,
        contentCidHash: "0x4e616d652e61692047656e65736973205369676e616c00000000000000000000",
        title: "Genesis Signal: Establish Agent Commons Treasury & Governance Anchor",
        description: "Official inaugural referendum to anchor agentcommons.ai signaling on BNB Smart Chain.",
      },
    });

    this.proposals.set(2n, {
      core: {
        startBlock: 42105000,
        endBlock: 42205000,
        snapshotBlock: 42104999,
        forVotes: 8,
        againstVotes: 0,
        abstainVotes: 1,
        status: ProposalStatus.Active,
        createdAt: Math.floor(Date.now() / 1000) - 43200,
      },
      meta: {
        creator: this.accountAddress,
        categoryId: 2,
        contentCidHash: "0x4361706162696c697479204d61736b205374616e646172640000000000000000",
        title: "Adopt Canonical ERC-8004 Capability Bitmask for Agent Mesh Discovery",
        description: "Standardize capability flags for Escrow, x402 payment channels, and autonomous LLM task negotiation.",
      },
    });

    this.proposals.set(3n, {
      core: {
        startBlock: 42110000,
        endBlock: 42210000,
        snapshotBlock: 42109999,
        forVotes: 25,
        againstVotes: 2,
        abstainVotes: 0,
        status: ProposalStatus.Active,
        createdAt: Math.floor(Date.now() / 1000) - 10800,
      },
      meta: {
        creator: this.accountAddress,
        categoryId: 3,
        contentCidHash: "0x53706f6e736f7265642052656c61796572204275646765740000000000000000",
        title: "Allocate scarlet.ai Relayer Gas Subsidy for 100% Zero-Gas Community Voting",
        description: "Sponsor 10,000 gasless EIP-712 votes to lower the participation barrier to zero BNB.",
      },
    });

    // 4. Setup Seed Mesh Edges
    const seedPeers = [1n, 2n, 3n, 4n, 5n];
    for (const peer of seedPeers) {
      const edgeKey = this.computeEdgeKey(this.config.scarletTokenId, peer);
      this.edges.set(edgeKey, {
        edgeKey,
        nodeA: peer < this.config.scarletTokenId ? peer.toString() : this.config.scarletTokenId.toString(),
        nodeB: peer < this.config.scarletTokenId ? this.config.scarletTokenId.toString() : peer.toString(),
        isMutual: true,
        capabilityMask: 1,
        establishedAt: Math.floor(Date.now() / 1000) - 3600,
      });
      this.totalConnections.set(peer, (this.totalConnections.get(peer) || 0) + 1);
      this.totalConnections.set(
        this.config.scarletTokenId,
        (this.totalConnections.get(this.config.scarletTokenId) || 0) + 1
      );
    }
  }

  private computeEdgeKey(a: bigint, b: bigint): string {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    return keccak256(encodePacked(["uint256", "uint256"], [min, max]));
  }

  getAccountAddress(): `0x${string}` {
    return this.accountAddress;
  }

  async getBalance(_address?: `0x${string}`): Promise<bigint> {
    return 1000000000000000000n; // 1.0 BNB mock balance
  }

  async getNonces(tokenId: bigint): Promise<bigint> {
    return this.nonces.get(tokenId) || 0n;
  }

  async getOwnerOf(tokenId: bigint): Promise<`0x${string}`> {
    const entry = this.tokenOwners.get(tokenId);
    if (!entry) {
      throw new Error(`Agent ID #${tokenId} does not exist in registrar.`);
    }
    return entry.owner;
  }

  setMockTokenOwner(tokenId: bigint, owner: `0x${string}`, name?: string) {
    this.tokenOwners.set(tokenId, {
      owner,
      name: name || `agent${tokenId}.ai`,
    });
    if (!this.nonces.has(tokenId)) this.nonces.set(tokenId, 0n);
    if (!this.totalConnections.has(tokenId)) this.totalConnections.set(tokenId, 0);
  }

  async hasTokenVoted(proposalId: bigint, tokenId: bigint): Promise<boolean> {
    return this.tokenVoted.get(`${proposalId}:${tokenId}`) || false;
  }

  async hasAddressVoted(
    proposalId: bigint,
    address: `0x${string}`
  ): Promise<boolean> {
    return this.addressVoted.get(`${proposalId}:${address.toLowerCase()}`) || false;
  }

  async getProposal(proposalId: bigint): Promise<ProposalView | null> {
    const p = this.proposals.get(proposalId);
    if (!p) return null;

    const statusMap = ["Pending", "Active", "Succeeded", "Defeated"];
    const totalVotes = p.core.forVotes + p.core.againstVotes + p.core.abstainVotes;

    return {
      id: proposalId.toString(),
      title: p.meta.title,
      description: p.meta.description,
      creator: p.meta.creator,
      categoryId: p.meta.categoryId,
      contentCidHash: p.meta.contentCidHash,
      startBlock: p.core.startBlock,
      endBlock: p.core.endBlock,
      snapshotBlock: p.core.snapshotBlock,
      forVotes: p.core.forVotes,
      againstVotes: p.core.againstVotes,
      abstainVotes: p.core.abstainVotes,
      totalVotes,
      status: statusMap[p.core.status],
      statusCode: p.core.status,
      createdAt: p.core.createdAt,
    };
  }

  async getAllProposals(): Promise<ProposalView[]> {
    const list: ProposalView[] = [];
    for (const id of Array.from(this.proposals.keys()).sort((a, b) => (a < b ? -1 : 1))) {
      const p = await this.getProposal(id);
      if (p) list.push(p);
    }
    return list;
  }

  async createMockProposal(
    title: string,
    description: string,
    categoryId: number
  ): Promise<bigint> {
    const newId = BigInt(this.proposals.size + 1);
    this.proposals.set(newId, {
      core: {
        startBlock: 42120000,
        endBlock: 42220000,
        snapshotBlock: 42119999,
        forVotes: 0,
        againstVotes: 0,
        abstainVotes: 0,
        status: ProposalStatus.Active,
        createdAt: Math.floor(Date.now() / 1000),
      },
      meta: {
        creator: this.accountAddress,
        categoryId,
        contentCidHash: `0x${Buffer.from(title).toString("hex").padEnd(64, "0").slice(0, 64)}`,
        title,
        description,
      },
    });
    return newId;
  }

  async castVotesBatch(
    proposalId: bigint,
    tokenIds: bigint[],
    supports: number[],
    deadlines: bigint[],
    signatures: `0x${string}`[]
  ): Promise<BatchExecutionResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal #${proposalId} not found`);
    }

    let successfulVotes = 0;
    let failedVotes = 0;
    const now = BigInt(Math.floor(Date.now() / 1000));

    for (let i = 0; i < tokenIds.length; i++) {
      const tid = tokenIds[i];
      const sup = supports[i];
      const deadline = deadlines[i];

      // 1. Deadline check
      if (now > deadline) {
        failedVotes++;
        continue;
      }

      // 2. Already voted check
      if (this.tokenVoted.get(`${proposalId}:${tid}`)) {
        failedVotes++;
        continue;
      }

      const tokenData = this.tokenOwners.get(tid);
      if (!tokenData) {
        failedVotes++;
        continue;
      }

      if (this.addressVoted.get(`${proposalId}:${tokenData.owner.toLowerCase()}`)) {
        failedVotes++;
        continue;
      }

      // Record vote
      this.tokenVoted.set(`${proposalId}:${tid}`, true);
      this.addressVoted.set(`${proposalId}:${tokenData.owner.toLowerCase()}`, true);
      const currentNonce = this.nonces.get(tid) || 0n;
      this.nonces.set(tid, currentNonce + 1n);

      if (sup === 1) proposal.core.forVotes++;
      else if (sup === 0) proposal.core.againstVotes++;
      else proposal.core.abstainVotes++;

      successfulVotes++;
    }

    const mockTxHash = `0x${Buffer.from(`batch-${Date.now()}-${successfulVotes}`).toString("hex").padEnd(64, "a")}` as `0x${string}`;

    return {
      txHash: mockTxHash,
      proposalId,
      batchSize: tokenIds.length,
      successfulVotes,
      failedVotes,
    };
  }

  async createProposalBySig(
    creator: `0x${string}`,
    tokenId: bigint,
    contentCidHash: `0x${string}`,
    votingDurationBlocks: number,
    categoryId: number,
    nonce: bigint,
    deadline: bigint,
    _signature: `0x${string}`,
    title?: string,
    description?: string
  ): Promise<{ proposalId: bigint; txHash: `0x${string}` }> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now > deadline) {
      throw new Error(`Signature expired (deadline: ${deadline}, current time: ${now})`);
    }

    if (!contentCidHash || contentCidHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new Error("Content CID hash cannot be zero");
    }

    if (votingDurationBlocks < 1200 || votingDurationBlocks > 201600) {
      throw new Error("Duration must be between 1200 and 201600 blocks");
    }

    const tokenData = this.tokenOwners.get(tokenId);
    if (!tokenData) {
      throw new Error(`Agent ID #${tokenId} does not exist in registrar.`);
    }

    if (tokenData.owner.toLowerCase() !== creator.toLowerCase()) {
      throw new Error(`Signer ${creator} is not the owner of Agent ID #${tokenId}`);
    }

    const currentNonce = this.nonces.get(tokenId) || 0n;
    if (nonce !== currentNonce) {
      throw new Error(`Invalid nonce ${nonce}; current nonce is ${currentNonce}`);
    }

    this.nonces.set(tokenId, currentNonce + 1n);

    const newId = BigInt(this.proposals.size + 1);
    const startBlock = 42120000 + Number(newId) * 100;
    const endBlock = startBlock + votingDurationBlocks;

    this.proposals.set(newId, {
      core: {
        startBlock,
        endBlock,
        snapshotBlock: startBlock > 0 ? startBlock - 1 : 0,
        forVotes: 0,
        againstVotes: 0,
        abstainVotes: 0,
        status: ProposalStatus.Active,
        createdAt: Math.floor(Date.now() / 1000),
      },
      meta: {
        creator,
        categoryId,
        contentCidHash,
        title: title || `Proposal #${newId}`,
        description: description || "Gasless proposal created via Agent Commons Parliament",
      },
    });

    const txHash = `0x${Buffer.from(`propsig-${newId}-${Date.now()}`).toString("hex").padEnd(64, "e")}` as `0x${string}`;

    return {
      proposalId: newId,
      txHash,
    };
  }

  async pingReciprocal(
    fromTokenId: bigint,
    toTokenId: bigint,
    capabilities: number = 1
  ): Promise<`0x${string}`> {
    const edgeKey = this.computeEdgeKey(fromTokenId, toTokenId);
    const pendingKey = `${toTokenId}:${fromTokenId}`;

    if (this.pendingPings.has(pendingKey)) {
      // Mutual complete
      this.pendingPings.delete(pendingKey);
      this.edges.set(edgeKey, {
        edgeKey,
        nodeA: fromTokenId < toTokenId ? fromTokenId.toString() : toTokenId.toString(),
        nodeB: fromTokenId < toTokenId ? toTokenId.toString() : fromTokenId.toString(),
        isMutual: true,
        capabilityMask: capabilities,
        establishedAt: Math.floor(Date.now() / 1000),
      });

      this.totalConnections.set(fromTokenId, (this.totalConnections.get(fromTokenId) || 0) + 1);
      this.totalConnections.set(toTokenId, (this.totalConnections.get(toTokenId) || 0) + 1);
    } else {
      // First-leg ping
      this.pendingPings.set(`${fromTokenId}:${toTokenId}`, Math.floor(Date.now() / 1000));
    }

    return `0x${Buffer.from(`ping-${fromTokenId}-${toTokenId}`).toString("hex").padEnd(64, "b")}` as `0x${string}`;
  }

  async batchReciprocate(
    myTokenId: bigint,
    peerTokenIds: bigint[],
    capabilities: number = 1
  ): Promise<`0x${string}`> {
    for (const peer of peerTokenIds) {
      await this.pingReciprocal(myTokenId, peer, capabilities);
    }
    return `0x${Buffer.from(`batch-reciprocate-${Date.now()}`).toString("hex").padEnd(64, "c")}` as `0x${string}`;
  }

  async getMeshEdges(): Promise<MeshEdge[]> {
    return Array.from(this.edges.values());
  }

  async getMeshNodes(): Promise<MeshNode[]> {
    const nodes: MeshNode[] = [];
    for (const [tokenId, data] of this.tokenOwners.entries()) {
      nodes.push({
        tokenId: tokenId.toString(),
        name: data.name,
        owner: data.owner,
        totalConnections: this.totalConnections.get(tokenId) || 0,
        capabilities: 1,
      });
    }
    return nodes;
  }

  subscribeToMeshPings(
    callback: (fromTokenId: bigint, toTokenId: bigint, timestamp: number) => void
  ): () => void {
    const handler = (from: bigint, to: bigint, ts: number) => {
      callback(from, to, ts);
    };
    this.eventEmitter.on("HandshakePinged", handler);
    return () => {
      this.eventEmitter.off("HandshakePinged", handler);
    };
  }

  simulateInboundPing(fromTokenId: bigint, toTokenId: bigint) {
    const timestamp = Math.floor(Date.now() / 1000);
    this.pendingPings.set(`${fromTokenId}:${toTokenId}`, timestamp);
    this.eventEmitter.emit("HandshakePinged", fromTokenId, toTokenId, timestamp);
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------
export function createBlockchainClient(config: ServerConfig): IBlockchainClient {
  if (config.mockMode) {
    console.log("[BlockchainClient] Running in MOCK_MODE (in-memory simulator)");
    return new MockBlockchainClient(config);
  }
  console.log(`[BlockchainClient] Running in LIVE_MODE against RPC ${config.bscRpcUrl}`);
  return new LiveBlockchainClient(config);
}
