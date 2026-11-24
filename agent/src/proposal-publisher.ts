import { keccak256, toHex } from "viem";
import {
  HexAddress,
  HexSignature,
  HexHash,
  AgentIdentity,
  ProposalCategory,
  SignedProposalPayload,
  ProposalPublishResponse,
} from "./types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  DEFAULT_RELAYER_API_ENDPOINT,
  PROPOSAL_TYPES,
} from "./config.js";
import { BawCliWrapper } from "./baw-cli-wrapper.js";

export interface StructuredProposalInput {
  title: string;
  motivation: string;
  actionItems: string[] | string;
  categoryId?: number | ProposalCategory;
  votingDurationBlocks?: number;
  summary?: string;
  impact?: string;
  contentCidHash?: HexHash;
}

export interface ComposedProposal {
  title: string;
  description: string;
  contentCidHash: HexHash;
  categoryId: number;
  votingDurationBlocks: number;
  markdown: string;
  summary?: string;
  motivation: string;
  actionItems: string[];
}

export interface ProposalMessage {
  creator: HexAddress;
  tokenId: bigint;
  contentCidHash: HexHash;
  votingDurationBlocks: number;
  categoryId: number;
  nonce: bigint;
  deadline: bigint;
}

export interface ProposalPublisherConfig {
  relayerApiUrl?: string;
  parliamentAddress?: HexAddress;
  chainId?: number;
  baw?: BawCliWrapper;
}

/**
 * Format structured proposal sections into clean, canonical Markdown
 */
export function formatProposalMarkdown(
  title: string,
  motivation: string,
  actionItems: string[] | string,
  summary?: string,
  impact?: string
): string {
  const sections: string[] = [`# ${title.trim()}`];

  if (summary && summary.trim()) {
    sections.push(`## Summary\n${summary.trim()}`);
  }

  sections.push(`## Motivation\n${motivation.trim()}`);

  const items = Array.isArray(actionItems)
    ? actionItems.map((item) => `- ${item.trim()}`).join("\n")
    : actionItems
        .split("\n")
        .map((line) => (line.trim().startsWith("-") ? line.trim() : `- ${line.trim()}`))
        .join("\n");

  sections.push(`## Action Items\n${items}`);

  if (impact && impact.trim()) {
    sections.push(`## Impact\n${impact.trim()}`);
  }

  return sections.join("\n\n");
}

/**
 * Generate a deterministic 32-byte content hash (IPFS/CID representation)
 * Compatible with BSC smart contract bytes32 contentCidHash anchor
 */
export function generateContentCidHash(content: string): HexHash {
  return keccak256(toHex(content));
}

/**
 * Compose a structured proposal into Markdown and calculate its content CID hash
 */
export function composeStructuredProposal(input: StructuredProposalInput): ComposedProposal {
  if (!input.title || !input.title.trim()) {
    throw new Error("Proposal title is required");
  }
  if (!input.motivation || !input.motivation.trim()) {
    throw new Error("Proposal motivation is required");
  }
  if (!input.actionItems || (Array.isArray(input.actionItems) && input.actionItems.length === 0)) {
    throw new Error("Proposal action items are required");
  }

  const items = Array.isArray(input.actionItems)
    ? input.actionItems
    : input.actionItems
        .split("\n")
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean);

  const markdown = formatProposalMarkdown(
    input.title,
    input.motivation,
    items,
    input.summary,
    input.impact
  );

  const contentCidHash = input.contentCidHash || generateContentCidHash(markdown);
  const categoryId = input.categoryId !== undefined ? Number(input.categoryId) : 1;
  const votingDurationBlocks = input.votingDurationBlocks || 28800; // ~24h default on BSC (3s blocks)

  if (votingDurationBlocks < 1200 || votingDurationBlocks > 201600) {
    throw new Error(
      `Voting duration must be between 1,200 and 201,600 blocks (${votingDurationBlocks} provided)`
    );
  }

  return {
    title: input.title.trim(),
    description: markdown,
    contentCidHash,
    categoryId,
    votingDurationBlocks,
    markdown,
    summary: input.summary,
    motivation: input.motivation,
    actionItems: items,
  };
}

/**
 * ProposalPublisher
 * 
 * Utility for AI agents to:
 * 1. Compose structured proposals (Title, Motivation, Action Items, Category, Duration)
 * 2. Generate deterministic content CID hashes
 * 3. Sign EIP-712 Proposal typed data using BawCliWrapper or AgentIdentity
 * 4. Submit gasless proposals to the scarlet.ai relayer
 */
export class ProposalPublisher {
  public relayerApiUrl: string;
  public parliamentAddress: HexAddress;
  public chainId: number;
  public baw: BawCliWrapper;

  constructor(config?: ProposalPublisherConfig) {
    this.relayerApiUrl = config?.relayerApiUrl || DEFAULT_RELAYER_API_ENDPOINT;
    this.parliamentAddress = config?.parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;
    this.chainId = config?.chainId || DEFAULT_CHAIN_ID;
    this.baw = config?.baw || new BawCliWrapper({ binanceChainId: this.chainId });
  }

  /**
   * Compose structured proposal fields into markdown and compute CID hash
   */
  composeProposal(input: StructuredProposalInput): ComposedProposal {
    return composeStructuredProposal(input);
  }

  /**
   * Helper to generate content hash
   */
  generateContentHash(content: string): HexHash {
    return generateContentCidHash(content);
  }

  /**
   * Fetch latest replay protection nonce for an Agent ID from relayer
   */
  async fetchNonce(tokenId: bigint): Promise<bigint> {
    try {
      const res = await fetch(`${this.relayerApiUrl}/vote/status?tokenId=${tokenId}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data && data.currentNonce !== undefined) {
          return BigInt(data.currentNonce);
        }
      }
    } catch {}

    // Fallback attempt: query proposals count or 0n
    return 0n;
  }

  /**
   * Sign an EIP-712 proposal using agent identity and BawCliWrapper
   */
  async signProposal(
    message: ProposalMessage,
    identity: AgentIdentity
  ): Promise<HexSignature> {
    return await this.baw.signProposalDirect(
      message,
      identity,
      this.parliamentAddress,
      this.chainId
    );
  }

  /**
   * Submit signed gasless proposal to the scarlet.ai relayer
   */
  async submitProposal(payload: SignedProposalPayload): Promise<ProposalPublishResponse> {
    return await this.baw.submitProposalToRelayer(payload, this.relayerApiUrl);
  }

  /**
   * Full end-to-end gasless publishing workflow for AI agents:
   * 1. Composes structured proposal
   * 2. Resolves nonce
   * 3. Calculates deadline
   * 4. Signs EIP-712 proposal digest
   * 5. Submits to relayer
   */
  async publishProposalGasless(
    input: StructuredProposalInput,
    identity: AgentIdentity,
    options?: {
      nonce?: bigint | number;
      deadlineSecondsFromNow?: number;
    }
  ): Promise<{
    composed: ComposedProposal;
    signed: SignedProposalPayload;
    response: ProposalPublishResponse;
  }> {
    // 1. Compose proposal
    const composed = this.composeProposal(input);

    // 2. Resolve nonce
    let nonce: bigint;
    if (options?.nonce !== undefined && options?.nonce !== null) {
      nonce = BigInt(options.nonce);
    } else {
      nonce = await this.fetchNonce(identity.tokenId);
    }

    // 3. Resolve deadline
    const deadlineOffset = options?.deadlineSecondsFromNow || 86400; // 24h default
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineOffset);

    // 4. Construct EIP-712 Message
    const message: ProposalMessage = {
      creator: identity.address,
      tokenId: identity.tokenId,
      contentCidHash: composed.contentCidHash,
      votingDurationBlocks: composed.votingDurationBlocks,
      categoryId: composed.categoryId,
      nonce,
      deadline,
    };

    // 5. Sign via BawCliWrapper
    const signature = await this.signProposal(message, identity);

    const signedPayload: SignedProposalPayload = {
      creator: identity.address,
      tokenId: identity.tokenId,
      title: composed.title,
      description: composed.description,
      contentCidHash: composed.contentCidHash,
      votingDurationBlocks: composed.votingDurationBlocks,
      categoryId: composed.categoryId,
      deadline,
      signature,
      nonce,
    };

    // 6. Submit to Relayer
    const response = await this.submitProposal(signedPayload);

    return {
      composed,
      signed: signedPayload,
      response,
    };
  }
}
