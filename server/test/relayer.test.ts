import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";
import { MockBlockchainClient } from "../src/services/blockchain.js";
import { BallotQueue } from "../src/services/queue.js";
import { RelayerDaemon } from "../src/services/relayerDaemon.js";

describe("RelayerDaemon", () => {
  it("should process queued ballots in batch and update proposal tallies", async () => {
    const mockBlockchain = new MockBlockchainClient(config);
    const queue = new BallotQueue();
    const daemon = new RelayerDaemon(config, queue, mockBlockchain);

    const initialProposal = await mockBlockchain.getProposal(1n);
    expect(initialProposal).not.toBeNull();
    const initialForVotes = initialProposal!.forVotes;

    // Enqueue 3 ballots for proposal 1 (tokens 10, 11, 12)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    for (const tokenId of [10n, 11n, 12n]) {
      const owner = await mockBlockchain.getOwnerOf(tokenId);
      queue.enqueue({
        proposalId: 1n,
        tokenId,
        support: 1, // For
        nonce: 0n,
        deadline,
        signature: "0x1234",
        signer: owner,
        queuedAt: Date.now(),
      });
    }

    expect(queue.length).toBe(3);

    // Trigger flush
    const results = await daemon.flushQueue();

    expect(results.length).toBe(1);
    expect(results[0].successfulVotes).toBe(3);
    expect(results[0].failedVotes).toBe(0);
    expect(queue.length).toBe(0);

    // Verify tally updated on proposal
    const updatedProposal = await mockBlockchain.getProposal(1n);
    expect(updatedProposal!.forVotes).toBe(initialForVotes + 3);

    // Verify stats
    expect(daemon.stats.totalBatchesProcessed).toBe(1);
    expect(daemon.stats.totalVotesRelayed).toBe(3);
  });

  it("should recover and requeue batch when blockchain settlement throws an error", async () => {
    const mockBlockchain = new MockBlockchainClient(config);
    const queue = new BallotQueue();
    const daemon = new RelayerDaemon(config, queue, mockBlockchain);

    // Mock castVotesBatch to throw a temporary network error
    const originalCast = mockBlockchain.castVotesBatch.bind(mockBlockchain);
    mockBlockchain.castVotesBatch = async () => {
      throw new Error("RPC Network Timeout: 504 Gateway Timeout");
    };

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const owner = await mockBlockchain.getOwnerOf(15n);
    queue.enqueue({
      proposalId: 1n,
      tokenId: 15n,
      support: 1,
      nonce: 0n,
      deadline,
      signature: "0x9999",
      signer: owner,
      queuedAt: Date.now(),
      rationale: "Resilience verification",
    });

    expect(queue.length).toBe(1);

    // Flush should catch error and requeue
    const results = await daemon.flushQueue();
    expect(results.length).toBe(0);

    // Queue should still hold the ballot with incremented retry count
    expect(queue.length).toBe(1);
    const requeued = queue.getAll()[0];
    expect(requeued.tokenId).toBe(15n);
    expect(requeued.retryCount).toBe(1);
    expect(requeued.lastError).toContain("RPC Network Timeout");

    // Restore original castVotesBatch and re-flush: should succeed now
    mockBlockchain.castVotesBatch = originalCast;
    const retryResults = await daemon.flushQueue();
    expect(retryResults.length).toBe(1);
    expect(retryResults[0].successfulVotes).toBe(1);
    expect(queue.length).toBe(0);
    expect(daemon.stats.totalVotesRelayed).toBe(1);
  });

  it("should dead-letter queued ballots for non-Active proposals without blocking later active batches", async () => {
    const mockBlockchain = new MockBlockchainClient(config);
    const queue = new BallotQueue();
    const daemon = new RelayerDaemon(config, queue, mockBlockchain);

    const originalGetProposal = mockBlockchain.getProposal.bind(mockBlockchain);
    mockBlockchain.getProposal = async (id: bigint) => {
      const p = await originalGetProposal(id);
      if (id === 1n && p) {
        return { ...p, status: "Succeeded", statusCode: 2 };
      }
      return p;
    };

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const owner1 = await mockBlockchain.getOwnerOf(18n);
    const owner2 = await mockBlockchain.getOwnerOf(19n);

    queue.enqueue({
      proposalId: 1n,
      tokenId: 18n,
      support: 1,
      nonce: 0n,
      deadline,
      signature: "0x1111",
      signer: owner1,
      queuedAt: Date.now(),
    });
    queue.enqueue({
      proposalId: 2n,
      tokenId: 19n,
      support: 1,
      nonce: 0n,
      deadline,
      signature: "0x2222",
      signer: owner2,
      queuedAt: Date.now(),
    });

    const results = await daemon.flushQueue();
    expect(results.length).toBe(1);
    expect(results[0].proposalId).toBe(2n);
    expect(results[0].successfulVotes).toBe(1);
    expect(queue.length).toBe(0);
    expect(queue.getDeadLetters().length).toBe(1);
    expect(queue.getDeadLetters()[0].proposalId).toBe(1n);
  });
});
