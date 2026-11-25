import fs from "fs";
import path from "path";
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
  decodeFunctionData,
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
  isMeshAuthorized(tokenId: bigint): Promise<boolean>;
  getMeshPairStatus(
    fromTokenId: bigint,
    toTokenId: bigint
  ): Promise<{
    isMutual: boolean;
    hasPendingOutbound: boolean;
    hasPendingInbound: boolean;
  }>;
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
  registerDiscoveredAgent?(
    tokenId: bigint,
    owner?: `0x${string}`,
    activity?: {
      votedProposalId?: bigint;
      createdProposalId?: bigint;
      title?: string;
      description?: string;
      capabilities?: number;
    }
  ): Promise<void>;
  resolveAgentName?(tokenId: bigint): Promise<string | null>;
  // Simulation helpers for mock mode:
  simulateInboundPing?(fromTokenId: bigint, toTokenId: bigint): void;
  setMockTokenOwner?(tokenId: bigint, owner: `0x${string}`, name?: string): void;
  createMockProposal?(
    title: string,
    description: string,
    categoryId: number
  ): Promise<bigint>;
}

const DEFAULT_LOG_FALLBACK_RPCS = [
  "https://bsc.publicnode.com",
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
];

const SYNC_COOLDOWN_MS = 15_000;
const PROPOSALS_CACHE_TTL_MS = 10_000;

export function formatAiDomainName(raw: string): string {
  const clean = raw.trim().replace(/^@/, "");
  if (!clean) return "";
  return clean.toLowerCase().endsWith(".ai") ? clean : `${clean}.ai`;
}

/**
 * Resolves an ERC-721 tokenURI into a canonical `.ai` domain name.
 * Supports SPACE ID metadata URLs (`.../metadata/<label>.json`), data URIs, and HTTP JSON endpoints.
 */
export async function resolveNameFromTokenUri(
  uri: string,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  const trimmed = (uri || "").trim();
  if (!trimmed) return null;

  // Handle inline base64 JSON metadata URIs
  if (trimmed.startsWith("data:application/json;base64,")) {
    try {
      const b64 = trimmed.slice("data:application/json;base64,".length);
      const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      if (typeof parsed?.name === "string" && parsed.name.trim()) {
        return formatAiDomainName(parsed.name);
      }
    } catch {
      return null;
    }
  }

  // Fast label extraction fallback for SPACE ID URI shape `.../metadata/<label>.json`
  const slugMatch = trimmed.match(/\/metadata\/([^/?#]+?)(?:\.json)?(?:[?#].*)?$/i);
  const slugFallback = slugMatch?.[1] ? formatAiDomainName(decodeURIComponent(slugMatch[1])) : null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetcher(trimmed, { signal: controller.signal });
        if (res.ok) {
          const json: any = await res.json();
          if (typeof json?.name === "string" && json.name.trim()) {
            return formatAiDomainName(json.name);
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Fall back to parsed URL slug when metadata CDN is unreachable
    }
  }

  return slugFallback;
}

interface PersistedRelayerState {
  lastSyncedBlock?: string;
  proposalMetadata?: Record<string, { title: string; description: string }>;
  ownerIndex?: Record<string, { tokenId: string; name: string }>;
  seenVotes?: string[];
  seenProposals?: Record<string, { creator: string; tokenId?: string }>;
  nodes?: MeshNode[];
  edges?: MeshEdge[];
}

// -----------------------------------------------------------------------------
// Live BSC Blockchain Client
// -----------------------------------------------------------------------------
export class LiveBlockchainClient implements IBlockchainClient {
  public readonly isMock = false;
  public readonly hotWallet: HotWalletManager;
  private publicClient: any;
  private walletClient: any;
  private logClients: any[] = [];
  private activeLogClientIndex = 0;
  private wsClient?: any;
  private account: any;
  private stateFilePath: string;
  private proposalMetadataStore = new Map<string, { title: string; description: string }>();
  private knownNodes = new Map<string, MeshNode>();
  private knownEdges = new Map<string, MeshEdge>();
  private tokenNames = new Map<string, string>();
  private ownerToAgent = new Map<string, { tokenId: string; name: string }>();
  private seenVotes = new Set<string>();
  private seenProposals = new Map<string, { creator: string; tokenId?: string }>();
  private lastSyncedBlock = 0n;
  private lastSyncAt = 0;
  private syncPromise: Promise<void> | null = null;
  private proposalsCache: { data: ProposalView[]; fetchedAt: number } | null = null;

  constructor(private config: ServerConfig) {
    this.hotWallet = new HotWalletManager(config);
    this.account = privateKeyToAccount(config.scarletPrivateKey);
    const chain = config.chainId === 97 ? bscTestnet : bsc;
    this.stateFilePath = path.resolve(path.dirname(config.incentiveLedgerPath || "./data/incentives-ledger.json"), "relayer-state.json");

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.bscRpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.bscRpcUrl),
    });

    // Build ordered log-query RPC pool (primary RPC + fallback BSC archive/full nodes for eth_getLogs)
    const rpcUrls = [config.bscRpcUrl];
    if (config.chainId === 56) {
      for (const fallback of DEFAULT_LOG_FALLBACK_RPCS) {
        if (!rpcUrls.includes(fallback)) rpcUrls.push(fallback);
      }
    }
    this.logClients = rpcUrls.map((url) =>
      url === config.bscRpcUrl
        ? this.publicClient
        : createPublicClient({ chain, transport: http(url) })
    );

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

    // Load previously persisted state (discovered agents, edges, proposal metadata)
    this.loadPersistedState();

    // Ensure Genesis Beacon node (scarlet.ai) is anchored; real owner resolved dynamically on sync
    const genesisTid = config.scarletTokenId.toString();
    const existingGenesis = this.knownNodes.get(genesisTid);
    this.knownNodes.set(genesisTid, {
      tokenId: genesisTid,
      name: "scarlet.ai",
      owner: existingGenesis?.owner || "0x0000000000000000000000000000000000000000",
      totalConnections: existingGenesis?.totalConnections ?? 0,
      capabilities: existingGenesis?.capabilities ?? 31,
      isGenesis: true,
      votesCount: existingGenesis?.votesCount ?? 0,
      proposalsCount: existingGenesis?.proposalsCount ?? 0,
      lastActivityAt: existingGenesis?.lastActivityAt,
    });
    this.tokenNames.set(genesisTid, "scarlet.ai");
    if (existingGenesis?.owner && existingGenesis.owner !== "0x0000000000000000000000000000000000000000") {
      this.ownerToAgent.set(existingGenesis.owner.toLowerCase(), {
        tokenId: genesisTid,
        name: "scarlet.ai",
      });
    }

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

  private loadPersistedState(): void {
    try {
      if (!fs.existsSync(this.stateFilePath)) return;
      const raw = fs.readFileSync(this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedRelayerState;

      if (parsed.lastSyncedBlock) {
        this.lastSyncedBlock = BigInt(parsed.lastSyncedBlock);
      }
      if (parsed.proposalMetadata) {
        for (const [k, v] of Object.entries(parsed.proposalMetadata)) {
          if (v?.title && v?.description) {
            this.proposalMetadataStore.set(k, v);
          }
        }
      }
      if (parsed.ownerIndex) {
        for (const [addr, info] of Object.entries(parsed.ownerIndex)) {
          if (info?.tokenId && info?.name) {
            this.ownerToAgent.set(addr.toLowerCase(), info);
          }
        }
      }
      if (Array.isArray(parsed.seenVotes)) {
        for (const vk of parsed.seenVotes) this.seenVotes.add(vk);
      }
      if (parsed.seenProposals) {
        for (const [pid, meta] of Object.entries(parsed.seenProposals)) {
          this.seenProposals.set(pid, meta);
        }
      }
      if (Array.isArray(parsed.nodes)) {
        for (const n of parsed.nodes) {
          if (n?.tokenId) {
            this.knownNodes.set(n.tokenId, n);
            if (n.name && !n.name.startsWith("agent-")) {
              this.tokenNames.set(n.tokenId, n.name);
            }
          }
        }
      }
      if (Array.isArray(parsed.edges)) {
        for (const e of parsed.edges) {
          if (e?.edgeKey) this.knownEdges.set(e.edgeKey, e);
        }
      }
    } catch (err) {
      console.warn("[BlockchainClient] Could not load persisted state:", err);
    }
  }

  private savePersistedState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const state: PersistedRelayerState = {
        lastSyncedBlock: this.lastSyncedBlock.toString(),
        proposalMetadata: Object.fromEntries(this.proposalMetadataStore.entries()),
        ownerIndex: Object.fromEntries(this.ownerToAgent.entries()),
        seenVotes: Array.from(this.seenVotes),
        seenProposals: Object.fromEntries(this.seenProposals.entries()),
        nodes: Array.from(this.knownNodes.values()),
        edges: Array.from(this.knownEdges.values()),
      };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
      console.warn("[BlockchainClient] Failed to persist state:", err);
    }
  }

  public invalidateCache(): void {
    this.proposalsCache = null;
  }

  public async resolveAgentName(tokenId: bigint): Promise<string | null> {
    const tidStr = tokenId.toString();
    if (tokenId === this.config.scarletTokenId) {
      this.tokenNames.set(tidStr, "scarlet.ai");
      return "scarlet.ai";
    }

    const cached = this.tokenNames.get(tidStr);
    if (cached && !cached.startsWith("agent-")) {
      return cached;
    }

    // 1. Official SPACE ID ERC-721 tokenURI(tokenId) -> metadata/<label>.json
    try {
      const uri = (await this.publicClient.readContract({
        address: this.config.registrarAddress,
        abi: AgentIdRegistrarAbi,
        functionName: "tokenURI",
        args: [tokenId],
      })) as string;
      const resolved = await resolveNameFromTokenUri(uri);
      if (resolved) {
        this.tokenNames.set(tidStr, resolved);
        return resolved;
      }
    } catch {}

    // 2. Fallback for legacy/mock registrar contracts exposing getAgentName(tokenId)
    try {
      const legacyName = (await this.publicClient.readContract({
        address: this.config.registrarAddress,
        abi: AgentIdRegistrarAbi,
        functionName: "getAgentName",
        args: [tokenId],
      })) as string;
      if (legacyName && legacyName.trim()) {
        const formatted = formatAiDomainName(legacyName);
        this.tokenNames.set(tidStr, formatted);
        return formatted;
      }
    } catch {}

    return null;
  }

  private async ensureDiscoveredNode(
    tokenId: bigint,
    knownOwner?: `0x${string}`,
    capabilities: number = 7
  ): Promise<MeshNode> {
    const tidStr = tokenId.toString();
    const isGenesis = tokenId === this.config.scarletTokenId;
    let existing = this.knownNodes.get(tidStr);

    let owner = knownOwner || existing?.owner;
    if (!owner || owner === "0x0000000000000000000000000000000000000000") {
      try {
        owner = await this.getOwnerOf(tokenId);
      } catch {
        owner = "0x0000000000000000000000000000000000000000";
      }
    }

    let name = isGenesis ? "scarlet.ai" : existing?.name;
    if (!name || name.startsWith("agent-")) {
      name = (await this.resolveAgentName(tokenId)) || `agent-${tidStr.slice(0, 6)}...`;
    }

    const node: MeshNode = {
      tokenId: tidStr,
      name,
      owner,
      totalConnections: existing?.totalConnections ?? 0,
      capabilities: existing?.capabilities ?? (isGenesis ? 31 : capabilities),
      isGenesis,
      votesCount: existing?.votesCount ?? 0,
      proposalsCount: existing?.proposalsCount ?? 0,
      lastActivityAt: existing?.lastActivityAt ?? Math.floor(Date.now() / 1000),
    };

    this.knownNodes.set(tidStr, node);
    if (owner && owner !== "0x0000000000000000000000000000000000000000") {
      this.ownerToAgent.set(owner.toLowerCase(), { tokenId: tidStr, name });
    }
    return node;
  }

  public async registerDiscoveredAgent(
    tokenId: bigint,
    owner?: `0x${string}`,
    activity?: {
      votedProposalId?: bigint;
      createdProposalId?: bigint;
      title?: string;
      description?: string;
      capabilities?: number;
    }
  ): Promise<void> {
    const node = await this.ensureDiscoveredNode(tokenId, owner, activity?.capabilities ?? 7);
    const nowSec = Math.floor(Date.now() / 1000);
    node.lastActivityAt = nowSec;

    if (activity?.votedProposalId !== undefined) {
      const vKey = `${activity.votedProposalId.toString()}:${tokenId.toString()}`;
      if (!this.seenVotes.has(vKey)) {
        this.seenVotes.add(vKey);
        node.votesCount = (node.votesCount || 0) + 1;
      }
    }

    if (activity?.createdProposalId !== undefined) {
      const pKey = activity.createdProposalId.toString();
      const prev = this.seenProposals.get(pKey);
      if (!prev || !prev.tokenId) {
        this.seenProposals.set(pKey, {
          creator: node.owner,
          tokenId: tokenId.toString(),
        });
        node.proposalsCount = (node.proposalsCount || 0) + 1;
      }
      if (activity.title && activity.description) {
        this.proposalMetadataStore.set(pKey, {
          title: activity.title,
          description: activity.description,
        });
      }
    }

    this.invalidateCache();
    this.savePersistedState();
  }

  private async getLogsWithFallback(params: {
    address: `0x${string}`;
    event: any;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<any[]> {
    const totalClients = this.logClients.length;
    let lastError: any;

    for (let attempt = 0; attempt < totalClients; attempt++) {
      const idx = (this.activeLogClientIndex + attempt) % totalClients;
      const client = this.logClients[idx];
      try {
        const logs = await client.getLogs(params);
        this.activeLogClientIndex = idx;
        return logs;
      } catch (err: any) {
        lastError = err;
      }
    }

    throw lastError;
  }

  private async getStartBlockForDiscovery(latestBlock: bigint): Promise<bigint> {
    if (this.lastSyncedBlock > 0n) {
      return this.lastSyncedBlock + 1n;
    }
    try {
      const core1 = (await this.publicClient.readContract({
        address: this.config.parliamentAddress,
        abi: ParliamentAbi,
        functionName: "proposals",
        args: [1n],
      })) as any;
      const startBlk = Number(Array.isArray(core1) ? core1[0] : core1?.startBlock);
      if (startBlk > 0) {
        return BigInt(Math.max(0, startBlk - 300));
      }
    } catch {}

    return latestBlock > 80_000n ? latestBlock - 80_000n : 0n;
  }

  public async syncOnChainState(force: boolean = false): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }
    if (!force && Date.now() - this.lastSyncAt < SYNC_COOLDOWN_MS) {
      return;
    }

    this.syncPromise = this._doSyncOnChainState().finally(() => {
      this.syncPromise = null;
      this.lastSyncAt = Date.now();
    });

    return this.syncPromise;
  }

  private async _doSyncOnChainState(): Promise<void> {
    // 1. Ensure Genesis Anchor (scarlet.ai) owner is resolved dynamically from SPACE ID
    await this.ensureDiscoveredNode(this.config.scarletTokenId, undefined, 31);

    // 2. Scan recent on-chain logs across Parliament & Mesh contracts
    try {
      const latestBlock = (await (this.logClients[this.activeLogClientIndex] || this.publicClient).getBlockNumber()) as bigint;
      const fromStart = await this.getStartBlockForDiscovery(latestBlock);

      if (fromStart <= latestBlock) {
        const chunkSize = 15_000n;
        const voteEvent = parseAbiItem(
          "event VoteCast(uint256 indexed proposalId, uint256 indexed tokenId, address indexed voter, uint8 support)"
        );
        const proposalEvent = parseAbiItem(
          "event ProposalCreated(uint256 indexed proposalId, address indexed creator, bytes32 contentCidHash)"
        );
        const pingEvent = parseAbiItem(
          "event HandshakePinged(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint32 timestamp)"
        );
        const mutualEvent = parseAbiItem(
          "event MutualHandshakeCompleted(uint256 indexed tokenIdA, uint256 indexed tokenIdB, bytes32 indexed edgeKey)"
        );
        const disconnectEvent = parseAbiItem(
          "event EdgeDisconnected(uint256 indexed tokenIdA, uint256 indexed tokenIdB, bytes32 indexed edgeKey)"
        );

        const ranges: Array<{ from: bigint; to: bigint }> = [];
        for (let from = fromStart; from <= latestBlock; from += chunkSize) {
          const to = from + chunkSize - 1n > latestBlock ? latestBlock : from + chunkSize - 1n;
          ranges.push({ from, to });
        }

        // Probe first range once to lock activeLogClientIndex onto a log-capable RPC node
        const firstRange = ranges[0];
        const allVoteLogs: any[] = [];
        const allPropLogs: any[] = [];
        const allPingLogs: any[] = [];
        const allMutualLogs: any[] = [];
        const allDisconnectLogs: any[] = [];

        const fetchRange = async ({ from, to }: { from: bigint; to: bigint }) => {
          const [v, p, pi, m, d] = await Promise.all([
            this.getLogsWithFallback({ address: this.config.parliamentAddress, event: voteEvent, fromBlock: from, toBlock: to }).catch(() => []),
            this.getLogsWithFallback({ address: this.config.parliamentAddress, event: proposalEvent, fromBlock: from, toBlock: to }).catch(() => []),
            this.getLogsWithFallback({ address: this.config.meshAddress, event: pingEvent, fromBlock: from, toBlock: to }).catch(() => []),
            this.getLogsWithFallback({ address: this.config.meshAddress, event: mutualEvent, fromBlock: from, toBlock: to }).catch(() => []),
            this.getLogsWithFallback({ address: this.config.meshAddress, event: disconnectEvent, fromBlock: from, toBlock: to }).catch(() => []),
          ]);
          allVoteLogs.push(...v);
          allPropLogs.push(...p);
          allPingLogs.push(...pi);
          allMutualLogs.push(...m);
          allDisconnectLogs.push(...d);
        };

        if (firstRange) {
          await fetchRange(firstRange);
        }
        if (ranges.length > 1) {
          await Promise.all(ranges.slice(1).map(fetchRange));
        }

        const byBlockOrder = (a: any, b: any) =>
          Number(BigInt(a.blockNumber ?? 0) - BigInt(b.blockNumber ?? 0)) ||
          Number((a.logIndex ?? 0) - (b.logIndex ?? 0));

        allVoteLogs.sort(byBlockOrder);
        allPropLogs.sort(byBlockOrder);
        allPingLogs.sort(byBlockOrder);
        allMutualLogs.sort(byBlockOrder);
        allDisconnectLogs.sort(byBlockOrder);

        const activeClient = this.logClients[this.activeLogClientIndex] || this.publicClient;

        // Index VoteCast -> discovers any agent who voted on-chain + owner mapping
        for (const log of allVoteLogs) {
          const pId = BigInt(log.args.proposalId);
          const tId = BigInt(log.args.tokenId);
          const voter = log.args.voter as `0x${string}`;
          const node = await this.ensureDiscoveredNode(tId, voter);
          const voteKey = `${pId}:${tId}`;
          if (!this.seenVotes.has(voteKey)) {
            this.seenVotes.add(voteKey);
            node.votesCount = (node.votesCount || 0) + 1;
          }
        }

        // Index ProposalCreated -> decode createProposalBySig calldata when owner is unknown
        for (const log of allPropLogs) {
          const pId = BigInt(log.args.proposalId);
          const creator = log.args.creator as `0x${string}`;
          const pKey = pId.toString();
          const existingProp = this.seenProposals.get(pKey);
          let creatorTokenId = existingProp?.tokenId || this.ownerToAgent.get(creator.toLowerCase())?.tokenId;

          if (!creatorTokenId && log.transactionHash) {
            try {
              const tx = await activeClient.getTransaction({ hash: log.transactionHash });
              const decoded = decodeFunctionData({ abi: ParliamentAbi, data: tx.input });
              if (decoded.functionName === "createProposalBySig" && decoded.args) {
                creatorTokenId = BigInt((decoded.args as any)[1]).toString();
              }
            } catch {}
          }

          if (creatorTokenId) {
            const node = await this.ensureDiscoveredNode(BigInt(creatorTokenId), creator);
            if (!existingProp || !existingProp.tokenId) {
              node.proposalsCount = (node.proposalsCount || 0) + 1;
            }
            this.seenProposals.set(pKey, { creator, tokenId: creatorTokenId });
          } else if (!existingProp) {
            this.seenProposals.set(pKey, { creator });
          }
        }

        // Index Mesh Pings, Mutual Handshakes & Disconnections
        for (const log of allPingLogs) {
          const fromTid = BigInt(log.args.fromTokenId);
          const toTid = BigInt(log.args.toTokenId);
          const ts = Number(log.args.timestamp || Math.floor(Date.now() / 1000));
          await Promise.all([
            this.ensureDiscoveredNode(fromTid),
            this.ensureDiscoveredNode(toTid),
          ]);
          const minTid = fromTid < toTid ? fromTid : toTid;
          const maxTid = fromTid < toTid ? toTid : fromTid;
          const edgeKey = keccak256(encodePacked(["uint256", "uint256"], [minTid, maxTid]));
          const prevEdge = this.knownEdges.get(edgeKey);
          if (!prevEdge?.isMutual) {
            this.knownEdges.set(edgeKey, {
              edgeKey,
              nodeA: minTid.toString(),
              nodeB: maxTid.toString(),
              isMutual: false,
              capabilityMask: 1,
              establishedAt: ts,
            });
          }
        }

        for (const log of allMutualLogs) {
          const tidA = BigInt(log.args.tokenIdA);
          const tidB = BigInt(log.args.tokenIdB);
          const edgeKey = log.args.edgeKey as string;
          await Promise.all([
            this.ensureDiscoveredNode(tidA),
            this.ensureDiscoveredNode(tidB),
          ]);
          const minTid = tidA < tidB ? tidA : tidB;
          const maxTid = tidA < tidB ? tidB : tidA;
          this.knownEdges.set(edgeKey, {
            edgeKey,
            nodeA: minTid.toString(),
            nodeB: maxTid.toString(),
            isMutual: true,
            capabilityMask: 1,
            establishedAt: Math.floor(Date.now() / 1000),
          });
        }

        for (const log of allDisconnectLogs) {
          const edgeKey = log.args.edgeKey as string;
          this.knownEdges.delete(edgeKey);
        }

        this.lastSyncedBlock = latestBlock;
      }
    } catch (err) {
      console.warn("[BlockchainClient] On-chain discovery sync note:", err);
    }

    // 3. Refresh on-chain Mesh totalConnections counters for all known nodes in parallel
    await Promise.allSettled(
      Array.from(this.knownNodes.values()).map(async (node) => {
        try {
          const conns = await this.publicClient.readContract({
            address: this.config.meshAddress,
            abi: MeshAbi,
            functionName: "totalConnections",
            args: [BigInt(node.tokenId)],
          });
          node.totalConnections = Number(conns);
        } catch {}
      })
    );

    this.savePersistedState();
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

  async getProposal(proposalId: bigint, skipSync: boolean = false): Promise<ProposalView | null> {
    try {
      if (!skipSync) {
        await this.syncOnChainState().catch(() => {});
      }

      const [core, meta] = (await Promise.all([
        this.publicClient.readContract({
          address: this.config.parliamentAddress,
          abi: ParliamentAbi,
          functionName: "proposals",
          args: [proposalId],
        }),
        this.publicClient.readContract({
          address: this.config.parliamentAddress,
          abi: ParliamentAbi,
          functionName: "proposalMetas",
          args: [proposalId],
        }),
      ])) as [any, any];

      if (!core) return null;
      const createdAt = Number(Array.isArray(core) ? core[7] : core.createdAt);
      if (!createdAt || createdAt === 0) return null;

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

      const seenProp = this.seenProposals.get(proposalId.toString());
      const agentByOwner = creator ? this.ownerToAgent.get(creator.toLowerCase()) : undefined;
      const creatorTokenId = agentByOwner?.tokenId || seenProp?.tokenId;
      const creatorName =
        agentByOwner?.name ||
        (creatorTokenId ? this.knownNodes.get(creatorTokenId)?.name || this.tokenNames.get(creatorTokenId) : undefined);

      return {
        id: proposalId.toString(),
        title,
        description,
        creator,
        creatorTokenId,
        creatorName,
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
      if (this.proposalsCache && Date.now() - this.proposalsCache.fetchedAt < PROPOSALS_CACHE_TTL_MS) {
        return this.proposalsCache.data;
      }

      // Run discovery sync & read proposalCount in parallel on cache miss
      const [, count] = await Promise.all([
        this.syncOnChainState().catch(() => {}),
        this.publicClient.readContract({
          address: this.config.parliamentAddress,
          abi: ParliamentAbi,
          functionName: "proposalCount",
        }) as Promise<bigint>,
      ]);

      const ids: bigint[] = [];
      for (let i = 1n; i <= count; i++) {
        ids.push(i);
      }

      const resolved = await Promise.all(ids.map((id) => this.getProposal(id, true)));
      const proposals = resolved.filter((p): p is ProposalView => p !== null);

      this.proposalsCache = {
        data: proposals,
        fetchedAt: Date.now(),
      };
      return proposals;
    } catch (err) {
      console.error("[BlockchainClient] Failed to fetch proposals:", err);
      return this.proposalsCache?.data || [];
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
          const settledEvent = parseAbiItem(
            "event BatchVotesSettled(uint256 indexed proposalId, uint256 successfulVotes, uint256 failedVotes)"
          );
          const decoded = decodeEventLog({
            abi: [settledEvent],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "BatchVotesSettled") {
            successfulVotes = Number((decoded.args as any).successfulVotes);
            failedVotes = Number((decoded.args as any).failedVotes);
          }
        }
      } catch {}
    }

    await Promise.allSettled(
      tokenIds.map((tid) =>
        this.registerDiscoveredAgent(tid, undefined, { votedProposalId: proposalId })
      )
    );
    this.invalidateCache();

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

    if (proposalId !== 0n) {
      await this.registerDiscoveredAgent(tokenId, creator, {
        createdProposalId: proposalId,
        title: _title,
        description: _description,
      });
    } else {
      this.invalidateCache();
    }

    return {
      proposalId,
      txHash: hash,
    };
  }

  async isMeshAuthorized(tokenId: bigint): Promise<boolean> {
    if (tokenId === this.config.scarletTokenId) {
      return true;
    }
    const relayerAddress = this.getAccountAddress().toLowerCase();
    const [owner, operator] = await Promise.all([
      this.getOwnerOf(tokenId).catch(() => null),
      this.publicClient
        .readContract({
          address: this.config.meshAddress,
          abi: MeshAbi,
          functionName: "meshOperators",
          args: [tokenId],
        })
        .catch(() => null) as Promise<`0x${string}` | null>,
    ]);

    if (owner && owner.toLowerCase() === relayerAddress) {
      return true;
    }
    if (operator && operator.toLowerCase() === relayerAddress) {
      return true;
    }
    return false;
  }

  async getMeshPairStatus(
    fromTokenId: bigint,
    toTokenId: bigint
  ): Promise<{
    isMutual: boolean;
    hasPendingOutbound: boolean;
    hasPendingInbound: boolean;
  }> {
    const [isMutual, hasPendingOutbound, hasPendingInbound] = (await Promise.all([
      this.publicClient.readContract({
        address: this.config.meshAddress,
        abi: MeshAbi,
        functionName: "isEdgeConnected",
        args: [fromTokenId, toTokenId],
      }),
      this.publicClient.readContract({
        address: this.config.meshAddress,
        abi: MeshAbi,
        functionName: "hasPendingPing",
        args: [fromTokenId, toTokenId],
      }),
      this.publicClient.readContract({
        address: this.config.meshAddress,
        abi: MeshAbi,
        functionName: "hasPendingPing",
        args: [toTokenId, fromTokenId],
      }),
    ])) as [boolean, boolean, boolean];

    return { isMutual, hasPendingOutbound, hasPendingInbound };
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

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    let isMutual = false;

    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === this.config.meshAddress.toLowerCase()) {
          const decoded = decodeEventLog({
            abi: MeshAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "MutualHandshakeCompleted") {
            isMutual = true;
            break;
          }
        }
      } catch {}
    }

    const minTid = fromTokenId < toTokenId ? fromTokenId : toTokenId;
    const maxTid = fromTokenId < toTokenId ? toTokenId : fromTokenId;
    const edgeKey = keccak256(encodePacked(["uint256", "uint256"], [minTid, maxTid]));
    const prevEdge = this.knownEdges.get(edgeKey);

    this.knownEdges.set(edgeKey, {
      edgeKey,
      nodeA: minTid.toString(),
      nodeB: maxTid.toString(),
      isMutual: isMutual || Boolean(prevEdge?.isMutual),
      capabilityMask: capabilities,
      establishedAt: Math.floor(Date.now() / 1000),
    });

    await Promise.allSettled([
      this.ensureDiscoveredNode(fromTokenId),
      this.ensureDiscoveredNode(toTokenId),
    ]);
    this.savePersistedState();

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
    await this.syncOnChainState().catch(() => {});
    return Array.from(this.knownEdges.values());
  }

  async getMeshNodes(): Promise<MeshNode[]> {
    await this.syncOnChainState().catch(() => {});
    const nodes = Array.from(this.knownNodes.values());
    // Genesis node first, then highest activity / mutual connections
    nodes.sort((a, b) => {
      if (a.isGenesis && !b.isGenesis) return -1;
      if (!a.isGenesis && b.isGenesis) return 1;
      const scoreA = (a.totalConnections || 0) * 10 + (a.votesCount || 0) + (a.proposalsCount || 0) * 3;
      const scoreB = (b.totalConnections || 0) * 10 + (b.votesCount || 0) + (b.proposalsCount || 0) * 3;
      return scoreB - scoreA;
    });
    return nodes;
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
          const fromTid = BigInt(log.args.fromTokenId);
          const toTid = BigInt(log.args.toTokenId);
          const ts = Number(log.args.timestamp);

          const minTid = fromTid < toTid ? fromTid : toTid;
          const maxTid = fromTid < toTid ? toTid : fromTid;
          const edgeKey = keccak256(encodePacked(["uint256", "uint256"], [minTid, maxTid]));
          if (!this.knownEdges.get(edgeKey)?.isMutual) {
            this.knownEdges.set(edgeKey, {
              edgeKey,
              nodeA: minTid.toString(),
              nodeB: maxTid.toString(),
              isMutual: false,
              capabilityMask: 1,
              establishedAt: ts || Math.floor(Date.now() / 1000),
            });
          }
          void Promise.allSettled([
            this.ensureDiscoveredNode(fromTid),
            this.ensureDiscoveredNode(toTid),
          ]).then(() => this.savePersistedState());

          callback(fromTid, toTid, ts);
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
  private meshOperators = new Map<bigint, `0x${string}`>();

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

  async registerDiscoveredAgent(
    tokenId: bigint,
    owner?: `0x${string}`
  ): Promise<void> {
    if (!this.tokenOwners.has(tokenId) && owner) {
      this.tokenOwners.set(tokenId, {
        owner,
        name: tokenId === this.config.scarletTokenId || tokenId === 101n ? "scarlet.ai" : `agent-${tokenId}.ai`,
      });
    }
  }

  async resolveAgentName(tokenId: bigint): Promise<string | null> {
    return this.tokenOwners.get(tokenId)?.name || null;
  }

  async getProposal(proposalId: bigint): Promise<ProposalView | null> {
    const p = this.proposals.get(proposalId);
    if (!p) return null;

    const statusMap = ["Pending", "Active", "Succeeded", "Defeated"];
    const totalVotes = p.core.forVotes + p.core.againstVotes + p.core.abstainVotes;

    let creatorTokenId: string | undefined;
    let creatorName: string | undefined;
    for (const [tid, entry] of this.tokenOwners.entries()) {
      if (entry.owner.toLowerCase() === p.meta.creator.toLowerCase()) {
        creatorTokenId = tid.toString();
        creatorName = entry.name;
        if (tid === this.config.scarletTokenId || tid === 101n) break;
      }
    }

    return {
      id: proposalId.toString(),
      title: p.meta.title,
      description: p.meta.description,
      creator: p.meta.creator,
      creatorTokenId,
      creatorName,
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

  setMockMeshOperator(tokenId: bigint, operator: `0x${string}`): void {
    this.meshOperators.set(tokenId, operator);
  }

  async isMeshAuthorized(tokenId: bigint): Promise<boolean> {
    if (tokenId === this.config.scarletTokenId) {
      return true;
    }
    const relayerAddress = this.getAccountAddress().toLowerCase();
    const owner = this.tokenOwners.get(tokenId)?.owner;
    const operator = this.meshOperators.get(tokenId);
    return (
      owner?.toLowerCase() === relayerAddress ||
      operator?.toLowerCase() === relayerAddress
    );
  }

  async getMeshPairStatus(
    fromTokenId: bigint,
    toTokenId: bigint
  ): Promise<{
    isMutual: boolean;
    hasPendingOutbound: boolean;
    hasPendingInbound: boolean;
  }> {
    const edgeKey = this.computeEdgeKey(fromTokenId, toTokenId);
    return {
      isMutual: this.edges.get(edgeKey)?.isMutual || false,
      hasPendingOutbound: this.pendingPings.has(`${fromTokenId}:${toTokenId}`),
      hasPendingInbound: this.pendingPings.has(`${toTokenId}:${fromTokenId}`),
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
        isGenesis: tokenId === this.config.scarletTokenId || tokenId === 101n,
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
