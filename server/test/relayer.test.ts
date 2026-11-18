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
});
