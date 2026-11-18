import { Router, Request, Response } from "express";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { BallotQueue } from "../services/queue.js";
import { EIP712Service } from "../services/eip712.js";
import { RelayerDaemon } from "../services/relayerDaemon.js";
import { BallotMessage, QueuedVote } from "../types/index.js";

export function createVoteRouter(
  config: ServerConfig,
  blockchain: IBlockchainClient,
  queue: BallotQueue,
  eip712: EIP712Service,
  relayerDaemon: RelayerDaemon
): Router {
  const router = Router();

  /**
   * POST /api/v1/vote/submit
   * Receives gasless EIP-712 ballot, validates signature & token ownership, queues for batch.
   */
  router.post("/submit", async (req: Request, res: Response): Promise<void> => {
    try {
      const { proposalId, tokenId, support, deadline, signature, nonce } = req.body;

      if (
        proposalId === undefined ||
        tokenId === undefined ||
        support === undefined ||
        deadline === undefined ||
        !signature
      ) {
        res.status(400).json({
          error: "Missing required fields: proposalId, tokenId, support, deadline, signature",
        });
        return;
      }

      const pId = BigInt(proposalId);
      const tId = BigInt(tokenId);
      const supp = Number(support);
      const dline = BigInt(deadline);
      const sig = (signature.startsWith("0x") ? signature : `0x${signature}`) as `0x${string}`;

      // 1. Verify support enum
      if (supp !== 0 && supp !== 1 && supp !== 2) {
        res.status(400).json({
          error: `Invalid support value ${supp}. Must be 0 (Against), 1 (For), or 2 (Abstain).`,
        });
        return;
      }

      // 2. Verify deadline
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (dline <= now) {
        res.status(400).json({
          error: `Signature expired (deadline: ${dline}, current time: ${now}).`,
        });
        return;
      }

      // 3. Check if proposal exists
      const proposal = await blockchain.getProposal(pId);
      if (!proposal) {
        res.status(404).json({
          error: `Proposal #${pId} does not exist.`,
        });
        return;
      }

      if (proposal.statusCode !== 1) {
        res.status(400).json({
          error: `Proposal #${pId} is not active (status: ${proposal.status}).`,
        });
        return;
      }

      // 4. Check if token or address has already voted on-chain
      const [tokenVoted, tokenOwner] = await Promise.all([
        blockchain.hasTokenVoted(pId, tId),
        blockchain.getOwnerOf(tId).catch(() => null),
      ]);

      if (tokenVoted) {
        res.status(400).json({
          error: `Agent ID #${tId} has already cast a vote on Proposal #${pId}.`,
        });
        return;
      }

      if (!tokenOwner) {
        res.status(400).json({
          error: `Agent ID #${tId} is not a registered Space ID Agent token.`,
        });
        return;
      }

      const addressVoted = await blockchain.hasAddressVoted(pId, tokenOwner);
      if (addressVoted) {
        res.status(400).json({
          error: `Owner address ${tokenOwner} has already cast a vote on Proposal #${pId}.`,
        });
        return;
      }

      // 5. Determine expected nonce
      let ballotNonce: bigint;
      if (nonce !== undefined && nonce !== null) {
        ballotNonce = BigInt(nonce);
      } else {
        ballotNonce = await blockchain.getNonces(tId);
      }

      // 6. Verify EIP-712 Typed Signature
      const ballotMessage: BallotMessage = {
        proposalId: pId,
        tokenId: tId,
        support: supp,
        nonce: ballotNonce,
        deadline: dline,
      };

      const verification = await eip712.verifyBallot(ballotMessage, sig, tokenOwner);
      if (!verification.isValid || !verification.signer) {
        res.status(400).json({
          error: verification.error || "EIP-712 ballot signature verification failed.",
        });
        return;
      }

      // 7. Enqueue ballot
      const queuedVote: QueuedVote = {
        proposalId: pId,
        tokenId: tId,
        support: supp,
        nonce: ballotNonce,
        deadline: dline,
        signature: sig,
        signer: verification.signer,
        queuedAt: Date.now(),
      };

      const queueResult = queue.enqueue(queuedVote);
      if (!queueResult.success) {
        res.status(409).json({
          error: queueResult.error,
        });
        return;
      }

      // Notify daemon of incoming vote
      relayerDaemon.onVoteEnqueued();

      res.status(201).json({
        status: "queued",
        message: "Gasless ballot successfully verified and queued for next batch settlement.",
        queueLength: queue.length,
        proposalId: pId.toString(),
        tokenId: tId.toString(),
        signer: verification.signer,
        support: supp,
      });
    } catch (err: any) {
      console.error("[VoteRouter] Error submitting vote:", err);
      res.status(500).json({
        error: "Internal relayer error processing ballot submission.",
        details: err.message || String(err),
      });
    }
  });

  /**
   * GET /api/v1/vote/queue
   * Returns current pending ballots in the relayer queue.
   */
  router.get("/queue", (_req: Request, res: Response) => {
    const items = queue.getAll().map((item) => ({
      proposalId: item.proposalId.toString(),
      tokenId: item.tokenId.toString(),
      support: item.support,
      nonce: item.nonce.toString(),
      deadline: item.deadline.toString(),
      signer: item.signer,
      queuedAt: item.queuedAt,
    }));

    res.json({
      count: items.length,
      ballots: items,
    });
  });

  /**
   * POST /api/v1/vote/flush
   * Forces an immediate batch settlement of the queue.
   */
  router.post("/flush", async (_req: Request, res: Response) => {
    try {
      const results = await relayerDaemon.flushQueue();
      res.json({
        status: "flushed",
        batchesProcessed: results.length,
        results: results.map((r) => ({
          proposalId: r.proposalId.toString(),
          batchSize: r.batchSize,
          successfulVotes: r.successfulVotes,
          failedVotes: r.failedVotes,
          txHash: r.txHash,
        })),
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to flush queue",
        details: err.message || String(err),
      });
    }
  });

  return router;
}
