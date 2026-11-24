import { EventEmitter } from "events";
import { ServerConfig } from "../config.js";
import { BallotQueue } from "./queue.js";
import { IBlockchainClient } from "./blockchain.js";
import { BatchExecutionResult } from "../types/index.js";

export class RelayerDaemon extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;

  public stats = {
    totalBatchesProcessed: 0,
    totalVotesRelayed: 0,
    totalFailedVotes: 0,
    lastBatchTimestamp: 0,
    lastTxHash: "",
  };

  constructor(
    private config: ServerConfig,
    public queue: BallotQueue,
    public blockchain: IBlockchainClient
  ) {
    super();
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(
      `[RelayerDaemon] Starting batch flush timer (every ${this.config.batchIntervalMs / 1000}s, threshold: ${this.config.queueFlushThreshold})`
    );

    this.timer = setInterval(() => {
      this.flushQueue().catch((err) => {
        console.error("[RelayerDaemon] Scheduled flush error:", err);
      });
    }, this.config.batchIntervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[RelayerDaemon] Stopped.");
  }

  /**
   * Called whenever a new vote is enqueued.
   * If the queue reaches the threshold, trigger immediate batch processing.
   */
  public onVoteEnqueued(): void {
    if (this.queue.length >= this.config.queueFlushThreshold) {
      console.log(
        `[RelayerDaemon] Queue threshold hit (${this.queue.length} >= ${this.config.queueFlushThreshold}), triggering immediate flush`
      );
      this.flushQueue().catch((err) => {
        console.error("[RelayerDaemon] Threshold flush error:", err);
      });
    }
  }

  public async flushQueue(): Promise<BatchExecutionResult[]> {
    if (this.isProcessing || this.queue.length === 0) return [];

    this.isProcessing = true;
    const results: BatchExecutionResult[] = [];

    try {
      while (this.queue.length > 0) {
        const batchItem = this.queue.dequeueBatch(this.config.maxBatchSize);
        if (!batchItem || batchItem.batch.length === 0) break;

        const { proposalId, batch } = batchItem;
        console.log(
          `[RelayerDaemon] Processing batch of ${batch.length} ballots for Proposal #${proposalId}...`
        );

        const tokenIds = batch.map((b) => b.tokenId);
        const supports = batch.map((b) => b.support);
        const deadlines = batch.map((b) => b.deadline);
        const signatures = batch.map((b) => b.signature);

        try {
          const result = await this.blockchain.castVotesBatch(
            proposalId,
            tokenIds,
            supports,
            deadlines,
            signatures
          );

          // Mark batch as settled to preserve observable rationales in history
          this.queue.commitSettled(batch);

          this.stats.totalBatchesProcessed++;
          this.stats.totalVotesRelayed += result.successfulVotes;
          this.stats.totalFailedVotes += result.failedVotes;
          this.stats.lastBatchTimestamp = Math.floor(Date.now() / 1000);
          this.stats.lastTxHash = result.txHash;

          console.log(
            `[RelayerDaemon] Batch settled: ${result.successfulVotes} succeeded, ${result.failedVotes} failed. Tx: ${result.txHash}`
          );

          results.push(result);
          this.emit("batchSettled", result, batch);
        } catch (err: any) {
          const errMsg = err.message || String(err);
          console.error(`[RelayerDaemon] Error settling batch for proposal #${proposalId}:`, errMsg);

          // Requeue batch for retry up to 3 attempts, evicting expired or exhausted ballots
          const { requeued, dropped } = this.queue.requeueBatch(batch, 3, errMsg);
          console.log(
            `[RelayerDaemon] Batch recovery: ${requeued} ballots returned to queue for re-attempt, ${dropped} dead-lettered/expired.`
          );

          this.emit("batchError", { proposalId, error: err, requeued, dropped });
          break; // Stop draining if error encountered
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return results;
  }
}
