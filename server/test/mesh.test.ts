import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";
import { MockBlockchainClient } from "../src/services/blockchain.js";
import { HandshakeDaemon } from "../src/services/handshakeDaemon.js";

describe("HandshakeDaemon", () => {
  it("should automatically reciprocate when an inbound ping targets scarlet.ai", async () => {
    const mockBlockchain = new MockBlockchainClient(config);
    const daemon = new HandshakeDaemon(config, mockBlockchain);

    daemon.start();

    // Inbound ping from peer 20 targeting scarlet.ai (101)
    const peerTokenId = 20n;
    mockBlockchain.simulateInboundPing(peerTokenId, config.scarletTokenId);

    // Wait for event handler microtask
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(daemon.stats.totalPingsObserved).toBe(1);
    expect(daemon.stats.totalHandshakesReciprocated).toBe(1);
    expect(daemon.stats.lastReciprocatedTokenId).toBe(peerTokenId);

    // Check mesh edges to confirm mutual handshake
    const edges = await mockBlockchain.getMeshEdges();
    const mutualEdge = edges.find(
      (e) =>
        (e.nodeA === peerTokenId.toString() && e.nodeB === config.scarletTokenId.toString()) ||
        (e.nodeA === config.scarletTokenId.toString() && e.nodeB === peerTokenId.toString())
    );

    expect(mutualEdge).toBeDefined();
    expect(mutualEdge?.isMutual).toBe(true);

    daemon.stop();
  });

  it("should ignore pings not directed at scarlet.ai", async () => {
    const mockBlockchain = new MockBlockchainClient(config);
    const daemon = new HandshakeDaemon(config, mockBlockchain);

    daemon.start();

    // Ping between peer 15 and peer 16
    mockBlockchain.simulateInboundPing(15n, 16n);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(daemon.stats.totalPingsObserved).toBe(1);
    expect(daemon.stats.totalHandshakesReciprocated).toBe(0);

    daemon.stop();
  });
});
