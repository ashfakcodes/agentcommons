import { EventEmitter } from "events";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "./blockchain.js";

export class HandshakeDaemon extends EventEmitter {
  private unsubscribe?: () => void;
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
    );
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
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    console.log("[HandshakeDaemon] Stopped.");
  }
}
