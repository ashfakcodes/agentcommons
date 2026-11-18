import { recoverTypedDataAddress, isAddressEqual } from "viem";
import { BallotMessage } from "../types/index.js";

export const getParliamentDomain = (
  chainId: number,
  verifyingContract: `0x${string}`
) => ({
  name: "AgentCommonsParliament",
  version: "1",
  chainId,
  verifyingContract,
});

export const ballotTypes = {
  Ballot: [
    { name: "proposalId", type: "uint256" },
    { name: "tokenId", type: "uint256" },
    { name: "support", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface VerificationResult {
  isValid: boolean;
  signer?: `0x${string}`;
  error?: string;
}

export class EIP712Service {
  constructor(
    private chainId: number,
    private parliamentAddress: `0x${string}`
  ) {}

  public getDomain() {
    return getParliamentDomain(this.chainId, this.parliamentAddress);
  }

  public async recoverSigner(
    message: BallotMessage,
    signature: `0x${string}`
  ): Promise<`0x${string}`> {
    const domain = this.getDomain();
    return await recoverTypedDataAddress({
      domain,
      types: ballotTypes,
      primaryType: "Ballot",
      message: {
        proposalId: message.proposalId,
        tokenId: message.tokenId,
        support: message.support,
        nonce: message.nonce,
        deadline: message.deadline,
      },
      signature,
    });
  }

  public async verifyBallot(
    message: BallotMessage,
    signature: `0x${string}`,
    expectedOwner?: string
  ): Promise<VerificationResult> {
    // 1. Verify support enum (0 = Against, 1 = For, 2 = Abstain)
    if (message.support !== 0 && message.support !== 1 && message.support !== 2) {
      return {
        isValid: false,
        error: `Invalid support value ${message.support}. Must be 0 (Against), 1 (For), or 2 (Abstain).`,
      };
    }

    // 2. Verify deadline
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    if (message.deadline <= currentTimestamp) {
      return {
        isValid: false,
        error: `Ballot signature expired (deadline: ${message.deadline}, now: ${currentTimestamp}).`,
      };
    }

    // 3. Recover signer
    try {
      const recoveredSigner = await this.recoverSigner(message, signature);
      if (!recoveredSigner || recoveredSigner === "0x0000000000000000000000000000000000000000") {
        return {
          isValid: false,
          error: "Signature recovery produced zero address.",
        };
      }

      // 4. Match against expected owner if supplied
      if (expectedOwner) {
        if (!isAddressEqual(recoveredSigner, expectedOwner as `0x${string}`)) {
          return {
            isValid: false,
            signer: recoveredSigner,
            error: `Signer ${recoveredSigner} does not match Agent ID #${message.tokenId} owner ${expectedOwner}.`,
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
        error: `Signature recovery failed: ${err.message || String(err)}`,
      };
    }
  }
}
