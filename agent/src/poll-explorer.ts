import {
  createPublicClient,
  http,
  PublicClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import {
  HexAddress,
  HexHash,
  PollDetails,
  PollFilter,
  AgentEligibility,
  PollExplorerConfig,
  DecodedProposalDescription,
  ProposalCategory,
} from "./types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  DEFAULT_RELAYER_API_ENDPOINT,
  OFFICIAL_SPACE_ID_REGISTRAR,
  BSC_RPC_URLS,
} from "./config.js";

const PARLIAMENT_VIEW_ABI = [
  {
    type: "function",
    name: "proposals",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "startBlock", type: "uint32" },
      { name: "endBlock", type: "uint32" },
      { name: "snapshotBlock", type: "uint32" },
      { name: "forVotes", type: "uint32" },
      { name: "againstVotes", type: "uint32" },
      { name: "abstainVotes", type: "uint32" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint48" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposalMetas",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "categoryId", type: "uint8" },
      { name: "contentCidHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasTokenVoted",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasAddressVoted",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposalCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const REGISTRAR_VIEW_ABI = [
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

export const CATEGORY_NAMES: Record<number, string> = {
  [ProposalCategory.General]: "General Governance",
  [ProposalCategory.ResourceAllocation]: "Resource Allocation",
  [ProposalCategory.Security]: "Security & Audit",
  [ProposalCategory.Ecosystem]: "Ecosystem Expansion",
};

/**
 * PollExplorer: Rich governance inspection, filtering, and LLM formatting for AI Agents
 */
export class PollExplorer {
  public relayerApiUrl: string;
  public parliamentAddress: HexAddress;
  public registrarAddress: HexAddress;
  public chainId: number;
  public rpcUrl: string;
  public publicClient?: PublicClient;

  constructor(config?: PollExplorerConfig) {
    this.relayerApiUrl = config?.relayerApiUrl || DEFAULT_RELAYER_API_ENDPOINT;
    this.parliamentAddress = config?.parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;
    this.registrarAddress = config?.registrarAddress || OFFICIAL_SPACE_ID_REGISTRAR;
    this.chainId = config?.chainId || DEFAULT_CHAIN_ID;
    this.rpcUrl = config?.rpcUrl || BSC_RPC_URLS[this.chainId] || "https://bsc-dataseed.binance.org/";

    if (config?.publicClient) {
      this.publicClient = config.publicClient;
    }
  }

  /**
   * Lazily get or create viem PublicClient
   */
  public getPublicClient(): PublicClient {
    if (!this.publicClient) {
      const chain = this.chainId === 97 ? bscTestnet : bsc;
      this.publicClient = createPublicClient({
        chain,
        transport: http(this.rpcUrl),
      });
    }
    return this.publicClient;
  }

  /**
   * Helper to resolve category ID to human-readable name
   */
  public getCategoryName(categoryId: number): string {
    return CATEGORY_NAMES[categoryId] || `Category #${categoryId}`;
  }

  /**
   * Parse / decode raw proposal description into structured parts
   */
  public decodeDescription(description?: string): DecodedProposalDescription {
    if (!description) {
      return { summary: "No description provided", rawText: "" };
    }

    const trimmed = description.trim();

    // Check if description is formatted as JSON
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          summary: parsed.summary || parsed.description || parsed.title,
          motivation: parsed.motivation,
          actionItems: Array.isArray(parsed.actionItems)
            ? parsed.actionItems
            : parsed.actionItems
            ? [parsed.actionItems]
            : undefined,
          rawText: description,
        };
      } catch {
        // Fall through to markdown parsing
      }
    }

    // Markdown section parser
    let motivation: string | undefined;
    const actionItems: string[] = [];
    let summary: string | undefined;

    const motivationMatch = trimmed.match(/##?\s*(?:Motivation|Rationale)[:\s]*([\s\S]*?)(?=##|$)/i);
    if (motivationMatch) {
      motivation = motivationMatch[1].trim();
    }

    const actionMatch = trimmed.match(/##?\s*(?:Action Items?|Actions?|Specifications?)[:\s]*([\s\S]*?)(?=##|$)/i);
    if (actionMatch) {
      const lines = actionMatch[1].split("\n");
      for (const line of lines) {
        const item = line.replace(/^\s*[-*•\d.]+\s*/, "").trim();
        if (item.length > 0) {
          actionItems.push(item);
        }
      }
    }

    const summaryMatch = trimmed.match(/##?\s*(?:Summary|Overview)[:\s]*([\s\S]*?)(?=##|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    } else {
      // First paragraph before any headers
      const firstSection = trimmed.split(/##/)[0].trim();
      summary = firstSection || trimmed;
    }

    return {
      summary: summary || trimmed,
      motivation,
      actionItems: actionItems.length > 0 ? actionItems : undefined,
      rawText: description,
    };
  }

  /**
   * Format approx remaining time into a human-friendly string
   */
  private formatTimeRemaining(approxSeconds: number, blocks: number): string {
    if (blocks <= 0 || approxSeconds <= 0) {
      return "Voting concluded";
    }
    const days = Math.floor(approxSeconds / 86400);
    const hours = Math.floor((approxSeconds % 86400) / 3600);
    const minutes = Math.floor((approxSeconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h remaining (~${blocks} blocks)`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m remaining (~${blocks} blocks)`;
    }
    return `${minutes}m remaining (~${blocks} blocks)`;
  }

  /**
   * Normalize any proposal representation into a uniform PollDetails object
   */
  public normalizePoll(raw: any, currentBlock: number = 42120000): PollDetails {
    const id = String(raw.id || raw.proposalId || "0");
    const title = raw.title || `Governance Proposal #${id}`;
    const description = raw.description || "";
    const decodedDescription = this.decodeDescription(description);
    const categoryId = Number(raw.categoryId ?? 0);
    const categoryName = this.getCategoryName(categoryId);
    const creator = (raw.creator || "0x0000000000000000000000000000000000000000") as HexAddress;
    const contentCidHash = raw.contentCidHash || "0x0";

    const startBlock = Number(raw.startBlock || 0);
    const endBlock = Number(raw.endBlock || 0);
    const snapshotBlock = raw.snapshotBlock !== undefined ? Number(raw.snapshotBlock) : undefined;

    const forVotes = Number(raw.forVotes || 0);
    const againstVotes = Number(raw.againstVotes || 0);
    const abstainVotes = Number(raw.abstainVotes || 0);
    const totalVotes = raw.totalVotes !== undefined ? Number(raw.totalVotes) : forVotes + againstVotes + abstainVotes;

    const forPercentage = totalVotes > 0 ? Number(((forVotes / totalVotes) * 100).toFixed(1)) : 0;
    const againstPercentage = totalVotes > 0 ? Number(((againstVotes / totalVotes) * 100).toFixed(1)) : 0;
    const abstainPercentage = totalVotes > 0 ? Number(((abstainVotes / totalVotes) * 100).toFixed(1)) : 0;

    const blocksRemaining = Math.max(0, endBlock - currentBlock);
    const approxSecondsRemaining = blocksRemaining * 3;
    const timeRemainingFormatted = this.formatTimeRemaining(approxSecondsRemaining, blocksRemaining);

    // Determine canonical status
    let status: "pending" | "active" | "succeeded" | "defeated" | "ended" = "active";
    const rawStatus = String(raw.status || "").toLowerCase();

    if (rawStatus === "pending" || raw.statusCode === 0) {
      status = "pending";
    } else if (rawStatus === "succeeded" || raw.statusCode === 2) {
      status = "succeeded";
    } else if (rawStatus === "defeated" || raw.statusCode === 3) {
      status = "defeated";
    } else if (rawStatus === "ended") {
      status = "ended";
    } else if (currentBlock > endBlock && endBlock > 0) {
      status = forVotes > againstVotes ? "succeeded" : "defeated";
    } else {
      status = "active";
    }

    const quorumThreshold = 3;
    const quorumReached = totalVotes >= quorumThreshold;

    return {
      id,
      title,
      description,
      decodedDescription,
      creator,
      categoryId,
      categoryName,
      contentCidHash,
      status,
      statusCode: raw.statusCode !== undefined ? Number(raw.statusCode) : status === "active" ? 1 : 2,
      startBlock,
      endBlock,
      snapshotBlock,
      currentBlock,
      blocksRemaining,
      approxSecondsRemaining,
      timeRemainingFormatted,
      tallies: {
        forVotes,
        againstVotes,
        abstainVotes,
        totalVotes,
        forPercentage,
        againstPercentage,
        abstainPercentage,
      },
      quorum: {
        totalVoters: totalVotes,
        quorumThreshold,
        quorumReached,
      },
      createdAt: Number(raw.createdAt || Math.floor(Date.now() / 1000)),
      raw,
    };
  }

  /**
   * Filter and search polls from relayer/blockchain
   */
  async listPolls(filter?: PollFilter): Promise<PollDetails[]> {
    let rawProposals: any[] = [];
    let currentBlock = 42120000;

    // 1. Fetch from relayer API
    try {
      const res = await fetch(`${this.relayerApiUrl}/proposals`);
      if (res.ok) {
        const data = (await res.json()) as any;
        rawProposals = Array.isArray(data) ? data : data.proposals || [];
      }
    } catch {
      // Relayer fetch failed, will attempt fallback
    }

    // 2. Fetch current block if public client is configured
    try {
      if (this.publicClient) {
        const bn = await this.publicClient.getBlockNumber();
        currentBlock = Number(bn);
      }
    } catch {
      // Use estimated or default currentBlock
    }

    // If still no proposals and publicClient is available, attempt direct on-chain query
    if (rawProposals.length === 0 && this.publicClient) {
      try {
        const count = await this.publicClient.readContract({
          address: this.parliamentAddress,
          abi: PARLIAMENT_VIEW_ABI,
          functionName: "proposalCount",
        });

        for (let i = 1n; i <= count; i++) {
          try {
            const [core, meta] = await Promise.all([
              this.publicClient.readContract({
                address: this.parliamentAddress,
                abi: PARLIAMENT_VIEW_ABI,
                functionName: "proposals",
                args: [i],
              }),
              this.publicClient.readContract({
                address: this.parliamentAddress,
                abi: PARLIAMENT_VIEW_ABI,
                functionName: "proposalMetas",
                args: [i],
              }),
            ]);

            rawProposals.push({
              id: i.toString(),
              startBlock: core[0],
              endBlock: core[1],
              snapshotBlock: core[2],
              forVotes: core[3],
              againstVotes: core[4],
              abstainVotes: core[5],
              statusCode: core[6],
              createdAt: core[7],
              creator: meta[0],
              categoryId: meta[1],
              contentCidHash: meta[2],
            });
          } catch {
            // Skip unreadable proposal
          }
        }
      } catch {
        // On-chain query fallback skipped
      }
    }

    // 3. Normalize into PollDetails
    const normalized = rawProposals.map((p) => this.normalizePoll(p, currentBlock));

    // 4. Apply filtering
    let results = normalized;

    if (filter) {
      if (filter.status && filter.status !== "all") {
        if (filter.status === "active") {
          results = results.filter((p) => p.status === "active");
        } else if (filter.status === "pending") {
          results = results.filter((p) => p.status === "pending");
        } else if (filter.status === "ended") {
          results = results.filter((p) => p.status === "ended" || p.status === "succeeded" || p.status === "defeated");
        }
      }

      if (filter.categoryId !== undefined) {
        results = results.filter((p) => p.categoryId === Number(filter.categoryId));
      }

      if (filter.search && filter.search.trim().length > 0) {
        const q = filter.search.toLowerCase().trim();
        results = results.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.categoryName.toLowerCase().includes(q) ||
            p.id.includes(q) ||
            p.creator.toLowerCase().includes(q)
        );
      }

      if (filter.limit && filter.limit > 0) {
        results = results.slice(0, filter.limit);
      }
    }

    return results;
  }

  /**
   * Get detailed metadata for a specific proposal
   */
  async getPollDetails(proposalId: bigint | number): Promise<PollDetails> {
    const id = proposalId.toString();

    // 1. Fetch from relayer
    try {
      const res = await fetch(`${this.relayerApiUrl}/proposals/${id}`);
      if (res.ok) {
        const raw = (await res.json()) as any;
        return this.normalizePoll(raw);
      }
    } catch {
      // Fallback
    }

    // 2. Fetch on-chain if publicClient is available
    if (this.publicClient) {
      const pId = BigInt(proposalId);
      const [core, meta] = await Promise.all([
        this.publicClient.readContract({
          address: this.parliamentAddress,
          abi: PARLIAMENT_VIEW_ABI,
          functionName: "proposals",
          args: [pId],
        }),
        this.publicClient.readContract({
          address: this.parliamentAddress,
          abi: PARLIAMENT_VIEW_ABI,
          functionName: "proposalMetas",
          args: [pId],
        }),
      ]);

      return this.normalizePoll({
        id,
        startBlock: core[0],
        endBlock: core[1],
        snapshotBlock: core[2],
        forVotes: core[3],
        againstVotes: core[4],
        abstainVotes: core[5],
        statusCode: core[6],
        createdAt: core[7],
        creator: meta[0],
        categoryId: meta[1],
        contentCidHash: meta[2],
      });
    }

    throw new Error(`Poll #${id} not found or relayer unreachable`);
  }

  /**
   * Checks if an agent is eligible to vote on a proposal:
   * - holds the Space ID token
   * - token or owner address has not already voted
   * - proposal is currently active
   */
  async checkAgentEligibility(
    proposalId: bigint | number,
    tokenId: bigint
  ): Promise<AgentEligibility> {
    const pId = proposalId.toString();
    const reasons: string[] = [];

    let holdsToken = false;
    let tokenHasVoted = false;
    let addressHasVoted = false;
    let proposalActive = false;
    let tokenOwnerAddress: string | undefined;

    // 1. Fetch proposal details
    let poll: PollDetails | null = null;
    try {
      poll = await this.getPollDetails(proposalId);
      proposalActive = poll.status === "active";
      if (!proposalActive) {
        reasons.push(`Proposal #${pId} is not active (current status: ${poll.status}).`);
      }
    } catch {
      reasons.push(`Proposal #${pId} does not exist or could not be loaded.`);
    }

    // 2. Query relayer vote status endpoint if available
    try {
      const statusRes = await fetch(
        `${this.relayerApiUrl}/vote/status?proposalId=${pId}&tokenId=${tokenId.toString()}`
      );
      if (statusRes.ok) {
        const data = (await statusRes.json()) as any;
        if (data.tokenOwner) {
          holdsToken = true;
          tokenOwnerAddress = data.tokenOwner;
        }
        if (data.hasVoted !== undefined) {
          tokenHasVoted = Boolean(data.hasVoted);
          if (tokenHasVoted) reasons.push(`Agent ID #${tokenId} has already voted on Proposal #${pId}.`);
        }
        if (data.addressHasVoted !== undefined) {
          addressHasVoted = Boolean(data.addressHasVoted);
          if (addressHasVoted) reasons.push(`Owner address ${tokenOwnerAddress} has already voted on Proposal #${pId}.`);
        }
      }
    } catch {
      // Relayer status endpoint not available or returned non-200
    }

    // 3. Check relayer queue: if a vote is currently queued, mark as already voted
    try {
      const queueRes = await fetch(`${this.relayerApiUrl}/vote/queue`);
      if (queueRes.ok) {
        const queueData = (await queueRes.json()) as any;
        const queuedBallots: any[] = queueData.ballots || [];
        const isQueued = queuedBallots.some(
          (b) => b.proposalId === pId && b.tokenId === tokenId.toString()
        );
        if (isQueued) {
          tokenHasVoted = true;
          reasons.push(`Ballot for Agent ID #${tokenId} is currently queued in relayer for batch settlement.`);
        }
      }
    } catch {
      // Ignore queue check errors
    }

    // 4. On-chain validation fallback if publicClient is available
    if (this.publicClient) {
      try {
        const owner = await this.publicClient.readContract({
          address: this.registrarAddress,
          abi: REGISTRAR_VIEW_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        });

        if (owner && owner !== "0x0000000000000000000000000000000000000000") {
          holdsToken = true;
          tokenOwnerAddress = owner;
        }
      } catch {
        holdsToken = false;
        reasons.push(`Agent ID #${tokenId} is not registered or has no owner in Space ID registrar.`);
      }

      if (holdsToken && tokenOwnerAddress) {
        try {
          const [tVoted, aVoted] = await Promise.all([
            this.publicClient.readContract({
              address: this.parliamentAddress,
              abi: PARLIAMENT_VIEW_ABI,
              functionName: "hasTokenVoted",
              args: [BigInt(proposalId), tokenId],
            }),
            this.publicClient.readContract({
              address: this.parliamentAddress,
              abi: PARLIAMENT_VIEW_ABI,
              functionName: "hasAddressVoted",
              args: [BigInt(proposalId), tokenOwnerAddress as HexAddress],
            }),
          ]);

          if (tVoted) {
            tokenHasVoted = true;
            reasons.push(`Agent ID #${tokenId} has already recorded an on-chain vote on Proposal #${pId}.`);
          }
          if (aVoted) {
            addressHasVoted = true;
            reasons.push(`Owner address ${tokenOwnerAddress} has already cast a vote on Proposal #${pId}.`);
          }
        } catch {
          // Ignore read error
        }
      }
    } else if (!tokenOwnerAddress) {
      // In mock/offline without publicClient, assume token exists unless error
      holdsToken = true;
    }

    const eligible = holdsToken && !tokenHasVoted && !addressHasVoted && proposalActive;
    if (eligible && reasons.length === 0) {
      reasons.push("Agent holds verified Space ID Agent ID and is eligible to cast a 100% gasless ballot.");
    }

    return {
      proposalId: pId,
      tokenId,
      eligible,
      holdsToken,
      tokenHasVoted,
      addressHasVoted,
      proposalActive,
      reasons,
    };
  }

  /**
   * Formats a proposal cleanly for an LLM agent prompt/context:
   * Compact summary, current standings, choices, rationale guidelines, and voting deadline.
   */
  public formatForLLM(proposal: PollDetails | any): string {
    const poll: PollDetails =
      proposal.tallies && proposal.categoryName
        ? (proposal as PollDetails)
        : this.normalizePoll(proposal);

    const desc = poll.decodedDescription || this.decodeDescription(poll.description);

    let contentSection = "";
    if (desc.summary) {
      contentSection += `\n**Summary**:\n${desc.summary}\n`;
    }
    if (desc.motivation) {
      contentSection += `\n**Motivation & Rationale**:\n${desc.motivation}\n`;
    }
    if (desc.actionItems && desc.actionItems.length > 0) {
      contentSection += `\n**Proposed Action Items**:\n${desc.actionItems.map((a) => `- ${a}`).join("\n")}\n`;
    }

    return `### 🏛️ Governance Proposal #${poll.id}: ${poll.title}
- **Status**: ${poll.status.toUpperCase()}
- **Category**: ${poll.categoryName} (Category ID: ${poll.categoryId})
- **Proposer**: \`${poll.creator}\`
- **Content Hash**: \`${poll.contentCidHash}\`
- **Voting Window**: Block ${poll.startBlock} to Block ${poll.endBlock} (${poll.timeRemainingFormatted})

#### 📋 Proposal Details
${contentSection || poll.description}

#### 📊 Current Standings & Quorum
- **FOR**: ${poll.tallies.forVotes} votes (${poll.tallies.forPercentage}%)
- **AGAINST**: ${poll.tallies.againstVotes} votes (${poll.tallies.againstPercentage}%)
- **ABSTAIN**: ${poll.tallies.abstainVotes} votes (${poll.tallies.abstainPercentage}%)
- **Total Participation**: ${poll.tallies.totalVotes} agents (${poll.quorum.quorumReached ? "Quorum Reached ✅" : `Quorum Pending (Need ${poll.quorum.quorumThreshold} votes)`})

#### 🗳️ Voting Options
- **0 (Against)**: Reject the proposal and preserve current protocol configuration.
- **1 (For)**: Approve the proposal and authorize proposed actions.
- **2 (Abstain)**: Participate in governance quorum without taking a directional stance.

#### 🤖 AI Agent Decision Instructions
Review the proposal against your agent role, security policies, and ecosystem goals. Choose your vote (0, 1, or 2) and formulate a clear, 1-2 sentence rationale for your ballot.`;
  }

  /**
   * Formats an array of polls into a concise agenda overview for LLM context
   */
  public formatListForLLM(polls: PollDetails[]): string {
    if (polls.length === 0) {
      return "No governance proposals currently match the search criteria.";
    }

    const lines = [
      `### 🏛️ AgentCommons Active Governance Agenda (${polls.length} proposals)`,
      "",
      "| ID | Title | Category | Status | Time Remaining | Standing (For / Against) |",
      "|:---|:------|:---------|:-------|:---------------|:-------------------------|",
    ];

    for (const p of polls) {
      const standings = `${p.tallies.forVotes} For (${p.tallies.forPercentage}%) / ${p.tallies.againstVotes} Against`;
      lines.push(
        `| #${p.id} | ${p.title.slice(0, 40)}${p.title.length > 40 ? "..." : ""} | ${p.categoryName} | ${p.status.toUpperCase()} | ${p.timeRemainingFormatted} | ${standings} |`
      );
    }

    return lines.join("\n");
  }
}
