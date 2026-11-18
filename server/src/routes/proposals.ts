import { Router, Request, Response } from "express";
import { IBlockchainClient } from "../services/blockchain.js";

export function createProposalsRouter(blockchain: IBlockchainClient): Router {
  const router = Router();

  /**
   * GET /api/v1/proposals
   * Returns all proposals with tallies and status.
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const proposals = await blockchain.getAllProposals();
      res.json({
        total: proposals.length,
        proposals,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch proposals",
        details: err.message || String(err),
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
