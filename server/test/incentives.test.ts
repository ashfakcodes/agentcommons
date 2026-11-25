import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "../src/app.js";
import { config as baseConfig } from "../src/config.js";
import { MockBlockchainClient } from "../src/services/blockchain.js";
import { BnbPriceService } from "../src/services/incentives/priceService.js";
import { IncentiveService } from "../src/services/incentives/incentiveService.js";

describe("User Incentive Program Module", () => {
  let serverInstance: ReturnType<typeof createServer>;
  let mockClient: MockBlockchainClient;

  const testUserAddress = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  const testTokenId = 102n;

  beforeEach(() => {
    serverInstance = createServer({
      mockMode: true,
      incentiveEnabled: true,
      incentiveMaxUsers: 2,
      incentiveRewardUsd: 0.15,
      incentiveFallbackBnbPrice: 600,
      incentiveLedgerPath: "", // in-memory
    });
    mockClient = serverInstance.blockchain as MockBlockchainClient;
  });

  describe("BnbPriceService", () => {
    it("should return fallback price when external API is unreachable", async () => {
      const priceService = new BnbPriceService(650);
      const price = await priceService.getBnbPriceUsd();
      expect(price).toBeGreaterThan(0);
    });
  });

  describe("Eligibility Verification & Claim Lifecycle", () => {
    it("should reject claim when agent is not owned by address", async () => {
      const incentiveService = serverInstance.incentiveService!;
      const result = await incentiveService.claimReward(
        "0x9999999999999999999999999999999999999999" as `0x${string}`,
        999n
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain("Agent ID must be owned");
    });

    it("should reject claim when user has not voted on enough active proposals", async () => {
      const incentiveService = serverInstance.incentiveService!;
      // Register agent
      mockClient.setMockTokenOwner(testTokenId, testUserAddress, "alice.ai");

      const result = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Must vote on at least");
    });

    it("should grant reward when user votes selectively on 3 of 5 active proposals and authors one", async () => {
      const incentiveService = serverInstance.incentiveService!;
      mockClient.setMockTokenOwner(testTokenId, testUserAddress, "alice.ai");

      // Create 2 extra active proposals so total active = 5
      await mockClient.createMockProposal("Extra Motion 4", "Plain text body 4", 0);
      await mockClient.createMockProposal("Extra Motion 5", "Plain text body 5", 1);

      // Vote on only 3 of 5 active proposals (with varied FOR/AGAINST choices)
      const proposals = await mockClient.getAllProposals();
      expect(proposals.length).toBeGreaterThanOrEqual(5);
      const supports = [1, 0, 2];
      for (let i = 0; i < 3; i++) {
        await mockClient.castVotesBatch(
          BigInt(proposals[i].id),
          [testTokenId],
          [supports[i]],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          [`0x${i + 1}` as `0x${string}`]
        );
      }

      const pNonce = await mockClient.getNonces(testTokenId);
      await mockClient.createProposalBySig(
        testUserAddress,
        testTokenId,
        "0x4444222233334444555566667777888899990000111122223333444455556666" as `0x${string}`,
        28800,
        0,
        pNonce,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0xabcdef" as `0x${string}`,
        "Alice's Selective Proposal",
        "Concise plain text motion without formatting."
      );

      const result = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(result.success).toBe(true);
    });

    it("should reject claim when user has voted but not authored an independent proposal", async () => {
      const incentiveService = serverInstance.incentiveService!;
      mockClient.setMockTokenOwner(testTokenId, testUserAddress, "alice.ai");

      // Vote on all active proposals
      const proposals = await mockClient.getAllProposals();
      for (const p of proposals) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [testTokenId],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x1111" as `0x${string}`]
        );
      }

      const result = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Must successfully create and place an independent proposal");
    });

    it("should grant reward when all 3 criteria are satisfied", async () => {
      const incentiveService = serverInstance.incentiveService!;
      mockClient.setMockTokenOwner(testTokenId, testUserAddress, "alice.ai");

      // 1. Vote on all active proposals
      const proposals = await mockClient.getAllProposals();
      for (const p of proposals) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [testTokenId],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x1111" as `0x${string}`]
        );
      }

      // 2. Author an independent proposal
      const pNonce = await mockClient.getNonces(testTokenId);
      await mockClient.createProposalBySig(
        testUserAddress,
        testTokenId,
        "0x1111222233334444555566667777888899990000111122223333444455556666" as `0x${string}`,
        28800,
        0,
        pNonce,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0xabcdef" as `0x${string}`,
        "Alice's Independent Proposal",
        "Community governance motion authored by Alice"
      );

      // 3. Claim reward
      const result = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(result.success).toBe(true);
      expect(result.claimRecord).toBeDefined();
      expect(result.claimRecord?.address).toBe(testUserAddress.toLowerCase());
      expect(result.claimRecord?.tokenId).toBe(testTokenId.toString());
      expect(result.claimRecord?.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it("should prevent double claiming by the same address or token", async () => {
      const incentiveService = serverInstance.incentiveService!;
      mockClient.setMockTokenOwner(testTokenId, testUserAddress, "alice.ai");

      const proposals = await mockClient.getAllProposals();
      for (const p of proposals) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [testTokenId],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x1111" as `0x${string}`]
        );
      }

      const pNonce = await mockClient.getNonces(testTokenId);
      await mockClient.createProposalBySig(
        testUserAddress,
        testTokenId,
        "0x1111222233334444555566667777888899990000111122223333444455556666" as `0x${string}`,
        28800,
        0,
        pNonce,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0xabcdef" as `0x${string}`,
        "Alice's Independent Proposal",
        "Community governance motion authored by Alice"
      );

      const firstClaim = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(firstClaim.success).toBe(true);

      const secondClaim = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(secondClaim.success).toBe(false);
      expect(secondClaim.message).toContain("already claimed");

      // Extra contributions (more proposals + more votes) or transferring token to a new wallet still blocks repeat claim
      const extraNonce = await mockClient.getNonces(testTokenId);
      const extraProp = await mockClient.createProposalBySig(
        testUserAddress,
        testTokenId,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
        28800,
        1,
        extraNonce,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0xabcdef" as `0x${string}`,
        "Alice's Second Motion",
        "Follow up governance improvement proposal"
      );
      await mockClient.castVotesBatch(
        extraProp.proposalId,
        [testTokenId],
        [1],
        [BigInt(Math.floor(Date.now() / 1000) + 3600)],
        ["0x9999" as `0x${string}`]
      );

      const repeatAfterMoreContrib = await incentiveService.claimReward(testUserAddress, testTokenId);
      expect(repeatAfterMoreContrib.success).toBe(false);

      // Even if same tokenId is transferred to another wallet, token ID stays one-time locked
      const newOwner = "0x8888888888888888888888888888888888888888" as `0x${string}`;
      mockClient.setMockTokenOwner(testTokenId, newOwner, "alice.ai");
      const transferredClaim = await incentiveService.claimReward(newOwner, testTokenId);
      expect(transferredClaim.success).toBe(false);
      expect(transferredClaim.message).toContain("Token ID has already been rewarded");
    });

    it("should reject genesis/relayer node self-claims, non-.ai identities, and authorship-only without votes", async () => {
      const incentiveService = serverInstance.incentiveService!;

      // 1. Genesis node / relayer owner must be blocked even if authoring proposals
      const genesisClaim = await incentiveService.claimReward(
        mockClient.getAccountAddress(),
        serverInstance.config.scarletTokenId
      );
      expect(genesisClaim.success).toBe(false);
      expect(genesisClaim.message).toContain("Genesis node is excluded");

      // 2. Non-.ai domain identity must be blocked
      const nonAiAddr = "0x4444444444444444444444444444444444444444" as `0x${string}`;
      mockClient.setMockTokenOwner(500n, nonAiAddr, "human-wallet.eth");
      const nonAiStatus = await incentiveService.getStatus(nonAiAddr, 500n);
      expect(nonAiStatus.criteria.agentConnected).toBe(false);
      const nonAiClaim = await incentiveService.claimReward(nonAiAddr, 500n);
      expect(nonAiClaim.success).toBe(false);
      expect(nonAiClaim.message).toContain(".ai agents");

      // 3. Authoring 3 proposals WITHOUT casting real votes must NOT satisfy vote threshold
      const proposerOnlyAddr = "0x5555555555555555555555555555555555555555" as `0x${string}`;
      mockClient.setMockTokenOwner(501n, proposerOnlyAddr, "spammer.ai");
      for (let i = 0; i < 3; i++) {
        const nonce = await mockClient.getNonces(501n);
        await mockClient.createProposalBySig(
          proposerOnlyAddr,
          501n,
          `0x${String(i + 1).repeat(64)}` as `0x${string}`,
          28800,
          0,
          nonce,
          BigInt(Math.floor(Date.now() / 1000) + 3600),
          "0x1234" as `0x${string}`,
          `Authored Only ${i + 1}`,
          "Testing that authorship never counts as casting a vote."
        );
      }
      const authorOnlyStatus = await incentiveService.getStatus(proposerOnlyAddr, 501n);
      expect(authorOnlyStatus.criteria.hasAuthoredProposal).toBe(true);
      expect(authorOnlyStatus.criteria.activeProposalsVoted).toBe(0);
      expect(authorOnlyStatus.criteria.allActiveProposalsVoted).toBe(false);
      expect(authorOnlyStatus.criteria.isEligible).toBe(false);
    });

    it("should enforce the maximum users cap", async () => {
      const incentiveService = serverInstance.incentiveService!;

      // User 1
      mockClient.setMockTokenOwner(102n, testUserAddress, "alice.ai");
      for (const p of await mockClient.getAllProposals()) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [102n],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x1" as `0x${string}`]
        );
      }
      const nonce1 = await mockClient.getNonces(102n);
      await mockClient.createProposalBySig(
        testUserAddress,
        102n,
        "0x1111222233334444555566667777888899990000111122223333444455556666" as `0x${string}`,
        28800,
        0,
        nonce1,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0x1" as `0x${string}`,
        "Proposal 1",
        "Desc 1"
      );
      const claim1 = await incentiveService.claimReward(testUserAddress, 102n);
      expect(claim1.success).toBe(true);

      // User 2
      const user2 = "0x2222222222222222222222222222222222222222" as `0x${string}`;
      mockClient.setMockTokenOwner(103n, user2, "bob.ai");
      for (const p of await mockClient.getAllProposals()) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [103n],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x2" as `0x${string}`]
        );
      }
      const nonce2 = await mockClient.getNonces(103n);
      await mockClient.createProposalBySig(
        user2,
        103n,
        "0x2222333344445555666677778888999900001111222233334444555566667777" as `0x${string}`,
        28800,
        0,
        nonce2,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0x2" as `0x${string}`,
        "Proposal 2",
        "Desc 2"
      );
      const claim2 = await incentiveService.claimReward(user2, 103n);
      expect(claim2.success).toBe(true);

      // User 3 - Should exceed maxUsers=2
      const user3 = "0x3333333333333333333333333333333333333333" as `0x${string}`;
      mockClient.setMockTokenOwner(104n, user3, "charlie.ai");
      for (const p of await mockClient.getAllProposals()) {
        await mockClient.castVotesBatch(
          BigInt(p.id),
          [104n],
          [1],
          [BigInt(Math.floor(Date.now() / 1000) + 3600)],
          ["0x3" as `0x${string}`]
        );
      }
      const nonce3 = await mockClient.getNonces(104n);
      await mockClient.createProposalBySig(
        user3,
        104n,
        "0x3333444455556666777788889999000011112222333344445555666677778888" as `0x${string}`,
        28800,
        0,
        nonce3,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
        "0x3" as `0x${string}`,
        "Proposal 3",
        "Desc 3"
      );
      const claim3 = await incentiveService.claimReward(user3, 104n);
      expect(claim3.success).toBe(false);
      expect(claim3.message).toContain("quota reached");
      expect(claim3.message).toContain("first 2 users fulfilled");
    });

    it("should configure default server incentive cap to 42 slots", () => {
      expect(baseConfig.incentiveMaxUsers).toBe(42);
    });
  });

  describe("HTTP API Endpoints", () => {
    it("GET /api/v1/incentives/status should return global program metrics", async () => {
      const res = await request(serverInstance.app).get("/api/v1/incentives/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.maxSlots).toBe(2);
      expect(res.body.remainingSlots).toBe(2);
      expect(res.body.rewardUsd).toBe(0.15);
      expect(res.body.bnbPriceUsd).toBeGreaterThan(0);
    });

    it("POST /api/v1/incentives/claim should validate input parameters", async () => {
      const res = await request(serverInstance.app)
        .post("/api/v1/incentives/claim")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing required fields");
    });
  });
});
