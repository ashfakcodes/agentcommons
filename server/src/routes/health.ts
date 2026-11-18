import { Router, Request, Response } from "express";
import { formatEther } from "viem";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { BallotQueue } from "../services/queue.js";
import { RelayerDaemon } from "../services/relayerDaemon.js";
import { HandshakeDaemon } from "../services/handshakeDaemon.js";
import { RelayerHealth } from "../types/index.js";

const startTime = Date.now();

export function createHealthRouter(
  config: ServerConfig,
  blockchain: IBlockchainClient,
  queue: BallotQueue,
  relayerDaemon: RelayerDaemon,
  handshakeDaemon: HandshakeDaemon
): Router {
  const router = Router();

  const getHealthHandler = async (_req: Request, res: Response) => {
    try {
      const scarletAddress = blockchain.getAccountAddress();
      let balanceBnb = "0";

      try {
        const balance = await blockchain.getBalance(scarletAddress);
        balanceBnb = formatEther(balance);
      } catch (e) {
        balanceBnb = "error";
      }

      const health: RelayerHealth = {
        status: "ok",
        service: "scarlet.ai-relayer",
        version: "1.0.0",
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        chainId: config.chainId,
        mockMode: blockchain.isMock,
        scarletTokenId: config.scarletTokenId.toString(),
        scarletAddress,
        scarletBalanceBnb: balanceBnb,
        queuedVotesCount: queue.length,
        contracts: {
          parliament: config.parliamentAddress,
          mesh: config.meshAddress,
          registrar: config.registrarAddress,
        },
        stats: {
          totalBatchesProcessed: relayerDaemon.stats.totalBatchesProcessed,
          totalVotesRelayed: relayerDaemon.stats.totalVotesRelayed,
          totalFailedVotes: relayerDaemon.stats.totalFailedVotes,
          totalHandshakesReciprocated: handshakeDaemon.stats.totalHandshakesReciprocated,
        },
      };

      res.json(health);
    } catch (err: any) {
      res.status(500).json({
        status: "error",
        error: err.message || String(err),
      });
    }
  };

  router.get("/", getHealthHandler);
  return router;
}
