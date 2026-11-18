import { QueuedVote } from "../types/index.js";

export class BallotQueue {
  private queue: QueuedVote[] = [];
  // Key: `${proposalId}:${tokenId}`
  private queuedTokenKeys = new Set<string>();
  // Key: `${proposalId}:${signer.toLowerCase()}`
  private queuedSignerKeys = new Set<string>();

  public enqueue(ballot: QueuedVote): { success: boolean; error?: string } {
    const tokenKey = `${ballot.proposalId}:${ballot.tokenId}`;
    const signerKey = `${ballot.proposalId}:${ballot.signer.toLowerCase()}`;

    if (this.queuedTokenKeys.has(tokenKey)) {
      return {
        success: false,
        error: `Agent ID #${ballot.tokenId} ballot for Proposal #${ballot.proposalId} is already pending in the relayer queue.`,
      };
    }

    if (this.queuedSignerKeys.has(signerKey)) {
      return {
        success: false,
        error: `Signer ${ballot.signer} has already queued a ballot for Proposal #${ballot.proposalId}.`,
      };
    }

    this.queue.push(ballot);
    this.queuedTokenKeys.add(tokenKey);
    this.queuedSignerKeys.add(signerKey);

    return { success: true };
  }

  public get length(): number {
    return this.queue.length;
  }

  public getAll(): QueuedVote[] {
    return [...this.queue];
  }

  /**
   * Dequeues up to `maxSize` ballots that share the same proposalId.
   * Prioritizes the proposal with the oldest queued ballot.
   */
  public dequeueBatch(maxSize: number = 50): { proposalId: bigint; batch: QueuedVote[] } | null {
    if (this.queue.length === 0) return null;

    // Target proposalId is that of the first queued ballot
    const targetProposalId = this.queue[0].proposalId;

    const batch: QueuedVote[] = [];
    const remaining: QueuedVote[] = [];

    for (const item of this.queue) {
      if (item.proposalId === targetProposalId && batch.length < maxSize) {
        batch.push(item);
        this.queuedTokenKeys.delete(`${item.proposalId}:${item.tokenId}`);
        this.queuedSignerKeys.delete(`${item.proposalId}:${item.signer.toLowerCase()}`);
      } else {
        remaining.push(item);
      }
    }

    this.queue = remaining;
    return { proposalId: targetProposalId, batch };
  }

  public clear(): void {
    this.queue = [];
    this.queuedTokenKeys.clear();
    this.queuedSignerKeys.clear();
  }
}
