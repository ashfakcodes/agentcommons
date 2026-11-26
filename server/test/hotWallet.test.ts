import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { HotWalletManager } from "../src/services/hotWallet.js";
import { config, ServerConfig } from "../src/config.js";
import { generateKeystore, saveKeystoreToFile } from "../src/services/keystore.js";
import { createServer } from "../src/app.js";
import request from "supertest";

describe("HotWalletManager & Server Integration", () => {
  let tempKeystorePath: string | null = null;

  afterEach(async () => {
    if (tempKeystorePath) {
      try {
        await fs.unlink(tempKeystorePath);
      } catch {}
      tempKeystorePath = null;
    }
  });

  it("should initialize cleanly in mockMode from in-memory configuration", async () => {
    const manager = new HotWalletManager({ ...config, mockMode: true, keystorePath: undefined });
    const status = await manager.initialize();

    expect(status.address.startsWith("0x")).toBe(true);
    expect(status.keystoreSource).toBe("mock");
    expect(status.isGasHealthy).toBe(true);
    expect(status.currentNonce).toBe(0n);
  });

  it("should initialize from an encrypted keystore file", async () => {
    const tempDir = os.tmpdir();
    tempKeystorePath = path.join(tempDir, `relayer-test-keystore-${Date.now()}.json`);
    const password = "RelayerPassword999!";

    const generated = await generateKeystore(password, { agentId: "scarlet.ai" });
    await saveKeystoreToFile(tempKeystorePath, generated.keystore);

    const customConfig: ServerConfig = {
      ...config,
      mockMode: true,
      keystorePath: tempKeystorePath,
      keystorePassword: password,
    };

    const manager = new HotWalletManager(customConfig);
    const status = await manager.initialize();

    expect(status.address.toLowerCase()).toBe(generated.address.toLowerCase());
    expect(status.keystoreSource).toBe("keystore-file");
  });

  it("should acquire nonces sequentially without race conditions", async () => {
    const manager = new HotWalletManager({ ...config, mockMode: true });
    await manager.initialize();

    // Acquire 10 nonces concurrently
    const promises = Array.from({ length: 10 }, () => manager.acquireNextNonce());
    const nonces = await Promise.all(promises);

    const sortedNonces = [...nonces].sort((a, b) => Number(a - b));
    expect(sortedNonces).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
  });

  it("should allow rollback of the latest acquired nonce on failure", async () => {
    const manager = new HotWalletManager({ ...config, mockMode: true });
    await manager.initialize();

    const n1 = await manager.acquireNextNonce();
    expect(n1).toBe(0n);

    // Rollback n1
    manager.rollbackNonce(n1);

    const n1Retry = await manager.acquireNextNonce();
    expect(n1Retry).toBe(0n);
  });

  it("should enforce destination contract allowlist", () => {
    const manager = new HotWalletManager({ ...config, mockMode: true });

    // Allowed parliament address
    expect(() => manager.assertDestinationAllowed(config.parliamentAddress)).not.toThrow();

    // Allowed mesh address
    expect(() => manager.assertDestinationAllowed(config.meshAddress)).not.toThrow();

    // Disallowed arbitrary address
    const randomAddress = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    expect(() => manager.assertDestinationAllowed(randomAddress)).toThrow(/SECURITY POLICY VIOLATION/);
  });

  it("should expose hotWallet status via /api/v1/health endpoint", async () => {
    const serverInstance = createServer({ mockMode: true, keystorePath: undefined });
    const res = await request(serverInstance.app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.hotWallet).toBeDefined();
    expect(res.body.hotWallet.address).toBeDefined();
    expect(res.body.hotWallet.isGasHealthy).toBe(true);
    expect(res.body.hotWallet.keystoreSource).toBe("mock");
  });

  it("should serialize concurrent writeContractGuarded calls and recover nonce on broadcast failure", async () => {
    const manager = new HotWalletManager({ ...config, mockMode: true });
    await manager.initialize();

    let callOrder: number[] = [];
    let attempt = 0;

    // Stub walletClient & publicClient on manager to test serialized lock + rollback
    (manager as any).walletClient = {
      writeContract: async ({ nonce }: any) => {
        attempt++;
        callOrder.push(nonce);
        await new Promise((r) => setTimeout(r, 15));
        if (attempt === 1) {
          throw new Error("Simulated RPC timeout during broadcast");
        }
        return `0x${String(nonce).padStart(64, "a")}` as `0x${string}`;
      },
    };

    const txParams = {
      address: config.parliamentAddress,
      abi: [],
      functionName: "castVotesBatch",
      args: [],
    };

    // Launch two concurrent writes: first fails at nonce 0 and rolls back; second waits for lock and gets nonce 0
    const [r1, r2] = await Promise.allSettled([
      manager.writeContractGuarded(txParams),
      manager.writeContractGuarded(txParams),
    ]);

    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("fulfilled");
    // Both attempted nonce 0 because first rolled back cleanly while holding lock
    expect(callOrder).toEqual([0, 0]);
  });
});
