import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createServer, ServerInstance } from "../src/app.js";
import { createRateLimiter } from "../src/middleware/security.js";
import express, { Express } from "express";

describe("Security Middleware & Rate Limiting", () => {
  let instance: ServerInstance;

  beforeAll(() => {
    instance = createServer({ mockMode: true });
    instance.startDaemons();
  });

  afterAll(() => {
    instance.stopDaemons();
  });

  it("Should set security headers on HTTP responses", async () => {
    const res = await request(instance.app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("Should include RateLimit headers on rate-limited endpoints", async () => {
    const res = await request(instance.app).get("/api/v1/proposals");
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
    expect(res.headers["ratelimit-reset"]).toBeDefined();
  });

  it("Should enforce rate limiting and return 429 when limit is reached", async () => {
    const testApp: Express = express();
    const limiter = createRateLimiter({
      windowMs: 5000,
      max: 3,
      message: "Rate limit reached in test",
    });

    testApp.use("/test-limit", limiter);
    testApp.get("/test-limit", (_req, res) => {
      res.json({ ok: true });
    });

    // Requests 1-3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(testApp).get("/test-limit");
      expect(res.status).toBe(200);
    }

    // Request 4 should be rate-limited with 429
    const blockedRes = await request(testApp).get("/test-limit");
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toBe("Rate limit reached in test");
    expect(blockedRes.headers["retry-after"]).toBeDefined();

    // Resetting limiter should allow requests again
    limiter.reset();
    const allowedRes = await request(testApp).get("/test-limit");
    expect(allowedRes.status).toBe(200);
  });

  it("Should strip prototype pollution keys and null bytes from request payloads", async () => {
    const maliciousPayload = JSON.parse(
      '{"title": "Proposal with null\\u0000byte", "__proto__": {"admin": true}, "nested": {"constructor": "hack", "valid": "clean"}}'
    );

    const res = await request(instance.app)
      .post("/api/v1/proposals")
      .send(maliciousPayload);

    // Endpoint should succeed with sanitized inputs
    expect(res.status).toBe(201);
    expect(res.body.proposal.title).toBe("Proposal with nullbyte");

    // Prototype pollution should not have affected global Object
    expect((Object.prototype as any).admin).toBeUndefined();
  });

  it("Should return self-correcting error responses on missing required fields", async () => {
    const res = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_REQUIRED_FIELDS");
    expect(res.body.retryHint).toContain("Ensure all required fields are included");
    expect(res.body.specUrl).toBe("/api/v1/agent-spec");
    expect(Array.isArray(res.body.missingFields)).toBe(true);
    expect(res.body.missingFields).toContain("proposalId");
  });

  it("Should return self-correcting error with DEADLINE_EXPIRED and recovery hint", async () => {
    const res = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "1",
        tokenId: "101",
        support: 1,
        deadline: "1000", // far in the past
        signature: "0x1234",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DEADLINE_EXPIRED");
    expect(res.body.retryHint).toContain("future");
    expect(res.body.specUrl).toBe("/api/v1/agent-spec");
    expect(res.body.currentTimestamp).toBeDefined();
  });

  it("Should return self-correcting error with STALE_NONCE, expectedNonce, and recovery hint", async () => {
    const res = await request(instance.app)
      .post("/api/v1/vote/submit")
      .send({
        proposalId: "1",
        tokenId: "101",
        support: 1,
        deadline: (Math.floor(Date.now() / 1000) + 7200).toString(),
        signature: "0x1234",
        nonce: "999", // stale nonce
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("STALE_NONCE");
    expect(res.body.expectedNonce).toBeDefined();
    expect(res.body.retryHint).toContain("expectedNonce");
    expect(res.body.specUrl).toBe("/api/v1/agent-spec");
  });

  describe("Scarlet Private Key Threat & Secrecy Audit", () => {
    it("Should strictly ensure scarlet.ai private key is NEVER exposed in public endpoints", async () => {
      const endpoints = [
        "/api/v1/health",
        "/api/v1/spec",
        "/api/v1/agent-spec",
        "/.well-known/agent-commons.json",
        "/api/v1/mesh/nodes",
        "/api/v1/mesh/edges",
        "/api/v1/mesh/topology",
        "/api/v1/vote/queue",
        "/api/v1/proposals",
      ];

      const secretKey = instance.config.scarletPrivateKey.toLowerCase();
      // Remove 0x prefix to test raw hex as well
      const rawHexKey = secretKey.replace(/^0x/, "");

      for (const endpoint of endpoints) {
        const res = await request(instance.app).get(endpoint);
        expect(res.status).toBeLessThan(500);

        const bodyStr = JSON.stringify(res.body).toLowerCase();
        expect(bodyStr).not.toContain(secretKey);
        expect(bodyStr).not.toContain(rawHexKey);
      }
    });

    it("Should expose only the public address for scarlet.ai and never the secret key", async () => {
      const res = await request(instance.app).get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body.scarletAddress).toBeDefined();
      expect(res.body.scarletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

      // Verify that no field named privateKey or secretKey exists in the health response
      expect((res.body as any).scarletPrivateKey).toBeUndefined();
      expect((res.body as any).privateKey).toBeUndefined();
    });

    it("Should intercept and redact any secret key leaked via response bodies", async () => {
      const leakedKey = instance.config.scarletPrivateKey;
      const testApp: Express = express();
      const { secretLeakGuard } = await import("../src/middleware/security.js");

      testApp.use(secretLeakGuard(leakedKey));
      testApp.get("/leak-test", (_req, res) => {
        res.json({
          agent: "scarlet.ai",
          leakedSecret: leakedKey,
          nested: { key: `Bearer ${leakedKey}` },
        });
      });

      const res = await request(testApp).get("/leak-test");
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(leakedKey);
      expect(res.body.leakedSecret).toBe("[REDACTED_SECRET_KEY]");
      expect(res.body.nested.key).toBe("Bearer [REDACTED_SECRET_KEY]");
    });

    it("Should redact dynamic keystore passwords with regex special characters and bare hex keys", async () => {
      const specialPassword = "P@ssw*rd!^$#(Complex)";
      const rawHexKey = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
      const prefixedHexKey = `0x${rawHexKey}`;

      const testApp: Express = express();
      const { secretLeakGuard } = await import("../src/middleware/security.js");

      testApp.use(
        secretLeakGuard(() => [prefixedHexKey, specialPassword])
      );

      testApp.get("/dynamic-leak-test", (_req, res) => {
        res.json({
          pass: specialPassword,
          bareKey: rawHexKey,
          prefixedKey: prefixedHexKey,
        });
      });

      const res = await request(testApp).get("/dynamic-leak-test");
      expect(res.status).toBe(200);
      expect(res.body.pass).toBe("[REDACTED_SECRET_KEY]");
      expect(res.body.bareKey).toBe("[REDACTED_SECRET_KEY]");
      expect(res.body.prefixedKey).toBe("[REDACTED_SECRET_KEY]");
    });

    it("Should enforce production key validation and reject default/zero keys on mainnet", async () => {
      const { assertSecretKeySecurity } = await import("../src/config.js");

      // In production mode with default Hardhat key and no keystore, it MUST throw
      const productionConfigWithHardhatKey = {
        ...instance.config,
        nodeEnv: "production",
        mockMode: false,
        keystorePath: undefined,
        keystorePassword: undefined,
        scarletPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
      };

      expect(() => assertSecretKeySecurity(productionConfigWithHardhatKey)).toThrow(
        /Live production mode requires an explicit, secure SCARLET_PRIVATE_KEY/
      );

      // In mock mode, default key is permitted for local development
      const mockConfig = {
        ...instance.config,
        nodeEnv: "development",
        mockMode: true,
      };
      expect(() => assertSecretKeySecurity(mockConfig)).not.toThrow();
    });
  });
});
