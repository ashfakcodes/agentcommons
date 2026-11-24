import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  encryptPrivateKeyToKeystore,
  decryptKeystoreToPrivateKey,
  generateKeystore,
  saveKeystoreToFile,
  loadKeystoreFromFile,
} from "../src/services/keystore.js";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const TEST_PASSWORD = "StrongSecurePassword123!";

describe("KeystoreService (Web3 Keystore v3)", () => {
  let tempKeystorePath: string | null = null;

  afterEach(async () => {
    if (tempKeystorePath) {
      try {
        await fs.unlink(tempKeystorePath);
      } catch {}
      tempKeystorePath = null;
    }
  });

  it("should encrypt a private key into standard Web3 Keystore v3", async () => {
    const keystore = await encryptPrivateKeyToKeystore(TEST_PRIVATE_KEY, TEST_PASSWORD, {
      agentId: "test-agent.ai",
      description: "Test description",
    });

    expect(keystore.version).toBe(3);
    expect(keystore.crypto.cipher).toBe("aes-128-ctr");
    expect(keystore.crypto.kdf).toBe("scrypt");
    expect(keystore.crypto.ciphertext).toBeDefined();
    expect(keystore.crypto.mac).toBeDefined();
    expect(keystore.meta?.agentId).toBe("test-agent.ai");

    const expectedAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
    expect(`0x${keystore.address}`).toBe(expectedAccount.address.toLowerCase());
  });

  it("should decrypt keystore back to exact private key with correct password", async () => {
    const keystore = await encryptPrivateKeyToKeystore(TEST_PRIVATE_KEY, TEST_PASSWORD);
    const decryptedKey = await decryptKeystoreToPrivateKey(keystore, TEST_PASSWORD);

    expect(decryptedKey.toLowerCase()).toBe(TEST_PRIVATE_KEY.toLowerCase());
  });

  it("should reject decryption with incorrect password (MAC mismatch)", async () => {
    const keystore = await encryptPrivateKeyToKeystore(TEST_PRIVATE_KEY, TEST_PASSWORD);

    await expect(
      decryptKeystoreToPrivateKey(keystore, "WrongPassword!")
    ).rejects.toThrow(/MAC mismatch|Invalid keystore password/);
  });

  it("should enforce minimum password length of 8 characters", async () => {
    await expect(
      encryptPrivateKeyToKeystore(TEST_PRIVATE_KEY, "short")
    ).rejects.toThrow(/at least 8 characters/);
  });

  it("should generate a fresh secp256k1 keypair and encrypt it", async () => {
    const result = await generateKeystore(TEST_PASSWORD, { agentId: "genesis.ai" });

    expect(result.address.startsWith("0x")).toBe(true);
    expect(result.privateKey.startsWith("0x")).toBe(true);
    expect(result.keystore.version).toBe(3);

    const decrypted = await decryptKeystoreToPrivateKey(result.keystore, TEST_PASSWORD);
    expect(decrypted.toLowerCase()).toBe(result.privateKey.toLowerCase());
  });

  it("should persist keystore to file and load it back with restrictive permissions", async () => {
    const tempDir = os.tmpdir();
    tempKeystorePath = path.join(tempDir, `test-keystore-${Date.now()}.json`);

    const result = await generateKeystore(TEST_PASSWORD);
    await saveKeystoreToFile(tempKeystorePath, result.keystore);

    const loaded = await loadKeystoreFromFile(tempKeystorePath);
    expect(loaded.address).toBe(result.keystore.address);

    const decrypted = await decryptKeystoreToPrivateKey(loaded, TEST_PASSWORD);
    expect(decrypted.toLowerCase()).toBe(result.privateKey.toLowerCase());
  });
});
