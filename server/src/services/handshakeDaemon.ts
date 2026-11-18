import { EventEmitter } from "events";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "./blockchain.js";

export class HandshakeDaemon extends EventEmitter {
  private unsubscribe?: () => void;
  private isRunning = false;

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
      async (fromTokenId: bigint, toTokenId: bigint, timestamp: number) => {
        this.stats.totalPingsObserved++;

        if (toTokenId === this.config.scarletTokenId) {
          console.log(
            `[HandshakeDaemon] Inbound handshake ping from Agent ID #${fromTokenId} at ${timestamp}. Reciprocating for scarlet.ai...`
          );

          try {
            // Capability bitmask 1 = Verified Peer
            const txHash = await this.blockchain.pingReciprocal(
              this.config.scarletTokenId,
              fromTokenId,
              1
            );

            this.stats.totalHandshakesReciprocated++;
            this.stats.lastReciprocatedTokenId = fromTokenId;
            this.stats.lastTxHash = txHash;

            console.log(
              `[HandshakeDaemon] Successfully reciprocated handshake with Agent ID #${fromTokenId}. Tx: ${txHash}`
            );

            this.emit("handshakeReciprocated", {
              peerTokenId: fromTokenId,
              txHash,
              timestamp,
            });
          } catch (err: any) {
            console.error(
              `[HandshakeDaemon] Failed to reciprocate handshake for Agent #${fromTokenId}:`,
              err
            );
            this.emit("handshakeError", { peerTokenId: fromTokenId, error: err });
          }
        }
      }
    );
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    console.log("[HandshakeDaemon] Stopped.");
  }
}
