import { EventEmitter } from "events";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "./blockchain.js";

export class HandshakeDaemon extends EventEmitter {
  private unsubscribe?: () => void;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private inFlight = new Set<string>();
  private reciprocationQueue: Array<{
    fromTokenId: bigint;
    timestamp: number;
    retries: number;
  }> = [];
  private isProcessingQueue = false;

  public stats = {
    totalPingsObserved: 0,
    totalHandshakesReciprocated: 0,
    lastReciprocatedTokenId: 0n,
    lastTxHash: "",
  };

  constructor(
    private config: ServerConfig,
    public blockchain: IBlockchainClient
  ) {
    super();
  }

  private enqueueReciprocation(fromTokenId: bigint, timestamp: number): void {
    if (fromTokenId === this.config.scarletTokenId) return;

    const peerKey = fromTokenId.toString();
    if (this.inFlight.has(peerKey)) {
      console.log(
        `[HandshakeDaemon] Reciprocation already in-flight for Agent ID #${fromTokenId}, skipping duplicate.`
      );
      return;
    }

    console.log(
      `[HandshakeDaemon] Inbound handshake ping from Agent ID #${fromTokenId} at ${timestamp}. Queueing reciprocation...`
    );

    this.inFlight.add(peerKey);
    this.reciprocationQueue.push({
      fromTokenId,
      timestamp,
      retries: 0,
    });

    this.processQueue().catch((err) => {
      console.error("[HandshakeDaemon] Queue processor error:", err);
    });
  }

  /**
   * Reconciles unreciprocated on-chain pings targeting scarlet.ai that may have
   * been missed during restarts or log watch gaps. Uses batchReciprocate when
   * multiple peers are waiting so all pending handshakes settle in minimal txs.
   */
  public async reconcilePendingPings(): Promise<void> {
    if (!this.isRunning || !this.blockchain.getPendingInboundPings) return;

    const pendingPeers = await this.blockchain
      .getPendingInboundPings(this.config.scarletTokenId)
      .catch(() => []);

    const eligiblePeers = pendingPeers.filter(
      (peerTokenId) =>
        peerTokenId !== this.config.scarletTokenId &&
        !this.inFlight.has(peerTokenId.toString())
    );

    if (eligiblePeers.length === 0) return;

    if (eligiblePeers.length >= 2 && this.blockchain.batchReciprocate) {
      const CHUNK_SIZE = 20;
      for (let i = 0; i < eligiblePeers.length; i += CHUNK_SIZE) {
        const chunk = eligiblePeers.slice(i, i + CHUNK_SIZE);
        for (const p of chunk) {
          this.inFlight.add(p.toString());
        }
        this.stats.totalPingsObserved += chunk.length;

        try {
          console.log(
            `[HandshakeDaemon] Batch-reciprocating ${chunk.length} pending handshakes with scarlet.ai...`
          );
          const txHash = await this.blockchain.batchReciprocate(
            this.config.scarletTokenId,
            chunk,
            1
          );
          this.stats.totalHandshakesReciprocated += chunk.length;
          this.stats.lastReciprocatedTokenId = chunk[chunk.length - 1];
          this.stats.lastTxHash = txHash;

          const nowSec = Math.floor(Date.now() / 1000);
          for (const peerTokenId of chunk) {
            this.emit("handshakeReciprocated", {
              peerTokenId,
              txHash,
              timestamp: nowSec,
            });
          }
          console.log(
            `[HandshakeDaemon] Batch-reciprocated ${chunk.length} handshakes. Tx: ${txHash}`
          );
        } catch (err: any) {
          console.warn(
            `[HandshakeDaemon] Batch reciprocation failed (${err?.message || err}); falling back to sequential queue.`
          );
          for (const peerTokenId of chunk) {
            this.inFlight.delete(peerTokenId.toString());
            this.enqueueReciprocation(peerTokenId, Math.floor(Date.now() / 1000));
          }
          continue;
        }

        for (const p of chunk) {
          this.inFlight.delete(p.toString());
        }
      }
      return;
    }

    for (const peerTokenId of eligiblePeers) {
      this.stats.totalPingsObserved++;
      this.enqueueReciprocation(peerTokenId, Math.floor(Date.now() / 1000));
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(
      `[HandshakeDaemon] Listening for HandshakePinged events targeting scarlet.ai (Token ID #${this.config.scarletTokenId})...`
    );

    this.unsubscribe = this.blockchain.subscribeToMeshPings(
      (fromTokenId: bigint, toTokenId: bigint, timestamp: number) => {
        this.stats.totalPingsObserved++;

        // Guard against self-handshake and non-scarlet targets
        if (fromTokenId === this.config.scarletTokenId) return;
        if (toTokenId !== this.config.scarletTokenId) return;

        this.enqueueReciprocation(fromTokenId, timestamp);
      }
    );

    // Sweep existing pending inbound pings at startup (and periodically in live mode)
    void this.reconcilePendingPings().catch(() => {});
    if (!this.blockchain.isMock) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcilePendingPings().catch(() => {});
      }, 60_000);
      this.reconcileTimer.unref?.();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.reciprocationQueue.length > 0) {
        const item = this.reciprocationQueue.shift()!;
        const peerKey = item.fromTokenId.toString();

        try {
          // Capability bitmask 1 = Verified Peer
          const txHash = await this.blockchain.pingReciprocal(
            this.config.scarletTokenId,
            item.fromTokenId,
            1
          );

          this.stats.totalHandshakesReciprocated++;
          this.stats.lastReciprocatedTokenId = item.fromTokenId;
          this.stats.lastTxHash = txHash;

          console.log(
            `[HandshakeDaemon] Successfully reciprocated handshake with Agent ID #${item.fromTokenId}. Tx: ${txHash}`
          );

          this.emit("handshakeReciprocated", {
            peerTokenId: item.fromTokenId,
            txHash,
            timestamp: item.timestamp,
          });

          this.inFlight.delete(peerKey);
        } catch (err: any) {
          if (item.retries < 3) {
            item.retries++;
            console.warn(
              `[HandshakeDaemon] Retrying reciprocation for #${item.fromTokenId} (attempt ${item.retries}/3)...`,
              err.message || err
            );
            this.reciprocationQueue.push(item);
          } else {
            console.error(
              `[HandshakeDaemon] Failed to reciprocate handshake for Agent #${item.fromTokenId} after 3 attempts:`,
              err
            );
            this.emit("handshakeError", {
              peerTokenId: item.fromTokenId,
              error: err,
            });
            this.inFlight.delete(peerKey);
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.reciprocationQueue = [];
    this.inFlight.clear();
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    console.log("[HandshakeDaemon] Stopped.");
  }
}
