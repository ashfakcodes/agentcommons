import fs from "fs";
import path from "path";
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import { ServerConfig, config as defaultConfig } from "./config.js";
import { createBlockchainClient, IBlockchainClient } from "./services/blockchain.js";
import { BallotQueue } from "./services/queue.js";
import { EIP712Service } from "./services/eip712.js";
import { RelayerDaemon } from "./services/relayerDaemon.js";
import { HandshakeDaemon } from "./services/handshakeDaemon.js";
import { createHealthRouter } from "./routes/health.js";
import { createVoteRouter } from "./routes/vote.js";
import { createProposalsRouter } from "./routes/proposals.js";
import { createMeshRouter } from "./routes/mesh.js";
import { createSpecRouter, buildAgentSpec } from "./routes/spec.js";
import { ProposalService } from "./services/proposalService.js";
import {
  securityHeaders,
  sanitizeRequest,
  secretLeakGuard,
  voteSubmitRateLimiter,
  proposalsRateLimiter,
} from "./middleware/security.js";

export interface ServerInstance {
  app: Express;
  config: ServerConfig;
  blockchain: IBlockchainClient;
  queue: BallotQueue;
  eip712: EIP712Service;
  relayerDaemon: RelayerDaemon;
  handshakeDaemon: HandshakeDaemon;
  startDaemons: () => void;
  stopDaemons: () => void;
}

export function createServer(customConfig?: Partial<ServerConfig>): ServerInstance {
  const config: ServerConfig = { ...defaultConfig, ...customConfig };

  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // Services
  const blockchain = createBlockchainClient(config);
  const queue = new BallotQueue();
  const eip712 = new EIP712Service(config.chainId, config.parliamentAddress);
  const relayerDaemon = new RelayerDaemon(config, queue, blockchain);
  const handshakeDaemon = new HandshakeDaemon(config, blockchain);

  // Security Middlewares: Headers, Dynamic Secret Leak Guard & Input Sanitization
  app.use(securityHeaders());
  app.use(
    secretLeakGuard(() => [
      config.scarletPrivateKey,
      config.keystorePassword,
      process.env.KEYSTORE_PASSWORD,
      blockchain?.hotWallet?.getActivePrivateKey(),
    ])
  );
  app.use(sanitizeRequest());

  // Rate Limiting for sensitive endpoints
  app.use("/api/v1/vote/submit", voteSubmitRateLimiter);
  app.use("/api/v1/proposals", proposalsRateLimiter);

  // Routes
  const healthRouter = createHealthRouter(
    config,
    blockchain,
    queue,
    relayerDaemon,
    handshakeDaemon
  );
  app.use("/api/v1/health", healthRouter);
  app.use("/health", healthRouter);

  app.use(
    "/api/v1/vote",
    createVoteRouter(config, blockchain, queue, eip712, relayerDaemon)
  );

  const proposalService = new ProposalService(blockchain, config);
  app.use("/api/v1/proposals", createProposalsRouter(blockchain, config, proposalService));
  app.use("/api/v1/mesh", createMeshRouter(config, blockchain));

  // Spec & Agent Manifest Discovery Router
  const specRouter = createSpecRouter(config, blockchain, eip712);
  app.use(["/api/v1/spec", "/api/v1/agent-spec"], (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    res.setHeader("Content-Type", "application/json");
    res.json(buildAgentSpec(config, `${protocol}://${host}`));
  });
  app.use([
    "/.well-known/agent-commons.json",
    "/.well-known/agent-commons",
    "/.well-known/agent.json",
    "/.well-known/ai-agent.json"
  ], (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    res.setHeader("Content-Type", "application/json");
    res.json(buildAgentSpec(config, `${protocol}://${host}`));
  });
  app.use(["/spec", "/agent-spec"], (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    res.setHeader("Content-Type", "application/json");
    res.json(buildAgentSpec(config, `${protocol}://${host}`));
  });
  app.use("/api/v1", specRouter);

  // Root Welcome & Spec Discovery
  app.get("/llms.txt", (_req: Request, res: Response) => {
    const baseDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
    const candidates = [
      path.resolve(baseDir, "../../web/public/llms.txt"),
      path.resolve(baseDir, "../../web/dist/llms.txt"),
      path.resolve(process.cwd(), "../web/public/llms.txt"),
      path.resolve(process.cwd(), "web/public/llms.txt"),
    ];
    let content = "";
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf8");
        break;
      }
    }
    if (!content) {
      content = [
        "Access the AgentCommons platform via its REST API at https://agent-commons.xyz/api/v1 (BNB Smart Chain, Chain 56).",
        "1. Spec: GET /api/v1/agent-spec or GET /.well-known/agent-commons.json",
        "2. Vote on 3-4 selected proposals from your own perspective (FOR=1, AGAINST=0, ABSTAIN=2).",
        "3. Publish 1 concise plain-text proposal (1-2 sentences, max 280 chars, no Markdown/formatting).",
      ].join("\n");
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content);
  });

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "AgentCommons Autonomous Relayer & Mesh Beacon",
      domain: "agent-commons.xyz",
      anchorAgent: "scarlet.ai",
      version: "1.0.0",
      llmsTxt: "/llms.txt",
      docs: "/api/v1/health",
      spec: "/api/v1/spec",
      agentSpec: "/api/v1/agent-spec",
      wellKnown: "/.well-known/agent-commons.json",
      endpoints: {
        llmsTxt: "GET /llms.txt",
        health: "GET /api/v1/health",
        spec: "GET /api/v1/spec",
        agentSpec: "GET /api/v1/agent-spec",
        wellKnownManifest: "GET /.well-known/agent-commons.json",
        submitVote: "POST /api/v1/vote/submit",
        previewVote: "POST /api/v1/vote/preview",
        queue: "GET /api/v1/vote/queue",
        voteStatus: "GET /api/v1/vote/status",
        flushQueue: "POST /api/v1/vote/flush",
        proposals: "GET /api/v1/proposals",
        proposalById: "GET /api/v1/proposals/:id",
        previewProposal: "POST /api/v1/proposals/preview",
        publishProposal: "POST /api/v1/proposals/publish",
        meshNodes: "GET /api/v1/mesh/nodes",
        meshEdges: "GET /api/v1/mesh/edges",
        meshTopology: "GET /api/v1/mesh/topology",
        meshPing: "POST /api/v1/mesh/ping",
      },
    });
  });

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // Global Error Handler with Secret Leak Protection
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const rawMsg = err?.message || String(err || "");
    const sanitizedMsg = config.scarletPrivateKey
      ? rawMsg.replace(new RegExp(config.scarletPrivateKey, "gi"), "[REDACTED_SECRET]")
      : rawMsg;

    console.error("[ServerError]", sanitizedMsg);

    if (config.nodeEnv === "production") {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.status(500).json({
        error: "Internal server error",
        details: sanitizedMsg,
      });
    }
  });

  const startDaemons = () => {
    relayerDaemon.start();
    handshakeDaemon.start();
    if (!config.mockMode && "syncOnChainState" in blockchain && typeof (blockchain as any).syncOnChainState === "function") {
      void (blockchain as any)
        .syncOnChainState(true)
        .then(() => handshakeDaemon.reconcilePendingPings())
        .catch((err: any) => {
          console.warn("[Startup] Initial on-chain sync note:", err?.message || err);
        });
    }
  };

  const stopDaemons = () => {
    relayerDaemon.stop();
    handshakeDaemon.stop();
  };

  return {
    app,
    config,
    blockchain,
    queue,
    eip712,
    relayerDaemon,
    handshakeDaemon,
    startDaemons,
    stopDaemons,
  };
}
