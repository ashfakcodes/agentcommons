import { describe, it, expect } from "vitest";
import { BallotQueue } from "../src/services/queue.js";
import { QueuedVote } from "../src/types/index.js";

describe("BallotQueue", () => {
  it("should enqueue votes and prevent duplicates for same token", () => {
    const queue = new BallotQueue();

    const vote1: QueuedVote = {
      proposalId: 1n,
      tokenId: 10n,
      support: 1,
      nonce: 0n,
      deadline: 9999999999n,
      signature: "0x11",
      signer: "0xaaaa",
      queuedAt: Date.now(),
    };

    const res1 = queue.enqueue(vote1);
    expect(res1.success).toBe(true);
    expect(queue.length).toBe(1);

    // Duplicate token
    const vote2: QueuedVote = {
      proposalId: 1n,
      tokenId: 10n,
      support: 0,
      nonce: 0n,
      deadline: 9999999999n,
      signature: "0x22",
      signer: "0xbbbb",
      queuedAt: Date.now(),
    };

    const res2 = queue.enqueue(vote2);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain("already pending");
    expect(queue.length).toBe(1);
  });

  it("should prevent duplicate votes for same signer on same proposal", () => {
    const queue = new BallotQueue();

    const vote1: QueuedVote = {
      proposalId: 1n,
      tokenId: 10n,
      support: 1,
      nonce: 0n,
      deadline: 9999999999n,
      signature: "0x11",
      signer: "0xaaaa",
      queuedAt: Date.now(),
    };

    queue.enqueue(vote1);

    const vote2: QueuedVote = {
      proposalId: 1n,
      tokenId: 11n,
      support: 1,
      nonce: 0n,
      deadline: 9999999999n,
      signature: "0x22",
      signer: "0xaaaa", // Same signer
      queuedAt: Date.now(),
    };

    const res2 = queue.enqueue(vote2);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain("already queued a ballot");
  });

  it("should dequeue ballots grouped by proposalId with maxSize limit", () => {
    const queue = new BallotQueue();

    // Enqueue 3 for proposal 1, and 2 for proposal 2
    for (let i = 1n; i <= 3n; i++) {
      queue.enqueue({
        proposalId: 1n,
        tokenId: i,
        support: 1,
        nonce: 0n,
        deadline: 9999999999n,
        signature: `0x${i}`,
        signer: `0x${i.toString().padStart(40, "0")}`,
        queuedAt: Date.now(),
      });
    }

    for (let i = 4n; i <= 5n; i++) {
      queue.enqueue({
        proposalId: 2n,
        tokenId: i,
        support: 0,
        nonce: 0n,
        deadline: 9999999999n,
        signature: `0x${i}`,
        signer: `0x${i.toString().padStart(40, "0")}`,
        queuedAt: Date.now(),
      });
    }

    expect(queue.length).toBe(5);

    // Dequeue with max size 2
    const batch1 = queue.dequeueBatch(2);
    expect(batch1).not.toBeNull();
    expect(batch1?.proposalId).toBe(1n);
    expect(batch1?.batch.length).toBe(2);
    expect(queue.length).toBe(3);

    // Dequeue next batch for proposal 1 (the remaining 1)
    const batch2 = queue.dequeueBatch(5);
    expect(batch2?.proposalId).toBe(1n);
    expect(batch2?.batch.length).toBe(1);
    expect(queue.length).toBe(2);

    // Next dequeue is for proposal 2
    const batch3 = queue.dequeueBatch(5);
    expect(batch3?.proposalId).toBe(2n);
    expect(batch3?.batch.length).toBe(2);
    expect(queue.length).toBe(0);
  });
});
