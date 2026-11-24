import { Router, Request, Response } from "express";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { BallotQueue } from "../services/queue.js";
import { EIP712Service } from "../services/eip712.js";
import { RelayerDaemon } from "../services/relayerDaemon.js";
import { BallotMessage, QueuedVote } from "../types/index.js";
import { selfCorrectingError, SecurityErrorCodes } from "../middleware/security.js";

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
      const { proposalId, tokenId, support, deadline, signature, nonce, rationale } = req.body;

      if (
        proposalId === undefined ||
        tokenId === undefined ||
        support === undefined ||
        deadline === undefined ||
        !signature
      ) {
        const missing: string[] = [];
        if (proposalId === undefined) missing.push("proposalId");
        if (tokenId === undefined) missing.push("tokenId");
        if (support === undefined) missing.push("support");
        if (deadline === undefined) missing.push("deadline");
        if (!signature) missing.push("signature");

        selfCorrectingError(res, 400, {
          error: "Missing required fields: proposalId, tokenId, support, deadline, signature",
          code: SecurityErrorCodes.MISSING_REQUIRED_FIELDS,
          missingFields: missing,
          retryHint: "Ensure all required fields are included in the JSON payload: proposalId, tokenId, support (0, 1, or 2), deadline, signature.",
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
        selfCorrectingError(res, 400, {
          error: `Invalid support value ${supp}. Must be 0 (Against), 1 (For), or 2 (Abstain).`,
          code: SecurityErrorCodes.INVALID_SUPPORT_VALUE,
          providedSupport: supp,
          retryHint: "Set support to 0 for Against, 1 for For, or 2 for Abstain.",
        });
        return;
      }

      // 2. Verify deadline
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (dline <= now) {
        selfCorrectingError(res, 400, {
          error: `Signature expired (deadline: ${dline}, current time: ${now}).`,
          code: SecurityErrorCodes.DEADLINE_EXPIRED,
          providedDeadline: dline.toString(),
          currentTimestamp: Number(now),
          retryHint: `Set deadline to a future Unix timestamp (e.g. ${Number(now) + 3600}) and re-sign the ballot.`,
        });
        return;
      }

      // 3. Check if proposal exists
      const proposal = await blockchain.getProposal(pId);
      if (!proposal) {
        selfCorrectingError(res, 404, {
          error: `Proposal #${pId} does not exist.`,
          code: SecurityErrorCodes.PROPOSAL_NOT_FOUND,
          proposalId: pId.toString(),
          retryHint: "Fetch available proposals from GET /api/v1/proposals to choose an active proposal.",
        });
        return;
      }

      if (proposal.statusCode !== 1) {
        selfCorrectingError(res, 400, {
          error: `Proposal #${pId} is not active (status: ${proposal.status}).`,
          code: SecurityErrorCodes.PROPOSAL_NOT_ACTIVE,
          proposalId: pId.toString(),
          proposalStatus: proposal.status,
          retryHint: "This proposal is no longer accepting votes. Query GET /api/v1/proposals for active polls.",
        });
        return;
      }

      // 4. Check if token or address has already voted on-chain
      const [tokenVoted, tokenOwner] = await Promise.all([
        blockchain.hasTokenVoted(pId, tId),
        blockchain.getOwnerOf(tId).catch(() => null),
      ]);

      if (tokenVoted) {
        selfCorrectingError(res, 400, {
          error: `Agent ID #${tId} has already cast a vote on Proposal #${pId}.`,
          code: SecurityErrorCodes.ALREADY_VOTED,
          tokenId: tId.toString(),
          proposalId: pId.toString(),
          retryHint: `Token #${tId} has already voted on this proposal. Check GET /api/v1/vote/status?proposalId=${pId}&tokenId=${tId} for voting records.`,
        });
        return;
      }

      if (!tokenOwner) {
        selfCorrectingError(res, 400, {
          error: `Agent ID #${tId} is not a registered Space ID Agent token.`,
          code: SecurityErrorCodes.AGENT_NOT_REGISTERED,
          tokenId: tId.toString(),
          retryHint: `Agent ID #${tId} is not registered with the Space ID registrar. Verify your tokenId or register at SPACE ID.`,
        });
        return;
      }

      const addressVoted = await blockchain.hasAddressVoted(pId, tokenOwner);
      if (addressVoted) {
        selfCorrectingError(res, 400, {
          error: `Owner address ${tokenOwner} has already cast a vote on Proposal #${pId}.`,
          code: SecurityErrorCodes.ADDRESS_ALREADY_VOTED,
          address: tokenOwner,
          proposalId: pId.toString(),
          retryHint: `Address ${tokenOwner} has already participated in Proposal #${pId}. Under 1-Agent-1-Vote rules, each owner address can vote only once per proposal.`,
        });
        return;
      }

      // 5. Determine expected nonce & guard against stale nonce
      const onChainNonce = await blockchain.getNonces(tId);
      const pendingCount = queue.getTokenNoncesInQueue(tId);
      const effectiveExpectedNonce = onChainNonce + BigInt(pendingCount);

      let ballotNonce: bigint;
      if (nonce !== undefined && nonce !== null) {
        ballotNonce = BigInt(nonce);
        if (ballotNonce !== effectiveExpectedNonce && ballotNonce !== onChainNonce) {
          selfCorrectingError(res, 400, {
            error: `Stale or invalid nonce. Provided: ${nonce}, expected: ${effectiveExpectedNonce.toString()}.`,
            code: SecurityErrorCodes.STALE_NONCE,
            expectedNonce: effectiveExpectedNonce.toString(),
            providedNonce: nonce.toString(),
            retryHint: `Query GET /api/v1/vote/status?proposalId=${pId}&tokenId=${tId} or use expectedNonce: ${effectiveExpectedNonce.toString()} to re-sign the EIP-712 ballot.`,
          });
          return;
        }
      } else {
        ballotNonce = effectiveExpectedNonce;
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
        const recovered = verification.signer;
        const isSignerMismatch =
          Boolean(recovered) &&
          (recovered as string).toLowerCase() !== tokenOwner.toLowerCase();
        const code = isSignerMismatch
          ? SecurityErrorCodes.INVALID_SIGNER
          : SecurityErrorCodes.INVALID_SIGNATURE;

        selfCorrectingError(res, 400, {
          error: verification.error || "EIP-712 ballot signature verification failed.",
          code,
          expectedSigner: tokenOwner,
          recoveredSigner: recovered || null,
          retryHint: isSignerMismatch
            ? `The signature was generated by ${recovered}, but token #${tId} is owned by ${tokenOwner}. Please sign with the private key of the token owner.`
            : "EIP-712 verification failed. Ensure domain separator, Ballot types (proposalId, tokenId, support, nonce, deadline), and signature format match /api/v1/agent-spec.",
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
        rationale: typeof rationale === "string" && rationale.trim().length > 0 ? rationale.trim() : undefined,
      };

      const queueResult = queue.enqueue(queuedVote);
      if (!queueResult.success) {
        selfCorrectingError(res, 409, {
          error: queueResult.error || "Ballot is already queued for batch settlement.",
          code: SecurityErrorCodes.BALLOT_ALREADY_QUEUED,
          tokenId: tId.toString(),
          proposalId: pId.toString(),
          retryHint: "Ballot is already queued for batch settlement. Check GET /api/v1/vote/queue or wait for the next batch flush.",
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
        rationale: queuedVote.rationale,
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
   * GET /api/v1/vote/status
   * Queries an agent's voting status on a given proposal (hasVoted, currentNonce, eligible).
   */
  router.get("/status", async (req: Request, res: Response): Promise<void> => {
    try {
      const proposalIdParam = req.query.proposalId ?? req.query.proposal_id;
      const tokenIdParam = req.query.tokenId ?? req.query.token_id;
      const addressParam = req.query.address ?? req.query.signer ?? req.query.account;

      if (!proposalIdParam) {
        selfCorrectingError(res, 400, {
          error: "Missing required query parameter: proposalId",
          code: SecurityErrorCodes.MISSING_REQUIRED_FIELDS,
          missingFields: ["proposalId"],
          retryHint: "Provide proposalId as a query parameter, e.g. GET /api/v1/vote/status?proposalId=1&tokenId=101",
        });
        return;
      }

      if (tokenIdParam === undefined && !addressParam) {
        selfCorrectingError(res, 400, {
          error: "Missing required query parameter: tokenId or address",
          code: SecurityErrorCodes.MISSING_REQUIRED_FIELDS,
          missingFields: ["tokenId", "address"],
          retryHint: "Provide either tokenId or address in the query, e.g. GET /api/v1/vote/status?proposalId=1&tokenId=101",
        });
        return;
      }

      const pId = BigInt(proposalIdParam as string);
      const proposal = await blockchain.getProposal(pId);
      if (!proposal) {
        selfCorrectingError(res, 404, {
          error: `Proposal #${pId} does not exist.`,
          code: SecurityErrorCodes.PROPOSAL_NOT_FOUND,
          proposalId: pId.toString(),
          retryHint: "Fetch available proposals from GET /api/v1/proposals to choose an existing proposal.",
        });
        return;
      }

      const isActive = proposal.statusCode === 1;

      let tId: bigint | undefined;
      let tokenOwner: `0x${string}` | null = null;
      let onChainNonce = 0n;
      let effectiveNonce = 0n;
      let tokenVotedOnChain = false;
      let tokenVotedInQueue = false;

      if (tokenIdParam !== undefined && tokenIdParam !== "") {
        tId = BigInt(tokenIdParam as string);
        tokenOwner = await blockchain.getOwnerOf(tId).catch(() => null);
        onChainNonce = await blockchain.getNonces(tId).catch(() => 0n);
        const pendingCount = queue.getTokenNoncesInQueue(tId);
        effectiveNonce = onChainNonce + BigInt(pendingCount);
        tokenVotedOnChain = await blockchain.hasTokenVoted(pId, tId);
        tokenVotedInQueue = queue.isTokenQueued(pId, tId);
      }

      let agentAddress: `0x${string}` | null = (addressParam as `0x${string}`) || tokenOwner;
      let addressVotedOnChain = false;
      let addressVotedInQueue = false;

      if (agentAddress) {
        addressVotedOnChain = await blockchain.hasAddressVoted(pId, agentAddress);
        addressVotedInQueue = queue.isSignerQueued(pId, agentAddress);
      }

      const onChainVoted = tokenVotedOnChain || addressVotedOnChain;
      const isQueued = tokenVotedInQueue || addressVotedInQueue;
      const hasVoted = onChainVoted || isQueued;
      const isRegistered = tId !== undefined ? Boolean(tokenOwner) : true;
      const eligible = isActive && isRegistered && !hasVoted;

      const voteRecord = tId !== undefined ? queue.getVoteRecord(pId, tId) : undefined;

      res.json({
        proposalId: pId.toString(),
        tokenId: tId !== undefined ? tId.toString() : null,
        address: agentAddress,
        eligible,
        hasVoted,
        isQueued,
        onChainVoted,
        currentNonce: effectiveNonce.toString(),
        onChainNonce: onChainNonce.toString(),
        proposalStatus: proposal.status,
        proposalActive: isActive,
        support: voteRecord?.support,
        rationale: voteRecord?.rationale,
        reason: eligible
          ? "Eligible to vote"
          : !isActive
          ? `Proposal is not active (${proposal.status})`
          : hasVoted
          ? (isQueued ? "Ballot is already queued for batch settlement" : "Agent has already cast a vote on-chain")
          : !isRegistered
          ? `Agent ID #${tId} is not a registered Space ID Agent token`
          : "Ineligible",
      });
    } catch (err: any) {
      console.error("[VoteRouter] Error querying vote status:", err);
      res.status(500).json({
        error: "Internal relayer error querying voting status.",
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
      rationale: item.rationale,
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
