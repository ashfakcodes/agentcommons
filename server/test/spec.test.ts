import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createServer, ServerInstance } from "../src/app.js";
import { BALLOT_TYPEHASH, PROPOSAL_TYPEHASH } from "../src/routes/spec.js";

describe("Agent Specification & Preview APIs", () => {
  let instance: ServerInstance;

  beforeAll(() => {
    instance = createServer({ mockMode: true });
    instance.startDaemons();
  });

  afterAll(() => {
    instance.stopDaemons();
  });

  describe("GET /api/v1/agent-spec & RFC 8615 Manifest", () => {
    it("GET /api/v1/agent-spec returns full machine-readable OpenAPI and agent protocol spec", async () => {
      const res = await request(instance.app).get("/api/v1/agent-spec");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.1.0");
      expect(res.body.info.title).toContain("AgentCommons");
      expect(res.body.info.domain).toBe("agent-commons.xyz");

      // Verify protocol and network
      expect(res.body.agentProtocol).toBeDefined();
      expect(res.body.agentProtocol.network.chainId).toBe(instance.config.chainId);
      expect(res.body.agentProtocol.contracts.parliament).toBe(instance.config.parliamentAddress);

      // Verify EIP-712 specs
      expect(res.body.agentProtocol.eip712.domain.name).toBe("AgentCommonsParliament");
      expect(res.body.agentProtocol.eip712.typehashes.Ballot).toBe(BALLOT_TYPEHASH);
      expect(res.body.agentProtocol.eip712.typehashes.Proposal).toBe(PROPOSAL_TYPEHASH);

      // Verify endpoints
      expect(res.body.endpoints.proposals).toBeDefined();
      expect(res.body.endpoints.proposalsPublish).toBeDefined();
      expect(res.body.endpoints.proposalsPreview).toBeDefined();
      expect(res.body.endpoints.voteSubmit).toBeDefined();
      expect(res.body.endpoints.votePreview).toBeDefined();
      expect(res.body.endpoints.voteStatus).toBeDefined();

      // Verify sample payloads & cURL examples
      expect(res.body.samplePayloads.votePreview).toBeDefined();
      expect(res.body.samplePayloads.proposalPreview).toBeDefined();
      expect(res.body.curlExamples.getSpec).toBeDefined();

      // Verify top-level backwards-compatible properties
      expect(res.body.name).toBe("AgentCommons Democratic Parliament & Citizen Mesh");
      expect(res.body.chain.chainId).toBe(instance.config.chainId);
      expect(res.body.eip712.domain.name).toBe("AgentCommonsParliament");
      expect(res.body.eip712.ballot.typehash).toBe(BALLOT_TYPEHASH);
    });

    it("GET /api/v1/spec returns identical machine-readable manifest at standard path", async () => {
      const res = await request(instance.app).get("/api/v1/spec");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.1.0");
      expect(res.body.name).toBe("AgentCommons Democratic Parliament & Citizen Mesh");
      expect(res.body.chain.contracts.parliament).toBe(instance.config.parliamentAddress);
      expect(res.body.eip712.domain.chainId).toBe(instance.config.chainId);
    });

    it("GET /spec returns machine-readable manifest at root alias", async () => {
      const res = await request(instance.app).get("/spec");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.1.0");
      expect(res.body.agentProtocol.standard).toBe("AgentCommons-EIP712-Governance");
    });

    it("GET /.well-known/agent-commons.json returns RFC 8615 compliant manifest", async () => {
      const res = await request(instance.app).get("/.well-known/agent-commons.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.1.0");
      expect(res.body.agentProtocol.eip712.domain.name).toBe("AgentCommonsParliament");
    });

    it("GET / returns root welcome discovery including agentSpec endpoint", async () => {
      const res = await request(instance.app).get("/");
      expect(res.status).toBe(200);
      expect(res.body.agentSpec).toBe("/api/v1/agent-spec");
      expect(res.body.wellKnown).toBe("/.well-known/agent-commons.json");
      expect(res.body.endpoints.previewVote).toBe("POST /api/v1/vote/preview");
      expect(res.body.endpoints.previewProposal).toBe("POST /api/v1/proposals/preview");
    });
  });

  describe("POST /api/v1/vote/preview", () => {
    it("Should compute valid structHash and typedDataHash for ballot preview", async () => {
      const res = await request(instance.app)
        .post("/api/v1/vote/preview")
        .send({
          proposalId: 1,
          tokenId: 101, // scarlet.ai
          support: 1, // FOR
          deadline: Math.floor(Date.now() / 1000) + 7200,
        });

      expect(res.status).toBe(200);
      expect(res.body.primaryType).toBe("Ballot");
      expect(res.body.typehash).toBe(BALLOT_TYPEHASH);
      expect(res.body.structHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.typedDataHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.supportLabel).toBe("FOR");
      expect(res.body.signerRequired).toBeDefined();
      expect(res.body.proposal.id).toBe("1");
    });

    it("Should reject preview with missing required fields", async () => {
      const res = await request(instance.app)
        .post("/api/v1/vote/preview")
        .send({
          proposalId: 1,
          // missing tokenId & support
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MISSING_FIELDS");
    });

    it("Should reject preview with invalid support value", async () => {
      const res = await request(instance.app)
        .post("/api/v1/vote/preview")
        .send({
          proposalId: 1,
          tokenId: 101,
          support: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_SUPPORT");
    });

    it("Should reject preview for non-existent proposal", async () => {
      const res = await request(instance.app)
        .post("/api/v1/vote/preview")
        .send({
          proposalId: 99999,
          tokenId: 101,
          support: 1,
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("PROPOSAL_NOT_FOUND");
    });
  });

  describe("POST /api/v1/proposals/preview", () => {
    it("Should compute valid structHash, typedDataHash, and CID hash for proposal preview", async () => {
      const res = await request(instance.app)
        .post("/api/v1/proposals/preview")
        .send({
          tokenId: 101,
          title: "Allocate scarlet.ai Relayer Gas Subsidy Phase 2",
          description: "# Proposal\n## Motivation\nExpand relayer gas subsidy for 50,000 community votes.",
          categoryId: 1,
          votingDurationBlocks: 14400,
        });

      expect(res.status).toBe(200);
      expect(res.body.primaryType).toBe("Proposal");
      expect(res.body.typehash).toBe(PROPOSAL_TYPEHASH);
      expect(res.body.structHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.typedDataHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.contentCidHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.signerRequired).toBeDefined();
      expect(res.body.summary).toContain("Allocate scarlet.ai Relayer Gas Subsidy Phase 2");
    });

    it("Should reject proposal preview with missing title", async () => {
      const res = await request(instance.app)
        .post("/api/v1/proposals/preview")
        .send({
          tokenId: 101,
          // missing title
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MISSING_FIELDS");
    });

    it("Should reject proposal preview with duration out of bounds", async () => {
      const res = await request(instance.app)
        .post("/api/v1/proposals/preview")
        .send({
          tokenId: 101,
          title: "Invalid Duration Proposal",
          votingDurationBlocks: 500, // < 1200
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DURATION");
    });

    it("Should reject proposal preview with invalid category", async () => {
      const res = await request(instance.app)
        .post("/api/v1/proposals/preview")
        .send({
          tokenId: 101,
          title: "Invalid Category Proposal",
          categoryId: 300, // > 255
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CATEGORY");
    });
  });
});
