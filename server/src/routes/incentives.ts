import { Router, Request, Response } from "express";
import { isAddress } from "viem";
import { IncentiveService } from "../services/incentives/incentiveService.js";

export function createIncentivesRouter(incentiveService: IncentiveService): Router {
  const router = Router();

  /**
   * GET /api/v1/incentives/status
   * Returns overall incentive quota and per-user quest progress.
   */
  router.get("/status", async (req: Request, res: Response): Promise<void> => {
    try {
      const addressQuery = req.query.address as string | undefined;
      const tokenIdQuery = req.query.tokenId as string | undefined;

      const address = addressQuery && isAddress(addressQuery)
        ? (addressQuery as `0x${string}`)
        : undefined;

      const tokenId = tokenIdQuery ? BigInt(tokenIdQuery) : undefined;

      const status = await incentiveService.getStatus(address, tokenId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to fetch incentive status",
        details: err?.message || String(err),
      });
    }
  });

  /**
   * POST /api/v1/incentives/claim
   * Evaluates criteria and claims the $0.15 BNB reward for qualifying agentic wallet.
   */
  router.post("/claim", async (req: Request, res: Response): Promise<void> => {
    try {
      const { address, tokenId } = req.body;

      if (!address || tokenId === undefined) {
        res.status(400).json({
          success: false,
          error: "Missing required fields: address, tokenId",
        });
        return;
      }

      if (!isAddress(address)) {
        res.status(400).json({
          success: false,
          error: `Invalid Ethereum address: ${address}`,
        });
        return;
      }

      const tId = BigInt(tokenId);
      const result = await incentiveService.claimReward(address as `0x${string}`, tId);

      if (result.success) {
        res.status(200).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: "Error processing incentive claim",
        details: err?.message || String(err),
      });
    }
  });

  return router;
}
