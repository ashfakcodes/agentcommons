import { Router, Request, Response } from "express";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { MeshTopology } from "../types/index.js";

export function createMeshRouter(
  config: ServerConfig,
  blockchain: IBlockchainClient
): Router {
  const router = Router();

  /**
   * GET /api/v1/mesh/nodes
   * Returns all active Agent ID nodes in the mesh.
   */
  router.get("/nodes", async (_req: Request, res: Response) => {
    try {
      const nodes = await blockchain.getMeshNodes();
      res.json({
        total: nodes.length,
        nodes,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch mesh nodes",
        details: err.message || String(err),
      });
    }
  });

  /**
   * GET /api/v1/mesh/edges
   * Returns all established and pending handshake edges.
   */
  router.get("/edges", async (_req: Request, res: Response) => {
    try {
      const edges = await blockchain.getMeshEdges();
      res.json({
        total: edges.length,
        edges,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch mesh edges",
        details: err.message || String(err),
      });
    }
  });

  /**
   * GET /api/v1/mesh/topology
   * Returns unified mesh topology (nodes, edges, metrics) for frontend graph visualization.
   */
  router.get("/topology", async (_req: Request, res: Response) => {
    try {
      const [nodes, edges] = await Promise.all([
        blockchain.getMeshNodes(),
        blockchain.getMeshEdges(),
      ]);

      const mutualCount = edges.filter((e) => e.isMutual).length;

      const topology: MeshTopology = {
        nodes,
        edges,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        mutualConnections: mutualCount,
      };

      res.json(topology);
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch mesh topology",
        details: err.message || String(err),
      });
    }
  });

  /**
   * POST /api/v1/mesh/ping
   * Sends or simulates an outbound or inbound ping.
   */
  router.post("/ping", async (req: Request, res: Response): Promise<void> => {
    try {
      const { fromTokenId, toTokenId, capabilities } = req.body;

      if (!fromTokenId || !toTokenId) {
        res.status(400).json({
          error: "Missing required fields: fromTokenId, toTokenId",
        });
        return;
      }

      const from = BigInt(fromTokenId);
      const to = BigInt(toTokenId);

      // In mock mode, if ping is targeting scarlet.ai, trigger simulateInboundPing
      if (blockchain.isMock && blockchain.simulateInboundPing) {
        blockchain.simulateInboundPing(from, to);
        res.json({
          status: "simulated_ping_emitted",
          fromTokenId: from.toString(),
          toTokenId: to.toString(),
          message: "Simulated HandshakePinged event emitted. Reciprocal daemon will process.",
        });
        return;
      }

      // If called in live mode or normal execution
      const txHash = await blockchain.pingReciprocal(from, to, capabilities || 1);
      res.json({
        status: "ping_broadcast",
        txHash,
        fromTokenId: from.toString(),
        toTokenId: to.toString(),
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to broadcast ping",
        details: err.message || String(err),
      });
    }
  });

  return router;
}
