import { Router, Request, Response } from "express";
import { ServerConfig, config as defaultConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { ProposalService } from "../services/proposalService.js";

export function createProposalsRouter(
  blockchain: IBlockchainClient,
  config?: ServerConfig,
  proposalService?: ProposalService
): Router {
  const router = Router();
  const effectiveConfig = config || defaultConfig;
  const pService = proposalService || new ProposalService(blockchain, effectiveConfig);

  /**
   * GET /api/v1/proposals
   * Returns all proposals on the active Parliament contract with tallies and live block-height status,
   * plus optional concluded legacy proposals for frontend archiving.
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const [proposals, legacyProposals] = await Promise.all([
        blockchain.getAllProposals(),
        blockchain.getLegacyProposals ? blockchain.getLegacyProposals() : Promise.resolve([]),
      ]);
      res.json({
        total: proposals.length,
        proposals,
        legacyProposals,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch proposals",
        details: err.message || String(err),
      });
    }
  });

  /**
   * POST /api/v1/proposals/preview
   * Computes structHash, typedDataHash, and EIP-712 proposal payload before signing.
   */
  router.post("/preview", async (req: Request, res: Response): Promise<void> => {
    try {
      const preview = await pService.previewProposal(req.body);
      res.json(preview);
    } catch (err: any) {
      const message = err.message || String(err);
      let code = err.code || "INVALID_PROPOSAL_PREVIEW";
      if (message.includes("Missing required fields")) code = "MISSING_FIELDS";
      else if (message.includes("Duration")) code = "INVALID_DURATION";
      else if (message.includes("Category")) code = "INVALID_CATEGORY";
      else if (message.includes("does not exist")) code = "TOKEN_NOT_FOUND";
      else if (message.includes("Invalid creator")) code = "INVALID_CREATOR";

      res.status(400).json({
        error: message,
        code,
      });
    }
  });

  /**
   * POST /api/v1/proposals/publish
   * Accepts gasless EIP-712 proposal payload from AI agent, validates signature & token ownership,
   * and submits createProposalBySig on-chain or in simulator.
   */
  router.post("/publish", async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pService.validateAndPublish(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      const message = err.message || String(err);
      if (
        message.includes("Missing required fields") ||
        message.includes("Invalid") ||
        message.includes("expired") ||
        message.includes("Duration") ||
        message.includes("hash cannot be zero") ||
        message.includes("not the owner") ||
        message.includes("does not exist") ||
        message.includes("nonce") ||
        message.includes("signature")
      ) {
        res.status(400).json({
          error: message,
        });
        return;
      }

      console.error("[ProposalsRouter] Error publishing proposal:", err);
      res.status(500).json({
        error: "Failed to publish proposal",
        details: message,
      });
    }
  });

  /**
   * GET /api/v1/proposals/:id
   * Returns a specific proposal by ID.
   */
  router.get("/:id", async (req: Request, res: Response): Promise<void> => {
    try {
      const id = BigInt(req.params.id);
      const proposal = await blockchain.getProposal(id);

      if (!proposal) {
        res.status(404).json({
          error: `Proposal #${req.params.id} not found`,
        });
        return;
      }

      res.json(proposal);
    } catch (err: any) {
      res.status(400).json({
        error: "Invalid proposal ID parameter",
        details: err.message || String(err),
      });
    }
  });

  /**
   * POST /api/v1/proposals
   * Simulation helper: creates a new proposal in mock mode.
   */
  router.post("/", async (req: Request, res: Response): Promise<void> => {
    try {
      if (!blockchain.createMockProposal) {
        res.status(400).json({
          error: "Creating proposals via API is only available in mock mode.",
        });
        return;
      }

      const { title, description, categoryId } = req.body;
      if (!title) {
        res.status(400).json({ error: "Missing required field: title" });
        return;
      }

      const id = await blockchain.createMockProposal(
        title,
        description || "",
        categoryId || 1
      );

      const created = await blockchain.getProposal(id);
      res.status(201).json({
        message: "Proposal created successfully",
        proposal: created,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to create mock proposal",
        details: err.message || String(err),
      });
    }
  });

  return router;
}
