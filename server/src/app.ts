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
  app.use("/api/v1/proposals", createProposalsRouter(blockchain));
  app.use("/api/v1/mesh", createMeshRouter(config, blockchain));

  // Root Welcome & Spec Discovery
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "AgentCommons Autonomous Relayer & Mesh Beacon",
      domain: "agentcommons.ai",
      anchorAgent: "scarlet.ai",
      version: "1.0.0",
      docs: "/api/v1/health",
      endpoints: {
        health: "GET /api/v1/health",
        submitVote: "POST /api/v1/vote/submit",
        queue: "GET /api/v1/vote/queue",
        flushQueue: "POST /api/v1/vote/flush",
        proposals: "GET /api/v1/proposals",
        proposalById: "GET /api/v1/proposals/:id",
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

  // Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[ServerError]", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
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
    startDaemons,
    stopDaemons,
  };
}
