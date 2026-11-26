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

  it("should handle requeueBatch with retryCount, error tracking, and dead-letter eviction", () => {
    const queue = new BallotQueue();

    const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) - 10);

    const voteA: QueuedVote = {
      proposalId: 1n,
      tokenId: 101n,
      support: 1,
      nonce: 0n,
      deadline: futureDeadline,
      signature: "0x1111",
      signer: "0xaaaa000000000000000000000000000000000001",
      queuedAt: Date.now(),
      rationale: "Aligns with security policy",
    };

    const voteB: QueuedVote = {
      proposalId: 1n,
      tokenId: 102n,
      support: 0,
      nonce: 0n,
      deadline: expiredDeadline, // Expired
      signature: "0x2222",
      signer: "0xaaaa000000000000000000000000000000000002",
      queuedAt: Date.now(),
    };

    queue.enqueue(voteA);
    queue.enqueue(voteB);
    expect(queue.length).toBe(2);

    const dequeued = queue.dequeueBatch(10);
    expect(dequeued?.batch.length).toBe(2);
    expect(queue.length).toBe(0);

    // Simulate batch execution failure and re-attempt
    const retryResult = queue.requeueBatch(dequeued!.batch, 3, "RPC connection timeout");
    expect(retryResult.requeued).toBe(1); // voteA re-queued
    expect(retryResult.dropped).toBe(1); // voteB expired and dropped to dead-letter

    expect(queue.length).toBe(1);
    const itemInQueue = queue.getAll()[0];
    expect(itemInQueue.tokenId).toBe(101n);
    expect(itemInQueue.retryCount).toBe(1);
    expect(itemInQueue.lastError).toBe("RPC connection timeout");

    // Test retry exhaustion (maxRetries: 1)
    const dequeuedAgain = queue.dequeueBatch(10);
    const exhaustedResult = queue.requeueBatch(dequeuedAgain!.batch, 1, "Gas estimation failed");
    expect(exhaustedResult.requeued).toBe(0);
    expect(exhaustedResult.dropped).toBe(1);
    expect(queue.length).toBe(0);
    expect(queue.getDeadLetters().length).toBe(2);
  });

  it("should preserve rationale across commitSettled and getVoteRecord", () => {
    const queue = new BallotQueue();

    const vote: QueuedVote = {
      proposalId: 1n,
      tokenId: 103n,
      support: 1,
      nonce: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      signature: "0x3333",
      signer: "0xcccc000000000000000000000000000000000003",
      queuedAt: Date.now(),
      rationale: "Constitutional governance anchoring",
    };

    queue.enqueue(vote);
    expect(queue.getVoteRecord(1n, 103n)?.rationale).toBe("Constitutional governance anchoring");

    const batch = queue.dequeueBatch(10);
    expect(batch?.batch.length).toBe(1);

    queue.commitSettled(batch!.batch);
    expect(queue.getVoteRecord(1n, 103n)?.rationale).toBe("Constitutional governance anchoring");
    expect(queue.getSettledHistory().length).toBe(1);
  });

  it("should enforce per-token lowest-nonce-first scheduling across parallel proposals", () => {
    const queue = new BallotQueue();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Token 200 submits nonce 2 on Proposal #5 first (out of order arrival vs nonce 0/1)
    queue.enqueue({
      proposalId: 5n,
      tokenId: 200n,
      support: 1,
      nonce: 2n,
      deadline,
      signature: "0x02",
      signer: "0xdddd000000000000000000000000000000000200",
      queuedAt: Date.now(),
    });
    // Token 200 has earlier nonces 0 on Proposal #1 and 1 on Proposal #6
    queue.enqueue({
      proposalId: 1n,
      tokenId: 200n,
      support: 1,
      nonce: 0n,
      deadline,
      signature: "0x00",
      signer: "0xdddd000000000000000000000000000000000200",
      queuedAt: Date.now(),
    });
    queue.enqueue({
      proposalId: 6n,
      tokenId: 200n,
      support: 0,
      nonce: 1n,
      deadline,
      signature: "0x01",
      signer: "0xdddd000000000000000000000000000000000200",
      queuedAt: Date.now(),
    });

    // Dequeue order MUST settle nonce 0 (#1) -> nonce 1 (#6) -> nonce 2 (#5)
    const b1 = queue.dequeueBatch(10);
    expect(b1?.proposalId).toBe(1n);
    expect(b1?.batch.map((v) => v.nonce)).toEqual([0n]);

    const b2 = queue.dequeueBatch(10);
    expect(b2?.proposalId).toBe(6n);
    expect(b2?.batch.map((v) => v.nonce)).toEqual([1n]);

    const b3 = queue.dequeueBatch(10);
    expect(b3?.proposalId).toBe(5n);
    expect(b3?.batch.map((v) => v.nonce)).toEqual([2n]);
    expect(queue.length).toBe(0);
  });
});
