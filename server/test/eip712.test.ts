import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { EIP712Service, ballotTypes } from "../src/services/eip712.js";
import { BallotMessage } from "../src/types/index.js";

describe("EIP712Service", () => {
  const chainId = 56;
  const parliamentAddress = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  const eip712Service = new EIP712Service(chainId, parliamentAddress);

  const testPrivateKey = generatePrivateKey();
  const testAccount = privateKeyToAccount(testPrivateKey);

  it("should successfully recover signer from a valid ballot signature", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const message: BallotMessage = {
      proposalId: 1n,
      tokenId: 10n,
      support: 1, // For
      nonce: 0n,
      deadline,
    };

    const signature = await testAccount.signTypedData({
      domain: eip712Service.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: {
        proposalId: message.proposalId,
        tokenId: message.tokenId,
        support: message.support,
        nonce: message.nonce,
        deadline: message.deadline,
      },
    });

    const verification = await eip712Service.verifyBallot(
      message,
      signature,
      testAccount.address
    );

    expect(verification.isValid).toBe(true);
    expect(verification.signer?.toLowerCase()).toBe(testAccount.address.toLowerCase());
  });

  it("should reject ballot with an expired deadline", async () => {
    const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);
    const message: BallotMessage = {
      proposalId: 1n,
      tokenId: 10n,
      support: 1,
      nonce: 0n,
      deadline: expiredDeadline,
    };

    const signature = await testAccount.signTypedData({
      domain: eip712Service.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: {
        proposalId: message.proposalId,
        tokenId: message.tokenId,
        support: message.support,
        nonce: message.nonce,
        deadline: message.deadline,
      },
    });

    const verification = await eip712Service.verifyBallot(message, signature);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain("expired");
  });

  it("should reject ballot with invalid support value", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const message: BallotMessage = {
      proposalId: 1n,
      tokenId: 10n,
      support: 5, // Invalid (only 0, 1, 2 allowed)
      nonce: 0n,
      deadline,
    };

    const fakeSig = "0x" + "1".repeat(130);
    const verification = await eip712Service.verifyBallot(message, fakeSig as `0x${string}`);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain("Invalid support value");
  });

  it("should reject when signer does not match expected token owner", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const message: BallotMessage = {
      proposalId: 1n,
      tokenId: 10n,
      support: 0,
      nonce: 0n,
      deadline,
    };

    const signature = await testAccount.signTypedData({
      domain: eip712Service.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: {
        proposalId: message.proposalId,
        tokenId: message.tokenId,
        support: message.support,
        nonce: message.nonce,
        deadline: message.deadline,
      },
    });

    const otherAccount = privateKeyToAccount(generatePrivateKey());
    const verification = await eip712Service.verifyBallot(
      message,
      signature,
      otherAccount.address
    );

    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain("does not match Agent ID");
  });
});
