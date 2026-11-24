import { QueuedVote } from "../types/index.js";

export class BallotQueue {
  private queue: QueuedVote[] = [];
  // Key: `${proposalId}:${tokenId}`
  private queuedTokenKeys = new Set<string>();
  // Key: `${proposalId}:${signer.toLowerCase()}`
  private queuedSignerKeys = new Set<string>();
  // History of settled ballots to preserve observable rationales even after dequeue
  private settledHistory = new Map<string, QueuedVote>();
  // Failed / dead-letter ballots that exceeded retry limits or expired
  private deadLetterHistory = new Map<string, QueuedVote>();

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

  public isTokenQueued(proposalId: bigint, tokenId: bigint): boolean {
    return this.queuedTokenKeys.has(`${proposalId}:${tokenId}`);
  }

  public isSignerQueued(proposalId: bigint, signer: string): boolean {
    return this.queuedSignerKeys.has(`${proposalId}:${signer.toLowerCase()}`);
  }

  public getQueuedVote(proposalId: bigint, tokenId: bigint): QueuedVote | undefined {
    return this.queue.find(
      (v) => v.proposalId === proposalId && v.tokenId === tokenId
    );
  }

  public getVoteRecord(proposalId: bigint, tokenId: bigint): QueuedVote | undefined {
    return (
      this.getQueuedVote(proposalId, tokenId) ||
      this.settledHistory.get(`${proposalId}:${tokenId}`) ||
      this.deadLetterHistory.get(`${proposalId}:${tokenId}`)
    );
  }

  public getTokenNoncesInQueue(tokenId: bigint): number {
    return this.queue.filter((v) => v.tokenId === tokenId).length;
  }

  public get length(): number {
    return this.queue.length;
  }

  public getAll(): QueuedVote[] {
    return [...this.queue];
  }

  public getSettledHistory(): QueuedVote[] {
    return Array.from(this.settledHistory.values());
  }

  public getDeadLetters(): QueuedVote[] {
    return Array.from(this.deadLetterHistory.values());
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

  /**
   * Commits a batch as successfully settled on-chain.
   * Stores the settled ballots in history to preserve observable rationales.
   */
  public commitSettled(batch: QueuedVote[]): void {
    for (const item of batch) {
      this.settledHistory.set(`${item.proposalId}:${item.tokenId}`, item);
    }
  }

  /**
   * Re-enqueues a batch of ballots after an on-chain execution error or network blip.
   * Increments retryCount and evicts expired or over-retried ballots to dead-letter history.
   */
  public requeueBatch(
    batch: QueuedVote[],
    maxRetries: number = 3,
    errorMessage?: string
  ): { requeued: number; dropped: number } {
    let requeued = 0;
    let dropped = 0;
    const now = BigInt(Math.floor(Date.now() / 1000));

    const toPrepend: QueuedVote[] = [];

    for (const item of batch) {
      item.retryCount = (item.retryCount || 0) + 1;
      item.lastAttemptAt = Date.now();
      if (errorMessage) item.lastError = errorMessage;

      const tokenKey = `${item.proposalId}:${item.tokenId}`;
      const signerKey = `${item.proposalId}:${item.signer.toLowerCase()}`;

      // Check deadline expiration and retry limit
      if (item.deadline <= now || item.retryCount > maxRetries) {
        this.deadLetterHistory.set(tokenKey, item);
        dropped++;
      } else {
        toPrepend.push(item);
        this.queuedTokenKeys.add(tokenKey);
        this.queuedSignerKeys.add(signerKey);
        requeued++;
      }
    }

    // Prepend retried ballots to front of queue to preserve ordering
    this.queue = [...toPrepend, ...this.queue];
    return { requeued, dropped };
  }

  public clear(): void {
    this.queue = [];
    this.queuedTokenKeys.clear();
    this.queuedSignerKeys.clear();
    this.settledHistory.clear();
    this.deadLetterHistory.clear();
  }
}
