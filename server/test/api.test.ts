import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createServer, ServerInstance } from "../src/app.js";
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
});
