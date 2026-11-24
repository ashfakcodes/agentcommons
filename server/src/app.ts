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
import { createIncentivesRouter } from "./routes/incentives.js";
import { ProposalService } from "./services/proposalService.js";
import { IncentiveService, IncentiveConfig } from "./services/incentives/index.js";
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
  incentiveService?: IncentiveService;
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

  // User Incentive Program Module
  const incentiveConfig: IncentiveConfig = {
    enabled: config.incentiveEnabled,
    maxUsers: config.incentiveMaxUsers,
    rewardUsd: config.incentiveRewardUsd,
    fallbackBnbPrice: config.incentiveFallbackBnbPrice,
    ledgerFilePath: config.incentiveLedgerPath,
  };
  const incentiveService = new IncentiveService(
    incentiveConfig,
    blockchain,
    blockchain.hotWallet
  );

  app.use(
    "/api/v1/vote",
    createVoteRouter(config, blockchain, queue, eip712, relayerDaemon)
  );

  const proposalService = new ProposalService(blockchain, config, incentiveService);
  app.use("/api/v1/proposals", createProposalsRouter(blockchain, config, proposalService));
  app.use("/api/v1/mesh", createMeshRouter(config, blockchain));
  app.use("/api/v1/incentives", createIncentivesRouter(incentiveService));

  // Auto-reward incentive on batch settlement if criteria met (automatic agent payout)
  relayerDaemon.on("batchSettled", async (_result: any, batch: any[]) => {
    if (!incentiveService || !batch) return;
    for (const vote of batch) {
      if (vote.signer && vote.tokenId) {
        try {
          const claimRes = await incentiveService.claimReward(vote.signer, vote.tokenId);
          if (claimRes.success) {
            console.log(`[RelayerDaemon] Auto-rewarded agent ${vote.signer} (#${vote.tokenId}) with $0.15 in BNB! Tx: ${claimRes.claimRecord?.txHash}`);
          }
        } catch {
          // Silently ignore ineligible or already claimed
        }
      }
    }
  });

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
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "AgentCommons Autonomous Relayer & Mesh Beacon",
      domain: "agentcommons.ai",
      anchorAgent: "scarlet.ai",
      version: "1.0.0",
      docs: "/api/v1/health",
      spec: "/api/v1/spec",
      agentSpec: "/api/v1/agent-spec",
      wellKnown: "/.well-known/agent-commons.json",
      endpoints: {
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
    incentiveService,
    startDaemons,
    stopDaemons,
  };
}
