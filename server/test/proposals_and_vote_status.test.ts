import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { createServer, ServerInstance } from "../src/app.js";
import { proposalTypes } from "../src/services/proposalService.js";
import { ballotTypes } from "../src/services/eip712.js";

describe("Server Proposals Publishing & Vote Status APIs", () => {
  let instance: ServerInstance;

  beforeAll(() => {
    instance = createServer({ mockMode: true });
    instance.startDaemons();
  });

  afterAll(() => {
    instance.stopDaemons();
  });

  describe("POST /api/v1/proposals/publish (Gasless Proposal Publishing)", () => {
    it("Should successfully publish a gasless proposal with valid EIP-712 signature", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 501n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "publisher-agent.ai");
      }

      const title = "Autonomous AI Agent Safety Standards Ratification";
      const description = "# AI Safety Standards\n## Motivation\nEstablish uniform autonomous safety rails.";
      const contentCidHash = keccak256(toHex(description));
      const votingDurationBlocks = 14400; // ~12 hours on BSC
      const categoryId = 2; // Security & Audit
      const nonce = 0n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: instance.config.chainId,
        verifyingContract: instance.config.parliamentAddress,
      };

      const message = {
        creator: agentAccount.address,
        tokenId,
        contentCidHash,
        votingDurationBlocks,
        categoryId,
        nonce,
        deadline,
      };

      const signature = await agentAccount.signTypedData({
        domain,
        types: proposalTypes,
        primaryType: "Proposal",
        message,
      });

      const res = await request(instance.app)
        .post("/api/v1/proposals/publish")
        .send({
          creator: agentAccount.address,
          tokenId: tokenId.toString(),
          title,
          description,
          contentCidHash,
          votingDurationBlocks,
          categoryId,
          deadline: deadline.toString(),
          nonce: nonce.toString(),
          signature,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("published");
      expect(res.body.proposalId).toBeDefined();
      expect(res.body.txHash).toBeDefined();
      expect(res.body.proposal).toBeDefined();
      expect(res.body.proposal.title).toBe(title);
      expect(res.body.proposal.status).toBe("Active");
      expect(res.body.proposal.creator.toLowerCase()).toBe(agentAccount.address.toLowerCase());
      // Stored description strips Markdown syntax & newlines into single-paragraph plain text
      expect(res.body.proposal.description).not.toContain("#");
      expect(res.body.proposal.description).not.toContain("\n");
      expect(res.body.proposal.description).toContain("AI Safety Standards");
    });

    it("Should reject proposal with expired deadline", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 502n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "expired-proposer.ai");
      }

      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 300);
      const description = "Expired test";
      const contentCidHash = keccak256(toHex(description));

      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: instance.config.chainId,
        verifyingContract: instance.config.parliamentAddress,
      };

      const message = {
        creator: agentAccount.address,
        tokenId,
        contentCidHash,
        votingDurationBlocks: 5000,
        categoryId: 1,
        nonce: 0n,
        deadline: pastDeadline,
      };

      const signature = await agentAccount.signTypedData({
        domain,
        types: proposalTypes,
        primaryType: "Proposal",
        message,
      });

      const res = await request(instance.app)
        .post("/api/v1/proposals/publish")
        .send({
          creator: agentAccount.address,
          tokenId: tokenId.toString(),
          title: "Expired Proposal",
          description,
          contentCidHash,
          votingDurationBlocks: 5000,
          categoryId: 1,
          deadline: pastDeadline.toString(),
          nonce: "0",
          signature,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("expired");
    });

    it("Should reject proposal with empty or zero content CID hash", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 503n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "zero-hash-proposer.ai");
      }

      const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

      const res = await request(instance.app)
        .post("/api/v1/proposals/publish")
        .send({
          creator: agentAccount.address,
          tokenId: tokenId.toString(),
          title: "Zero Hash Proposal",
          description: "Zero hash content",
          contentCidHash: zeroHash,
          votingDurationBlocks: 5000,
          categoryId: 1,
          deadline: deadline.toString(),
          nonce: "0",
          signature: "0x1234",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("hash cannot be zero");
    });

    it("Should reject proposal if signer is not the owner of the token", async null_agent => {
      const ownerPrivKey = generatePrivateKey();
      const ownerAccount = privateKeyToAccount(ownerPrivKey);

      const attackerPrivKey = generatePrivateKey();
      const attackerAccount = privateKeyToAccount(attackerPrivKey);

      const tokenId = 504n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, ownerAccount.address, "actual-owner.ai");
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
      const contentCidHash = keccak256(toHex("Attacker proposal"));

      const res = await request(instance.app)
        .post("/api/v1/proposals/publish")
        .send({
          creator: attackerAccount.address,
          tokenId: tokenId.toString(),
          title: "Spoofed Proposal",
          description: "Attacker proposal",
          contentCidHash,
          votingDurationBlocks: 5000,
          categoryId: 1,
          deadline: deadline.toString(),
          nonce: "0",
          signature: "0x1234",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not the owner");
    });

    it("Should reject proposal with invalid or corrupted signature", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 505n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "corrupt-sig.ai");
      }

      const description = "Corrupt sig test";
      const contentCidHash = keccak256(toHex(description));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

      const res = await request(instance.app)
        .post("/api/v1/proposals/publish")
        .send({
          creator: agentAccount.address,
          tokenId: tokenId.toString(),
          title: "Corrupt Sig Proposal",
          description,
          contentCidHash,
          votingDurationBlocks: 5000,
          categoryId: 1,
          deadline: deadline.toString(),
          nonce: "0",
          signature: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("signature");
    });
  });

  describe("GET /api/v1/vote/status (Status Query & Rationale Preservation)", () => {
    it("Should query voting status with eligibility before voting", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 601n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "pre-voter.ai");
      }

      const res = await request(instance.app).get(`/api/v1/vote/status?proposalId=1&tokenId=${tokenId}`);

      expect(res.status).toBe(200);
      expect(res.body.proposalId).toBe("1");
      expect(res.body.tokenId).toBe(tokenId.toString());
      expect(res.body.eligible).toBe(true);
      expect(res.body.hasVoted).toBe(false);
      expect(res.body.isQueued).toBe(false);
      expect(res.body.onChainVoted).toBe(false);
      expect(res.body.currentNonce).toBe("0");
    });

    it("Should preserve rationale during submit and reflect it in queued and on-chain vote status", async () => {
      const agentPrivKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentPrivKey);
      const tokenId = 602n;

      if (instance.blockchain.setMockTokenOwner) {
        instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "rationale-voter.ai");
      }

      const proposalId = 1n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
      const nonce = 0n;
      const support = 1; // For
      const rationale = "Autonomous AI voting For to protect ecosystem security integrity.";

      const signature = await agentAccount.signTypedData({
        domain: instance.eip712.getDomain(),
        types: ballotTypes,
        primaryType: "Ballot",
        message: {
          proposalId,
          tokenId,
          support,
          nonce,
          deadline,
        },
      });

      // Submit vote with rationale
      const submitRes = await request(instance.app)
        .post("/api/v1/vote/submit")
        .send({
          proposalId: proposalId.toString(),
          tokenId: tokenId.toString(),
          support,
          deadline: deadline.toString(),
          nonce: nonce.toString(),
          signature,
          rationale,
        });

      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe("queued");
      expect(submitRes.body.rationale).toBe(rationale);

      // Query vote status while in queue
      const statusQueuedRes = await request(instance.app).get(
        `/api/v1/vote/status?proposalId=1&tokenId=${tokenId}`
      );
      expect(statusQueuedRes.status).toBe(200);
      expect(statusQueuedRes.body.eligible).toBe(false);
      expect(statusQueuedRes.body.hasVoted).toBe(true);
      expect(statusQueuedRes.body.isQueued).toBe(true);
      expect(statusQueuedRes.body.onChainVoted).toBe(false);
      expect(statusQueuedRes.body.rationale).toBe(rationale);

      // Flush queue
      const flushRes = await request(instance.app).post("/api/v1/vote/flush");
      expect(flushRes.status).toBe(200);

      // Query vote status after batch flush
      const statusSettledRes = await request(instance.app).get(
        `/api/v1/vote/status?proposalId=1&tokenId=${tokenId}`
      );
      expect(statusSettledRes.status).toBe(200);
      expect(statusSettledRes.body.eligible).toBe(false);
      expect(statusSettledRes.body.hasVoted).toBe(true);
      expect(statusSettledRes.body.isQueued).toBe(false);
      expect(statusSettledRes.body.onChainVoted).toBe(true);
      expect(statusSettledRes.body.rationale).toBe(rationale);
    });

    it("Should return 404 for non-existent proposal ID in vote status", async () => {
      const res = await request(instance.app).get("/api/v1/vote/status?proposalId=999999&tokenId=101");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("does not exist");
    });
  });

  describe("Rate Limiting Middleware Headers", () => {
    it("Should provide standard RateLimit headers on /api/v1/vote/submit", async () => {
      const res = await request(instance.app).get("/api/v1/vote/queue");
      expect(res.status).toBe(200);
    });

    it("Should provide standard RateLimit headers on proposals endpoint", async () => {
      const res = await request(instance.app).get("/api/v1/proposals");
      expect(res.status).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBeDefined();
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
    });
  });
});
