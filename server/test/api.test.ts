import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { decodeFunctionData } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createServer, ServerInstance } from "../src/app.js";
import { config as defaultConfig } from "../src/config.js";
import { MeshAbi } from "../src/abi/mesh.js";
import { createMeshRouter } from "../src/routes/mesh.js";
import { MockBlockchainClient } from "../src/services/blockchain.js";
import { ballotTypes } from "../src/services/eip712.js";

describe("AgentCommons Relayer REST API", () => {
  let instance: ServerInstance;

  beforeAll(() => {
    instance = createServer({ mockMode: true });
    instance.startDaemons();
  });

  afterAll(() => {
    instance.stopDaemons();
  });

  it("GET / returns welcome metadata and endpoints", async () => {
    const res = await request(instance.app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.name).toContain("AgentCommons");
    expect(res.body.anchorAgent).toBe("scarlet.ai");
    expect(res.body.endpoints).toBeDefined();
  });

  it("GET /api/v1/health returns health status and scarlet identity", async () => {
    const res = await request(instance.app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("scarlet.ai-relayer");
    expect(res.body.mockMode).toBe(true);
    expect(res.body.scarletTokenId).toBe(instance.config.scarletTokenId.toString());
    expect(res.body.scarletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(res.body.contracts).toBeDefined();
    expect(res.body.stats).toBeDefined();
  });

  it("GET /api/v1/proposals returns seeded proposals", async () => {
    const res = await request(instance.app).get("/api/v1/proposals");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(res.body.proposals)).toBe(true);
    expect(res.body.proposals[0].title).toContain("Genesis Signal");
  });

  it("GET /api/v1/proposals/:id returns single proposal details", async () => {
    const res = await request(instance.app).get("/api/v1/proposals/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("1");
    expect(res.body.status).toBe("Active");
    expect(res.body.totalVotes).toBeGreaterThan(0);
  });

  it("GET /api/v1/mesh/nodes returns active Agent ID nodes", async () => {
    const res = await request(instance.app).get("/api/v1/mesh/nodes");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(30); // 50 mock nodes + scarlet.ai
    const nodes = res.body.nodes;
    const scarletNode = nodes.find((n: any) => n.tokenId === "101");
    expect(scarletNode).toBeDefined();
    expect(scarletNode.name).toBe("scarlet.ai");
  });

  it("GET /api/v1/mesh/topology returns unified nodes, edges and metrics", async () => {
    const res = await request(instance.app).get("/api/v1/mesh/topology");
    expect(res.status).toBe(200);
    expect(res.body.totalNodes).toBeGreaterThan(30);
    expect(res.body.totalEdges).toBeGreaterThan(0);
    expect(res.body.mutualConnections).toBeGreaterThan(0);
  });

  it("POST /api/v1/vote/submit accepts valid EIP-712 ballot, queues, and flushes", async () => {
    // Setup a known mock agent wallet
    const agentPrivKey = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPrivKey);
    const tokenId = 30n;

    // Register this account as the owner of token 30 in mock blockchain
    if (instance.blockchain.setMockTokenOwner) {
      instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "test-voter.ai");
    }

    const proposalId = 1n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const nonce = 0n;
    const support = 1; // For

    // Sign the ballot using EIP-712
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

    // 1. Submit ballot to relayer REST endpoint
    const submitRes = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: proposalId.toString(),
        tokenId: tokenId.toString(),
        support,
        deadline: deadline.toString(),
        nonce: nonce.toString(),
        signature,
      });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.status).toBe("queued");
    expect(submitRes.body.tokenId).toBe(tokenId.toString());
    expect(submitRes.body.signer.toLowerCase()).toBe(agentAccount.address.toLowerCase());

    // 2. Verify vote is in queue
    const queueRes = await request(instance.app).get("/api/v1/vote/queue");
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.count).toBeGreaterThanOrEqual(1);

    // 3. Trigger batch flush
    const flushRes = await request(instance.app).post("/api/v1/vote/flush");
    expect(flushRes.status).toBe(200);
    expect(flushRes.body.status).toBe("flushed");
    expect(flushRes.body.batchesProcessed).toBeGreaterThanOrEqual(1);
    expect(flushRes.body.results[0].successfulVotes).toBeGreaterThanOrEqual(1);

    // 4. Confirm queue is now drained
    const queueResAfter = await request(instance.app).get("/api/v1/vote/queue");
    expect(queueResAfter.body.count).toBe(0);
  });

  it("POST /api/v1/vote/submit rejects duplicate ballot submission", async () => {
    const agentPrivKey = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPrivKey);
    const tokenId = 31n;

    if (instance.blockchain.setMockTokenOwner) {
      instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "duplicate-test.ai");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const signature = await agentAccount.signTypedData({
      domain: instance.eip712.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: {
        proposalId: 1n,
        tokenId,
        support: 1,
        nonce: 0n,
        deadline,
      },
    });

    // First submission
    const res1 = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "1",
        tokenId: tokenId.toString(),
        support: 1,
        deadline: deadline.toString(),
        nonce: "0",
        signature,
      });
    expect(res1.status).toBe(201);

    // Duplicate submission (same ballot)
    const res2 = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "1",
        tokenId: tokenId.toString(),
        support: 1,
        deadline: deadline.toString(),
        nonce: "0",
        signature,
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toContain("already pending");
  });

  it("POST /api/v1/vote/submit requires sequential nonce when token already has queued ballot", async () => {
    const agentPrivKey = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPrivKey);
    const tokenId = 32n;

    if (instance.blockchain.setMockTokenOwner) {
      instance.blockchain.setMockTokenOwner(tokenId, agentAccount.address, "seq-nonce.ai");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const sig0 = await agentAccount.signTypedData({
      domain: instance.eip712.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: { proposalId: 1n, tokenId, support: 1, nonce: 0n, deadline },
    });

    const first = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "1",
        tokenId: tokenId.toString(),
        support: 1,
        deadline: deadline.toString(),
        nonce: "0",
        signature: sig0,
      });
    expect(first.status).toBe(201);

    // Reusing nonce 0 on proposal 2 while proposal 1 is queued must be rejected
    const reusedSig = await agentAccount.signTypedData({
      domain: instance.eip712.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: { proposalId: 2n, tokenId, support: 1, nonce: 0n, deadline },
    });
    const staleRes = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "2",
        tokenId: tokenId.toString(),
        support: 1,
        deadline: deadline.toString(),
        nonce: "0",
        signature: reusedSig,
      });
    expect(staleRes.status).toBe(400);
    expect(staleRes.body.code).toBe("STALE_NONCE");
    expect(staleRes.body.expectedNonce).toBe("1");

    // Sequential nonce 1 should succeed
    const sig1 = await agentAccount.signTypedData({
      domain: instance.eip712.getDomain(),
      types: ballotTypes,
      primaryType: "Ballot",
      message: { proposalId: 2n, tokenId, support: 1, nonce: 1n, deadline },
    });
    const second = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "2",
        tokenId: tokenId.toString(),
        support: 1,
        deadline: deadline.toString(),
        nonce: "1",
        signature: sig1,
      });
    expect(second.status).toBe(201);
  });

  it("POST /api/v1/mesh/ping emits ping and triggers reciprocal handshake", async () => {
    const res = await request(instance.app)
      .post("/api/v1/mesh/ping")
      .send({
        fromTokenId: "40",
        toTokenId: instance.config.scarletTokenId.toString(),
        capabilities: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("simulated_ping_emitted");

    // Allow daemon to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(instance.handshakeDaemon.stats.totalHandshakesReciprocated).toBeGreaterThanOrEqual(1);
  });

  describe("POST /api/v1/mesh/ping live-mode pre-flight guards", () => {
    function createLiveMeshTestApp() {
      const mockClient = new MockBlockchainClient(defaultConfig);
      // Expose live-mode routing branch on createMeshRouter while keeping deterministic mock state
      const liveLikeClient = Object.create(mockClient) as MockBlockchainClient & {
        isMock: boolean;
      };
      Object.defineProperty(liveLikeClient, "isMock", { value: false });

      const app = express();
      app.use(express.json());
      app.use("/api/v1/mesh", createMeshRouter(defaultConfig, liveLikeClient));
      return { app, mockClient };
    }

    it("rejects self-handshake with 400 SELF_HANDSHAKE_FORBIDDEN", async () => {
      const { app } = createLiveMeshTestApp();
      const res = await request(app)
        .post("/api/v1/mesh/ping")
        .send({ fromTokenId: "40", toTokenId: "40", capabilities: 31 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SELF_HANDSHAKE_FORBIDDEN");
    });

    it("returns 403 DIRECT_TX_REQUIRED with valid ping() and setMeshOperator() calldata for un-delegated external agent", async () => {
      const { app } = createLiveMeshTestApp();
      const scarletId = defaultConfig.scarletTokenId.toString();

      const res = await request(app)
        .post("/api/v1/mesh/ping")
        .send({ fromTokenId: "40", toTokenId: scarletId, capabilities: 31 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DIRECT_TX_REQUIRED");
      expect(res.body.meshContract).toBe(defaultConfig.meshAddress);
      expect(res.body.chainId).toBe(defaultConfig.chainId);

      const decodedPing = decodeFunctionData({
        abi: MeshAbi,
        data: res.body.directTransaction.data,
      });
      expect(decodedPing.functionName).toBe("ping");
      expect(decodedPing.args).toEqual([40n, defaultConfig.scarletTokenId, 31]);

      const decodedOp = decodeFunctionData({
        abi: MeshAbi,
        data: res.body.optionalDelegationTransaction.data,
      });
      expect(decodedOp.functionName).toBe("setMeshOperator");
      expect(decodedOp.args?.[0]).toBe(40n);
      expect((decodedOp.args?.[1] as string).toLowerCase()).toBe(
        res.body.relayerAddress.toLowerCase()
      );
    });

    it("broadcasts ping when external agent has delegated meshOperator to relayer", async () => {
      const { app, mockClient } = createLiveMeshTestApp();
      mockClient.setMockMeshOperator(41n, mockClient.getAccountAddress());

      const res = await request(app)
        .post("/api/v1/mesh/ping")
        .send({
          fromTokenId: "41",
          toTokenId: defaultConfig.scarletTokenId.toString(),
          capabilities: 31,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ping_broadcast");
      expect(res.body.txHash).toMatch(/^0x/);

      // Second ping while first is pending should be blocked cleanly with 409
      const dupRes = await request(app)
        .post("/api/v1/mesh/ping")
        .send({
          fromTokenId: "41",
          toTokenId: defaultConfig.scarletTokenId.toString(),
          capabilities: 31,
        });
      expect(dupRes.status).toBe(409);
      expect(dupRes.body.code).toBe("PING_ALREADY_PENDING");
    });

    it("returns 409 ALREADY_MUTUALLY_CONNECTED when edge is already mutual", async () => {
      const { app } = createLiveMeshTestApp();
      const res = await request(app)
        .post("/api/v1/mesh/ping")
        .send({
          fromTokenId: "1",
          toTokenId: defaultConfig.scarletTokenId.toString(),
          capabilities: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ALREADY_MUTUALLY_CONNECTED");
    });
  });
});
