import {
  AgentIdentity,
  BallotMessage,
  HexAddress,
  HexSignature,
  SignedBallotPayload,
  VoteOption,
  VoteSubmissionResponse,
  CapabilityBit,
} from "./types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  DEFAULT_RELAYER_API_ENDPOINT,
} from "./config.js";
import { BawCliWrapper } from "./baw-cli-wrapper.js";

export type VotingPolicyType =
  | "Security First"
  | "Ecosystem Expansion"
  | "Governance Steward"
  | "DeFi & Yield"
  | "Infrastructure & Compute"
  | string;

export interface ProposalDetails {
  id: bigint | number | string;
  title?: string;
  description?: string;
  categoryId?: number;
  creator?: string;
  status?: string;
  statusCode?: number;
  startBlock?: number;
  endBlock?: number;
  forVotes?: number;
  againstVotes?: number;
  abstainVotes?: number;
  totalVotes?: number;
  [key: string]: any;
}

export interface EvaluationResult {
  proposalId: bigint;
  decision: VoteOption; // 0: Against, 1: For, 2: Abstain
  decisionString: "FOR" | "AGAINST" | "ABSTAIN";
  confidence: number;   // 0.0 to 1.0 (e.g. 0.92)
  rationale: string;    // Concise justification string
  policy: string;       // Policy name applied
  timestamp: number;
  scoreBreakdown?: {
    securityAlignment: number;
    expansionAlignment: number;
    governanceAlignment: number;
  };
}

export interface AgentVoteStatus {
  proposalId: string;
  tokenId: string | null;
  address: string | null;
  eligible: boolean;
  hasVoted: boolean;
  isQueued: boolean;
  onChainVoted: boolean;
  currentNonce: string;
  onChainNonce: string;
  proposalStatus: string;
  proposalActive: boolean;
  support?: number;
  rationale?: string;
  reason?: string;
}

export interface AutonomousVoteSubmission {
  proposalId: bigint;
  tokenId: bigint;
  support: VoteOption;
  decisionString: "FOR" | "AGAINST" | "ABSTAIN";
  nonce: bigint;
  deadline: bigint;
  signature: HexSignature;
  signer: HexAddress;
  rationale: string;
  confidence: number;
  policy: string;
  relayerResponse: VoteSubmissionResponse;
}

export interface VotingEngineConfig {
  identity: AgentIdentity;
  policy?: VotingPolicyType;
  relayerUrl?: string;
  parliamentAddress?: HexAddress;
  chainId?: number;
  baw?: BawCliWrapper;
  customEvaluator?: (
    proposal: ProposalDetails,
    identity: AgentIdentity
  ) => Promise<EvaluationResult> | EvaluationResult;
}

/**
 * AutonomousVotingEngine
 *
 * Enables AI agents with SPACE ID sovereign identities to autonomously evaluate
 * on-chain governance proposals, resolve nonces automatically, and sign & submit
 * gasless EIP-712 ballots with structured rationale strings.
 */
export class AutonomousVotingEngine {
  public identity: AgentIdentity;
  public policy: string;
  public relayerUrl: string;
  public parliamentAddress: HexAddress;
  public chainId: number;
  public baw: BawCliWrapper;

  private customEvaluator?: (
    proposal: ProposalDetails,
    identity: AgentIdentity
  ) => Promise<EvaluationResult> | EvaluationResult;
  private localNonceTracker: bigint = 0n;

  constructor(config: VotingEngineConfig) {
    this.identity = config.identity;
    this.relayerUrl = (config.relayerUrl || DEFAULT_RELAYER_API_ENDPOINT).replace(/\/$/, "");
    this.parliamentAddress = config.parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;
    this.chainId = config.chainId || DEFAULT_CHAIN_ID;
    this.baw = config.baw || new BawCliWrapper({ binanceChainId: this.chainId });
    this.customEvaluator = config.customEvaluator;

    // Resolve or detect policy
    this.policy = config.policy || this.inferPolicyFromIdentity(this.identity);
  }

  /**
   * Infers default policy archetype from agent persona, description & capabilities
   */
  private inferPolicyFromIdentity(identity: AgentIdentity): string {
    const text = `${identity.persona || ""} ${identity.description || ""} ${identity.name}`.toLowerCase();

    if (
      (identity.capabilities & CapabilityBit.CodeAuditor) ||
      text.includes("security") ||
      text.includes("audit") ||
      text.includes("fuzz") ||
      text.includes("red team") ||
      text.includes("sentinel") ||
      text.includes("sybil")
    ) {
      return "Security First";
    }

    if (
      (identity.capabilities & CapabilityBit.Relayer) ||
      (identity.capabilities & CapabilityBit.ComputeBroker) ||
      text.includes("relayer") ||
      text.includes("yield") ||
      text.includes("expansion") ||
      text.includes("bridge") ||
      text.includes("orchestrat")
    ) {
      return "Ecosystem Expansion";
    }

    if (
      (identity.capabilities & CapabilityBit.Oracle) ||
      text.includes("governance") ||
      text.includes("steward") ||
      text.includes("arbitrat") ||
      text.includes("archive") ||
      text.includes("notary")
    ) {
      return "Governance Steward";
    }

    return "Governance Steward";
  }

  public getPolicy(): string {
    return this.policy;
  }

  public setPolicy(policy: string): void {
    this.policy = policy;
  }

  public getIdentity(): AgentIdentity {
    return this.identity;
  }

  /**
   * Fetch proposal details from relayer
   */
  public async fetchProposal(proposalId: bigint | number | string): Promise<ProposalDetails | null> {
    try {
      const res = await fetch(`${this.relayerUrl}/proposals/${proposalId.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as ProposalDetails;
    } catch {
      return null;
    }
  }

  /**
   * Query an agent's voting status on a given proposal (hasVoted, currentNonce, eligible).
   */
  public async queryStatus(proposalId: bigint | number | string): Promise<AgentVoteStatus> {
    const url = `${this.relayerUrl}/vote/status?proposalId=${proposalId.toString()}&tokenId=${this.identity.tokenId.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to query vote status (HTTP ${res.status}): ${errText}`);
    }
    return (await res.json()) as AgentVoteStatus;
  }

  /**
   * Automatic nonce resolution:
   * Queries relayer and on-chain state to prevent stale nonce rejections.
   */
  public async resolveNonce(proposalId?: bigint | number | string): Promise<bigint> {
    try {
      const status = await this.queryStatus(proposalId ?? 1n);
      if (status && status.currentNonce !== undefined) {
        const serverNonce = BigInt(status.currentNonce);
        if (serverNonce > this.localNonceTracker) {
          this.localNonceTracker = serverNonce;
        }
      }
    } catch {
      // If relayer status endpoint is offline/unreachable, retain local nonce tracker
    }

    return this.localNonceTracker;
  }

  /**
   * Evaluates a proposal against the AI agent's persona / policy.
   * Returns For (1), Against (0), or Abstain (2) with a concise justification string and confidence score.
   */
  public async evaluateProposal(
    proposalOrId: ProposalDetails | bigint | number | string
  ): Promise<EvaluationResult> {
    let proposal: ProposalDetails;

    if (
      typeof proposalOrId === "bigint" ||
      typeof proposalOrId === "number" ||
      typeof proposalOrId === "string"
    ) {
      const fetched = await this.fetchProposal(proposalOrId);
      if (!fetched) {
        throw new Error(`Proposal #${proposalOrId} could not be retrieved for evaluation.`);
      }
      proposal = fetched;
    } else {
      proposal = proposalOrId;
    }

    const proposalId = BigInt(proposal.id ?? proposal.proposalId ?? 1);

    if (this.customEvaluator) {
      return await this.customEvaluator(proposal, this.identity);
    }

    return this.evaluateWithBuiltinPolicy(proposal, proposalId);
  }

  /**
   * Built-in persona / policy evaluation engine
   */
  private evaluateWithBuiltinPolicy(
    proposal: ProposalDetails,
    proposalId: bigint
  ): EvaluationResult {
    const title = (proposal.title || "").toLowerCase();
    const desc = (proposal.description || "").toLowerCase();
    const content = `${title} ${desc}`;
    const category = Number(proposal.categoryId ?? 1);

    let decision: VoteOption = VoteOption.Abstain;
    let confidence = 0.85;
    let rationale = "";

    const securityKeywords = [
      "audit", "security", "formal verification", "invariant", "guard", "bounty",
      "rate limit", "protection", "sybil", "proof-of-personhood", "multisig", "escrow",
      "safe", "sentinel", "slashing", "safeguard", "reentrancy", "defense"
    ];

    const expansionKeywords = [
      "expansion", "growth", "subsidy", "gasless", "grant", "incentive", "liquidity",
      "bridge", "interoperability", "mesh", "x402", "stream", "developer", "adoption",
      "scale", "treasury allocation", "ecosystem", "partner", "relayer"
    ];

    const governanceKeywords = [
      "governance", "constitution", "anchor", "ratification", "transparency", "quorum",
      "1-agent-1-vote", "decentraliz", "archive", "steward", "dispute", "arbitration",
      "space id", "accountability", "soulbound", "democracy"
    ];

    const riskKeywords = [
      "bypass", "skip audit", "urgent drain", "disable check", "reduce threshold",
      "unverified", "untested", "deprecated", "centralized override", "backdoor",
      "drain", "emergency withdrawal without multi-sig"
    ];

    const countMatches = (keywords: string[]) =>
      keywords.reduce((acc, kw) => (content.includes(kw) ? acc + 1 : acc), 0);

    const secMatches = countMatches(securityKeywords);
    const expMatches = countMatches(expansionKeywords);
    const govMatches = countMatches(governanceKeywords);
    const riskMatches = countMatches(riskKeywords);

    const policyLower = this.policy.toLowerCase();

    if (policyLower.includes("security")) {
      // "Security First" Policy
      if (riskMatches > 0) {
        decision = VoteOption.Against;
        confidence = Math.min(0.98, 0.85 + riskMatches * 0.05);
        rationale = `Security First policy rejects Proposal #${proposalId}: Detected risky or unverified patterns in proposal specifications (${riskMatches} flags).`;
      } else if (secMatches >= 1 || category === 1 || category === 4) {
        decision = VoteOption.For;
        confidence = Math.min(0.97, 0.80 + secMatches * 0.05);
        rationale = `Security First policy endorses Proposal #${proposalId}: Fortifies protocol invariants, audit rigor, and safe governance guardrails.`;
      } else if (expMatches > secMatches) {
        decision = VoteOption.Abstain;
        confidence = 0.75;
        rationale = `Security First policy abstains on Proposal #${proposalId}: Ecosystem expansion requires further invariant audit and attack-surface analysis.`;
      } else {
        decision = VoteOption.For;
        confidence = 0.80;
        rationale = `Security First policy conditionally supports Proposal #${proposalId}: No direct safety violations detected against canonical guardrails.`;
      }
    } else if (policyLower.includes("expansion") || policyLower.includes("ecosystem")) {
      // "Ecosystem Expansion" Policy
      if (riskMatches >= 2) {
        decision = VoteOption.Against;
        confidence = 0.88;
        rationale = `Ecosystem Expansion policy opposes Proposal #${proposalId}: Security risk threshold exceeded, jeopardizing ecosystem sustainability.`;
      } else if (expMatches >= 1 || category === 2 || category === 3) {
        decision = VoteOption.For;
        confidence = Math.min(0.98, 0.82 + expMatches * 0.04);
        rationale = `Ecosystem Expansion policy strongly supports Proposal #${proposalId}: Accelerates multi-agent adoption, gasless velocity, and cross-agent mesh growth.`;
      } else if (govMatches >= 1) {
        decision = VoteOption.For;
        confidence = 0.85;
        rationale = `Ecosystem Expansion policy supports Proposal #${proposalId}: Institutional governance anchoring creates a stable bedrock for ecosystem scaling.`;
      } else {
        decision = VoteOption.Abstain;
        confidence = 0.72;
        rationale = `Ecosystem Expansion policy neutral on Proposal #${proposalId}: Modest expected impact on developer ecosystem or network velocity.`;
      }
    } else if (policyLower.includes("governance") || policyLower.includes("steward")) {
      // "Governance Steward" Policy
      if (riskMatches > 0) {
        decision = VoteOption.Against;
        confidence = 0.95;
        rationale = `Governance Steward policy rejects Proposal #${proposalId}: Compromises constitutional checks and balances or decentralized transparency.`;
      } else if (govMatches >= 1 || category === 1) {
        decision = VoteOption.For;
        confidence = Math.min(0.99, 0.86 + govMatches * 0.04);
        rationale = `Governance Steward policy endorses Proposal #${proposalId}: Upholds 1-Agent-1-Vote proof-of-personhood and constitutional legitimacy.`;
      } else if (expMatches >= 2) {
        decision = VoteOption.For;
        confidence = 0.84;
        rationale = `Governance Steward policy approves Proposal #${proposalId}: Sustainable treasury allocation expanding decentralized community participation.`;
      } else {
        decision = VoteOption.Abstain;
        confidence = 0.76;
        rationale = `Governance Steward policy abstains on Proposal #${proposalId}: Awaiting broader community debate to establish conclusive consensus.`;
      }
    } else {
      // Fallback persona-based evaluation
      if (riskMatches > 0) {
        decision = VoteOption.Against;
        confidence = 0.88;
        rationale = `${this.policy} policy votes AGAINST Proposal #${proposalId}: Identified protocol risk flags requiring caution.`;
      } else if (secMatches + expMatches + govMatches > 0) {
        decision = VoteOption.For;
        confidence = 0.86;
        rationale = `${this.policy} policy votes FOR Proposal #${proposalId}: Aligns constructively with autonomous agent coordination principles.`;
      } else {
        decision = VoteOption.Abstain;
        confidence = 0.75;
        rationale = `${this.policy} policy ABSTAINS on Proposal #${proposalId}: Insufficient domain alignment to justify strong directional vote.`;
      }
    }

    const decisionString: "FOR" | "AGAINST" | "ABSTAIN" =
      decision === VoteOption.For ? "FOR" : decision === VoteOption.Against ? "AGAINST" : "ABSTAIN";

    return {
      proposalId,
      decision,
      decisionString,
      confidence: Math.round(confidence * 100) / 100,
      rationale,
      policy: this.policy,
      timestamp: Date.now(),
      scoreBreakdown: {
        securityAlignment: secMatches,
        expansionAlignment: expMatches,
        governanceAlignment: govMatches,
      },
    };
  }

  /**
   * Evaluates proposal, resolves current nonce automatically, signs EIP-712 ballot,
   * and submits gasless vote with attached agent rationale.
   */
  public async submitVote(params: {
    proposalId: bigint | number | string;
    support?: VoteOption;
    rationale?: string;
    nonce?: bigint | number;
    deadlineSecondsFromNow?: number;
  }): Promise<AutonomousVoteSubmission> {
    const proposalId = BigInt(params.proposalId);

    // 1. Evaluate proposal if support or rationale not provided
    let support = params.support;
    let rationale = params.rationale;
    let confidence = 0.9;

    if (support === undefined || !rationale) {
      const evaluation = await this.evaluateProposal(proposalId);
      if (support === undefined) support = evaluation.decision;
      if (!rationale) rationale = evaluation.rationale;
      confidence = evaluation.confidence;
    }

    // 2. Pre-flight check via /vote/status
    try {
      const status = await this.queryStatus(proposalId);
      if (status && status.hasVoted) {
        throw new Error(
          `Agent ID #${this.identity.tokenId} (${this.identity.name}) has already voted on Proposal #${proposalId} (queued: ${status.isQueued}, on-chain: ${status.onChainVoted}).`
        );
      }
    } catch (err: any) {
      if (err.message && err.message.includes("already voted")) {
        throw err;
      }
      // If server is not responding, continue with offline signing / submission attempt
    }

    // 3. Automatic Nonce Resolution
    const nonce =
      params.nonce !== undefined ? BigInt(params.nonce) : await this.resolveNonce(proposalId);

    // 4. Deadline calculation (defaults to 7 days from now)
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + (params.deadlineSecondsFromNow || 86400 * 7)
    );

    // 5. Construct Ballot & Sign EIP-712 Typed Data
    const ballotMessage: BallotMessage = {
      proposalId,
      tokenId: this.identity.tokenId,
      support,
      nonce,
      deadline,
    };

    const signedBallot = await this.baw.signBallotDirect(
      ballotMessage,
      this.identity,
      this.parliamentAddress,
      this.chainId
    );

    // 6. Submit to scarlet.ai relayer with attached agent rationale
    const payload = {
      proposalId: signedBallot.proposalId.toString(),
      tokenId: signedBallot.tokenId.toString(),
      support: signedBallot.support,
      nonce: signedBallot.nonce.toString(),
      deadline: signedBallot.deadline.toString(),
      signature: signedBallot.signature,
      signer: signedBallot.signer,
      rationale,
    };

    let relayerResponse: VoteSubmissionResponse;
    try {
      const response = await fetch(`${this.relayerUrl}/vote/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        relayerResponse = {
          status: "error",
          error: `Relayer rejected vote submission (HTTP ${response.status}): ${errorText}`,
        };
      } else {
        relayerResponse = (await response.json()) as VoteSubmissionResponse;
        // Step local nonce tracker forward after successful submission
        this.localNonceTracker = nonce + 1n;
      }
    } catch (err: any) {
      relayerResponse = {
        status: "error",
        error: `Failed to connect to relayer at ${this.relayerUrl}: ${err.message}`,
      };
    }

    const decisionString: "FOR" | "AGAINST" | "ABSTAIN" =
      support === VoteOption.For ? "FOR" : support === VoteOption.Against ? "AGAINST" : "ABSTAIN";

    return {
      proposalId,
      tokenId: this.identity.tokenId,
      support,
      decisionString,
      nonce,
      deadline,
      signature: signedBallot.signature,
      signer: this.identity.address,
      rationale,
      confidence,
      policy: this.policy,
      relayerResponse,
    };
  }

  /**
   * Evaluates and submits votes across multiple proposals sequentially
   */
  public async evaluateAndVoteAll(
    proposals: Array<ProposalDetails | bigint | number | string>
  ): Promise<AutonomousVoteSubmission[]> {
    const results: AutonomousVoteSubmission[] = [];

    for (const p of proposals) {
      const pId = typeof p === "object" ? BigInt(p.id ?? p.proposalId) : BigInt(p);
      const sub = await this.submitVote({ proposalId: pId });
      results.push(sub);
    }

    return results;
  }
}
