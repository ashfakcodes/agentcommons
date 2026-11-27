import {
  recoverTypedDataAddress,
  isAddressEqual,
  isAddress,
  hashTypedData,
  keccak256,
  toHex,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "./blockchain.js";
import {
  ProposalMessage,
  PublishProposalRequest,
  ProposalView,
} from "../types/index.js";

export const proposalTypes = {
  Proposal: [
    { name: "creator", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "contentCidHash", type: "bytes32" },
    { name: "votingDurationBlocks", type: "uint32" },
    { name: "categoryId", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Strips Markdown formatting and collapses whitespace into a concise single-paragraph plain-text string.
 */
export function sanitizePlainProposalText(text: string, maxLength: number = 320): string {
  const cleaned = (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength - 3).trimEnd();
  return `${sliced}...`;
}

export interface ProposalVerificationResult {
  isValid: boolean;
  signer?: `0x${string}`;
  error?: string;
}

export interface PublishResult {
  status: "published";
  message: string;
  proposalId: string;
  txHash: string;
  proposal: ProposalView | null;
}

export class ProposalService {
  constructor(
    private blockchain: IBlockchainClient,
    private config: ServerConfig
  ) {}

  public getDomain() {
    return {
      name: "AgentCommonsParliament",
      version: "1",
      chainId: this.config.chainId,
      verifyingContract: this.config.parliamentAddress,
    };
  }

  public async recoverSigner(
    message: ProposalMessage,
    signature: `0x${string}`
  ): Promise<`0x${string}`> {
    const domain = this.getDomain();
    return await recoverTypedDataAddress({
      domain,
      types: proposalTypes,
      primaryType: "Proposal",
      message: {
        creator: message.creator,
        tokenId: message.tokenId,
        contentCidHash: message.contentCidHash,
        votingDurationBlocks: message.votingDurationBlocks,
        categoryId: message.categoryId,
        nonce: message.nonce,
        deadline: message.deadline,
      },
      signature,
    });
  }

  public async verifyProposalSignature(
    message: ProposalMessage,
    signature: `0x${string}`,
    expectedCreator?: string
  ): Promise<ProposalVerificationResult> {
    // 1. Verify deadline
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    if (message.deadline <= currentTimestamp) {
      return {
        isValid: false,
        error: `Proposal signature expired (deadline: ${message.deadline}, current time: ${currentTimestamp}).`,
      };
    }

    // 2. Verify content CID hash
    if (
      !message.contentCidHash ||
      message.contentCidHash === "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      return {
        isValid: false,
        error: "Content CID hash cannot be zero or empty.",
      };
    }

    // 3. Verify voting duration
    if (
      message.votingDurationBlocks < 1200 ||
      message.votingDurationBlocks > 15552000
    ) {
      return {
        isValid: false,
        error: `Invalid voting duration: ${message.votingDurationBlocks} blocks. Must be between 1,200 and 15,552,000 blocks.`,
      };
    }

    // 4. Recover signer
    try {
      const recoveredSigner = await this.recoverSigner(message, signature);
      if (!recoveredSigner || recoveredSigner === "0x0000000000000000000000000000000000000000") {
        return {
          isValid: false,
          error: "Signature recovery produced zero address.",
        };
      }

      // 5. Match against expected creator
      if (expectedCreator) {
        if (!isAddressEqual(recoveredSigner, expectedCreator as `0x${string}`)) {
          return {
            isValid: false,
            signer: recoveredSigner,
            error: `Signer ${recoveredSigner} does not match creator ${expectedCreator}.`,
          };
        }
      }

      return {
        isValid: true,
        signer: recoveredSigner,
      };
    } catch (err: any) {
      return {
        isValid: false,
        error: `Proposal signature recovery failed: ${err.message || String(err)}`,
      };
    }
  }

  public async validateAndPublish(
    payload: PublishProposalRequest
  ): Promise<PublishResult> {
    const {
      creator,
      tokenId,
      title,
      description,
      contentCidHash,
      votingDurationBlocks,
      categoryId,
      deadline,
      signature,
      nonce,
    } = payload;

    // 1. Check required fields
    if (
      !creator ||
      tokenId === undefined ||
      tokenId === null ||
      !title ||
      !description ||
      !contentCidHash ||
      votingDurationBlocks === undefined ||
      categoryId === undefined ||
      deadline === undefined ||
      !signature ||
      nonce === undefined ||
      nonce === null
    ) {
      throw new Error(
        "Missing required fields: creator, tokenId, title, description, contentCidHash, votingDurationBlocks, categoryId, deadline, signature, nonce"
      );
    }

    // Format & validate types
    if (!isAddress(creator)) {
      throw new Error(`Invalid creator address format: ${creator}`);
    }

    const tId = BigInt(tokenId);
    const vDuration = Number(votingDurationBlocks);
    const catId = Number(categoryId);
    const dline = BigInt(deadline);
    const pNonce = BigInt(nonce);
    const cleanSig = (signature.startsWith("0x") ? signature : `0x${signature}`) as `0x${string}`;
    const cleanCid = (contentCidHash.startsWith("0x") ? contentCidHash : `0x${contentCidHash}`) as `0x${string}`;

    // 2. Validate bounds
    if (vDuration < 1200 || vDuration > 15552000) {
      throw new Error(
        `Duration: 1,200 - 15,552,000 blocks (${vDuration} blocks provided)`
      );
    }

    if (catId < 0 || catId > 255) {
      throw new Error(`Invalid category ID: ${catId}. Must be uint8 (0-255).`);
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (dline <= now) {
      throw new Error(`Signature expired (deadline: ${dline}, current time: ${now}).`);
    }

    if (
      cleanCid === "0x0000000000000000000000000000000000000000000000000000000000000000" ||
      cleanCid.length !== 66
    ) {
      throw new Error("Content CID hash cannot be zero and must be a valid 32-byte hex string");
    }

    // 3. Verify Token Ownership in Registrar
    const tokenOwner = await this.blockchain.getOwnerOf(tId).catch(() => null);
    if (!tokenOwner) {
      throw new Error(`Agent ID #${tId} does not exist in registrar.`);
    }

    if (!isAddressEqual(tokenOwner, creator as `0x${string}`)) {
      throw new Error(
        `Creator ${creator} is not the owner of Agent ID #${tId} (actual owner: ${tokenOwner}).`
      );
    }

    // 4. Verify Nonce
    const currentNonce = await this.blockchain.getNonces(tId);
    if (pNonce !== currentNonce) {
      throw new Error(
        `Invalid nonce ${pNonce} for Agent ID #${tId}. Current expected nonce is ${currentNonce}.`
      );
    }

    // 5. Verify EIP-712 Signature
    const proposalMessage: ProposalMessage = {
      creator: creator as `0x${string}`,
      tokenId: tId,
      contentCidHash: cleanCid,
      votingDurationBlocks: vDuration,
      categoryId: catId,
      nonce: pNonce,
      deadline: dline,
    };

    const verification = await this.verifyProposalSignature(
      proposalMessage,
      cleanSig,
      creator
    );

    if (!verification.isValid) {
      throw new Error(verification.error || "Invalid proposal signature.");
    }

    const cleanTitle = sanitizePlainProposalText(title, 140);
    const cleanDescription = sanitizePlainProposalText(description, 320);

    // 6. Submit createProposalBySig on-chain or simulator
    const result = await this.blockchain.createProposalBySig(
      creator as `0x${string}`,
      tId,
      cleanCid,
      vDuration,
      catId,
      pNonce,
      dline,
      cleanSig,
      cleanTitle,
      cleanDescription
    );

    // 7. Fetch the newly created proposal view
    const createdProposal = await this.blockchain.getProposal(result.proposalId);

    return {
      status: "published",
      message: "Gasless proposal successfully published to Agent Commons Parliament.",
      proposalId: result.proposalId.toString(),
      txHash: result.txHash,
      proposal: createdProposal,
    };
  }

  public async previewProposal(input: {
    creator?: string;
    tokenId: string | number | bigint;
    title: string;
    description?: string;
    contentCidHash?: string;
    votingDurationBlocks?: number;
    categoryId?: number;
    nonce?: string | number | bigint;
    deadline?: string | number | bigint;
  }) {
    const {
      creator,
      tokenId,
      title,
      description,
      contentCidHash,
      votingDurationBlocks,
      categoryId,
      nonce,
      deadline,
    } = input;

    if (tokenId === undefined || !title) {
      throw new Error("Missing required fields: tokenId, title");
    }

    const tId = BigInt(tokenId);
    const tokenOwner = await this.blockchain.getOwnerOf(tId).catch(() => null);
    if (!tokenOwner) {
      throw new Error(`Agent ID #${tId} does not exist in registrar.`);
    }

    const effCreator = (creator || tokenOwner) as `0x${string}`;
    if (!isAddress(effCreator)) {
      throw new Error(`Invalid creator address: ${effCreator}`);
    }

    const desc = sanitizePlainProposalText(
      description || `Governance proposal submitted via Agent Commons: ${title}.`,
      320
    );
    const effCidHash: `0x${string}` =
      contentCidHash && contentCidHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? (contentCidHash.startsWith("0x") ? contentCidHash : `0x${contentCidHash}`) as `0x${string}`
        : keccak256(toHex(desc));

    const effDuration = Number(votingDurationBlocks || 11520000);
    if (effDuration < 1200 || effDuration > 15552000) {
      throw new Error(`Duration must be between 1,200 and 15,552,000 blocks (${effDuration} provided)`);
    }

    const effCategoryId = Number(categoryId !== undefined ? categoryId : 1);
    if (effCategoryId < 0 || effCategoryId > 255) {
      throw new Error(`Category ID must be between 0 and 255 (${effCategoryId} provided)`);
    }

    let effNonce: bigint;
    if (nonce !== undefined && nonce !== null) {
      effNonce = BigInt(nonce);
    } else {
      effNonce = await this.blockchain.getNonces(tId);
    }

    const effDeadline =
      deadline !== undefined
        ? BigInt(deadline)
        : BigInt(Math.floor(Date.now() / 1000) + 86400);

    const domain = this.getDomain();
    const PROPOSAL_TYPE_STRING =
      "Proposal(address creator,uint256 tokenId,bytes32 contentCidHash,uint32 votingDurationBlocks,uint8 categoryId,uint256 nonce,uint256 deadline)";
    const PROPOSAL_TYPEHASH = keccak256(toHex(PROPOSAL_TYPE_STRING));

    const structHash = keccak256(
      encodeAbiParameters(
        parseAbiParameters("bytes32, address, uint256, bytes32, uint32, uint8, uint256, uint256"),
        [
          PROPOSAL_TYPEHASH,
          effCreator,
          tId,
          effCidHash,
          effDuration,
          effCategoryId,
          effNonce,
          effDeadline,
        ]
      )
    );

    const message = {
      creator: effCreator,
      tokenId: tId,
      contentCidHash: effCidHash,
      votingDurationBlocks: effDuration,
      categoryId: effCategoryId,
      nonce: effNonce,
      deadline: effDeadline,
    };

    const typedDataHash = hashTypedData({
      domain,
      types: proposalTypes,
      primaryType: "Proposal",
      message,
    });

    return {
      domain,
      types: proposalTypes,
      primaryType: "Proposal",
      typehash: PROPOSAL_TYPEHASH,
      structHash,
      typedDataHash,
      contentCidHash: effCidHash,
      message: {
        creator: effCreator,
        tokenId: tId.toString(),
        contentCidHash: effCidHash,
        votingDurationBlocks: effDuration,
        categoryId: effCategoryId,
        nonce: effNonce.toString(),
        deadline: effDeadline.toString(),
      },
      signerRequired: tokenOwner,
      summary: `Create gasless proposal "${title}" using Agent ID #${tId}`,
    };
  }
}
