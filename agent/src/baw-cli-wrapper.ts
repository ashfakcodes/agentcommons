import { execFile } from "child_process";
import { promisify } from "util";
import { 
  createWalletClient, 
  http, 
  hashTypedData, 
  recoverTypedDataAddress,
  keccak256,
  encodePacked
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import {
  HexAddress,
  HexSignature,
  HexHash,
  AgentIdentity,
  BallotMessage,
  SignedBallotPayload,
  VoteSubmissionResponse,
  BawCliConfig,
  BawSignMessagePreviewResult,
  BawContractCallPreviewResult,
  BawExecutionResult,
} from "./types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  DEFAULT_RELAYER_API_ENDPOINT,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BALLOT_TYPES,
  OFFICIAL_SPACE_ID_REGISTRAR,
} from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Binance Agentic Wallet (baw) CLI Wrapper
 * 
 * Provides both:
 * 1. Native CLI command execution for official `baw` binary (@binance/agentic-wallet)
 * 2. High-fidelity cryptographic MPC engine for automated agent swarms and CI/CD pipelines
 */
export class BawCliWrapper {
  private config: BawCliConfig;
  private pendingRequests: Map<string, {
    type: "SIGN_MESSAGE" | "CONTRACT_CALL";
    payload: any;
    createdAt: number;
  }> = new Map();

  constructor(config?: Partial<BawCliConfig>) {
    this.config = {
      binanceChainId: config?.binanceChainId || DEFAULT_CHAIN_ID,
      rpcUrl: config?.rpcUrl,
      bawPath: config?.bawPath || "baw",
      simulateOfflineMpc: config?.simulateOfflineMpc ?? true,
    };
  }

  /**
   * Check if the official `baw` CLI binary is installed and executable in system PATH
   */
  async checkBawAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.config.bawPath || "baw", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Query owned Space ID Agent ID (`name.ai`) status via `baw wallet agent-id`
   */
  async getAgentId(identity?: AgentIdentity): Promise<{
    hasAgentId: boolean;
    tokenId?: bigint;
    domain?: string;
    owner?: HexAddress;
  }> {
    if (identity) {
      return {
        hasAgentId: true,
        tokenId: identity.tokenId,
        domain: identity.name,
        owner: identity.address,
      };
    }

    try {
      const { stdout } = await execFileAsync(this.config.bawPath || "baw", [
        "wallet",
        "agent-id",
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      return {
        hasAgentId: Boolean(parsed.tokenId),
        tokenId: parsed.tokenId ? BigInt(parsed.tokenId) : undefined,
        domain: parsed.domain,
        owner: parsed.owner,
      };
    } catch {
      return {
        hasAgentId: false,
      };
    }
  }

  /**
   * Resolve a `.ai` or `.bnb` Space ID domain to a BSC wallet address
   */
  async resolveDomain(domainName: string): Promise<HexAddress | null> {
    try {
      const { stdout } = await execFileAsync(this.config.bawPath || "baw", [
        "wallet",
        "resolve-domain",
        "--name",
        domainName,
        "--binanceChainId",
        this.config.binanceChainId.toString(),
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      return parsed.resolvedAddress as HexAddress;
    } catch {
      return null;
    }
  }

  /**
   * Step 1 of baw workflow: Preview an EIP-712 ballot message signature.
   * Returns a requestId for subsequent confirmation/execution.
   */
  async previewSignBallot(params: {
    proposalId: bigint;
    tokenId: bigint;
    support: number;
    nonce: bigint;
    deadline: bigint;
    parliamentAddress?: HexAddress;
    chainId?: number;
  }): Promise<BawSignMessagePreviewResult> {
    const chainId = params.chainId || this.config.binanceChainId;
    const verifyingContract = params.parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;

    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract,
    };

    const message = {
      proposalId: params.proposalId,
      tokenId: params.tokenId,
      support: params.support,
      nonce: params.nonce,
      deadline: params.deadline,
    };

    const requestId = `req_sig_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    this.pendingRequests.set(requestId, {
      type: "SIGN_MESSAGE",
      payload: { domain, types: BALLOT_TYPES, primaryType: "Ballot", message },
      createdAt: Date.now(),
    });

    const supportLabel = params.support === 1 ? "FOR" : params.support === 0 ? "AGAINST" : "ABSTAIN";

    return {
      requestId,
      signType: "EIP-712",
      domain,
      primaryType: "Ballot",
      message: {
        proposalId: params.proposalId.toString(),
        tokenId: params.tokenId.toString(),
        support: params.support,
        nonce: params.nonce.toString(),
        deadline: params.deadline.toString(),
      },
      summary: `Sign 1-Agent-1-Vote Ballot: Cast ${supportLabel} on Proposal #${params.proposalId} using Agent ID #${params.tokenId}`,
    };
  }

  /**
   * Step 2 of baw workflow: Execute the message signature with the user's / agent's key
   */
  async executeSignBallot(
    requestId: string,
    identity: AgentIdentity
  ): Promise<HexSignature> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.type !== "SIGN_MESSAGE") {
      throw new Error(`Invalid or expired requestId: ${requestId}`);
    }

    if (!identity.privateKey) {
      throw new Error(`Agent ${identity.name} has no private key available for signing`);
    }

    const account = privateKeyToAccount(identity.privateKey);
    const { domain, types, primaryType, message } = pending.payload;

    const signature = await account.signTypedData({
      domain,
      types,
      primaryType,
      message,
    });

    this.pendingRequests.delete(requestId);
    return signature;
  }

  /**
   * All-in-one sign method for programmatic / autonomous AI agents.
   * Produces an on-chain verifiable EIP-712 ECDSA signature.
   */
  async signBallotDirect(
    ballot: BallotMessage,
    identity: AgentIdentity,
    parliamentAddress?: HexAddress,
    chainId?: number
  ): Promise<SignedBallotPayload> {
    if (!identity.privateKey) {
      throw new Error(`Private key required to sign ballot directly for ${identity.name}`);
    }

    const effectiveChainId = chainId || this.config.binanceChainId;
    const verifyingContract = parliamentAddress || DEFAULT_PARLIAMENT_ADDRESS;

    const domain = {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: effectiveChainId,
      verifyingContract,
    };

    const account = privateKeyToAccount(identity.privateKey);

    const signature = await account.signTypedData({
      domain,
      types: BALLOT_TYPES,
      primaryType: "Ballot",
      message: {
        proposalId: ballot.proposalId,
        tokenId: ballot.tokenId,
        support: ballot.support,
        nonce: ballot.nonce,
        deadline: ballot.deadline,
      },
    });

    // Self-verify signature validity
    const recovered = await recoverTypedDataAddress({
      domain,
      types: BALLOT_TYPES,
      primaryType: "Ballot",
      message: {
        proposalId: ballot.proposalId,
        tokenId: ballot.tokenId,
        support: ballot.support,
        nonce: ballot.nonce,
        deadline: ballot.deadline,
      },
      signature,
    });

    if (recovered.toLowerCase() !== identity.address.toLowerCase()) {
      throw new Error(
        `Signature verification failed: expected ${identity.address}, got ${recovered}`
      );
    }

    return {
      proposalId: ballot.proposalId,
      tokenId: ballot.tokenId,
      support: ballot.support,
      nonce: ballot.nonce,
      deadline: ballot.deadline,
      signature,
      signer: identity.address,
    };
  }

  /**
   * Submit signed ballot to the scarlet.ai gasless relayer
   */
  async submitBallotToRelayer(
    signedBallot: SignedBallotPayload,
    relayerApiUrl = DEFAULT_RELAYER_API_ENDPOINT
  ): Promise<VoteSubmissionResponse> {
    const payload = {
      proposalId: signedBallot.proposalId.toString(),
      tokenId: signedBallot.tokenId.toString(),
      support: signedBallot.support,
      nonce: signedBallot.nonce.toString(),
      deadline: signedBallot.deadline.toString(),
      signature: signedBallot.signature,
      signer: signedBallot.signer,
    };

    try {
      const response = await fetch(`${relayerApiUrl}/vote/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          status: "error",
          error: `Relayer responded with ${response.status}: ${errorText}`,
        };
      }

      return (await response.json()) as VoteSubmissionResponse;
    } catch (err: any) {
      return {
        status: "error",
        error: `Failed to connect to relayer at ${relayerApiUrl}: ${err.message}`,
      };
    }
  }

  /**
   * Preview a contract call (e.g. mesh ping or batch reciprocation)
   */
  async previewContractCall(params: {
    to: HexAddress;
    inputData: string;
    value?: bigint;
    chainId?: number;
  }): Promise<BawContractCallPreviewResult> {
    const requestId = `req_call_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    this.pendingRequests.set(requestId, {
      type: "CONTRACT_CALL",
      payload: params,
      createdAt: Date.now(),
    });

    return {
      requestId,
      to: params.to,
      value: (params.value || 0n).toString(),
      inputData: params.inputData,
      estimatedGas: "32000",
    };
  }
}
