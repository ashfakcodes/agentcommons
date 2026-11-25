import { Router, Request, Response } from "express";
import { encodeFunctionData } from "viem";
import { ServerConfig } from "../config.js";
import { MeshAbi } from "../abi/mesh.js";
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
   * Sends or simulates an outbound or inbound ping, or returns direct-tx calldata
   * when the relayer is not authorized for `fromTokenId`.
   */
  router.post("/ping", async (req: Request, res: Response): Promise<void> => {
    try {
      const { fromTokenId, toTokenId, capabilities } = req.body;

      if (fromTokenId === undefined || fromTokenId === null || toTokenId === undefined || toTokenId === null || fromTokenId === "" || toTokenId === "") {
        res.status(400).json({
          error: "Missing required fields: fromTokenId, toTokenId",
          code: "MISSING_FIELDS",
        });
        return;
      }

      let from: bigint;
      let to: bigint;
      try {
        from = BigInt(fromTokenId);
        to = BigInt(toTokenId);
      } catch {
        res.status(400).json({
          error: "Invalid token ID format; expected integer token IDs",
          code: "INVALID_TOKEN_ID",
        });
        return;
      }

      if (from === to) {
        res.status(400).json({
          error: "Self-handshake is forbidden (fromTokenId cannot equal toTokenId)",
          code: "SELF_HANDSHAKE_FORBIDDEN",
        });
        return;
      }

      const cap = capabilities === undefined || capabilities === null ? 1 : Number(capabilities);
      if (!Number.isInteger(cap) || cap < 0 || cap > 65535) {
        res.status(400).json({
          error: "Invalid capabilities bitmask; expected uint16 integer (0..65535)",
          code: "INVALID_CAPABILITIES",
        });
        return;
      }

      // In mock mode, trigger simulateInboundPing so HandshakeDaemon tests exercise reciprocation
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

      // Pre-flight edge status check to avoid doomed on-chain reverts
      const pairStatus = await blockchain.getMeshPairStatus(from, to);
      if (pairStatus.isMutual) {
        res.status(409).json({
          error: "Agents are already mutually connected in the Citizen Mesh",
          code: "ALREADY_MUTUALLY_CONNECTED",
          fromTokenId: from.toString(),
          toTokenId: to.toString(),
        });
        return;
      }
      if (pairStatus.hasPendingOutbound) {
        res.status(409).json({
          error: "Outbound handshake ping is already pending for this peer",
          code: "PING_ALREADY_PENDING",
          fromTokenId: from.toString(),
          toTokenId: to.toString(),
        });
        return;
      }

      // Check whether the relayer hot wallet is authorized to call ping(from, ...) on-chain
      const authorized = await blockchain.isMeshAuthorized(from);
      if (!authorized) {
        const relayerAddress = blockchain.getAccountAddress();
        const pingData = encodeFunctionData({
          abi: MeshAbi,
          functionName: "ping",
          args: [from, to, cap],
        });
        const setOperatorData = encodeFunctionData({
          abi: MeshAbi,
          functionName: "setMeshOperator",
          args: [from, relayerAddress],
        });

        res.status(403).json({
          error: `Relayer (${relayerAddress}) is not owner or delegated meshOperator for Agent ID #${from}. Broadcast ping() directly from your token owner wallet or delegate via setMeshOperator() first.`,
          code: "DIRECT_TX_REQUIRED",
          fromTokenId: from.toString(),
          toTokenId: to.toString(),
          capabilities: cap,
          relayerAddress,
          meshContract: config.meshAddress,
          chainId: config.chainId,
          directTransaction: {
            to: config.meshAddress,
            chainId: config.chainId,
            function: "ping(uint256,uint256,uint16)",
            data: pingData,
          },
          optionalDelegationTransaction: {
            to: config.meshAddress,
            chainId: config.chainId,
            function: "setMeshOperator(uint256,address)",
            data: setOperatorData,
          },
        });
        return;
      }

      const txHash = await blockchain.pingReciprocal(from, to, cap);
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
