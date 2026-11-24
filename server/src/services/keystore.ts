import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { keccak256, toHex, hexToBytes, bytesToHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

/**
 * Standard Web3 Ethereum Keystore V3 Specification
 * Compatible with Geth, Foundry, MetaMask, and Ethers/Viem.
 */
export interface KeystoreV3Crypto {
  cipher: "aes-128-ctr" | "aes-256-gcm";
  ciphertext: string;
  cipherparams: {
    iv: string;
  };
  kdf: "scrypt" | "pbkdf2";
  kdfparams: {
    dklen: number;
    salt: string;
    n?: number;
    r?: number;
    p?: number;
    c?: number;
    prf?: string;
  };
  mac: string;
}

export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string;
  crypto: KeystoreV3Crypto;
  description?: string;
  meta?: {
    agentId?: string;
    createdAt?: string;
  };
}

/**
 * Derives a key using standard Scrypt parameters for Web3 keystores.
 */
function deriveScryptKey(
  passwordBuffer: Buffer,
  saltBuffer: Buffer,
  n = 8192, // Light mode for performant node boot, highly secure against brute-force
  r = 8,
  p = 1,
  dklen = 32
): Buffer {
  return crypto.scryptSync(passwordBuffer, saltBuffer, dklen, {
    N: n,
    r,
    p,
    maxmem: 32 * 1024 * 1024,
  });
}

/**
 * Encrypts an Ethereum/BNB private key into a standard Ethereum Keystore V3 JSON object.
 */
export async function encryptPrivateKeyToKeystore(
  privateKey: `0x${string}`,
  password: string,
  meta?: { agentId?: string; description?: string }
): Promise<KeystoreV3> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long for keystore security.");
  }

  const cleanPrivKeyHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  if (cleanPrivKeyHex.length !== 64) {
    throw new Error("Invalid private key length. Expected 32 bytes (64 hex characters).");
  }

  const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
  const address = account.address.slice(2).toLowerCase();

  const passwordBuffer = Buffer.from(password, "utf8");
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  // Scrypt KDF parameters
  const n = 8192;
  const r = 8;
  const p = 1;
  const dklen = 32;

  const derivedKey = deriveScryptKey(passwordBuffer, salt, n, r, p, dklen);

  // Split derived key: first 16 bytes for AES-128-CTR, last 16 bytes for MAC validation
  const encryptionKey = derivedKey.subarray(0, 16);
  const macKey = derivedKey.subarray(16, 32);

  const cipher = crypto.createCipheriv("aes-128-ctr", encryptionKey, iv);
  const privKeyBytes = Buffer.from(cleanPrivKeyHex, "hex");
  const ciphertext = Buffer.concat([cipher.update(privKeyBytes), cipher.final()]);

  // Keystore V3 MAC calculation: keccak256(macKey + ciphertext)
  const macPayload = Buffer.concat([macKey, ciphertext]);
  const mac = keccak256(bytesToHex(macPayload)).slice(2);

  const id = crypto.randomUUID();

  return {
    version: 3,
    id,
    address,
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: {
        iv: iv.toString("hex"),
      },
      kdf: "scrypt",
      kdfparams: {
        dklen,
        salt: salt.toString("hex"),
        n,
        r,
        p,
      },
      mac,
    },
    description: meta?.description || "AgentCommons Hot Wallet Keystore",
    meta: {
      agentId: meta?.agentId,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Decrypts a standard Ethereum Keystore V3 JSON object back into a private key hex.
 */
export async function decryptKeystoreToPrivateKey(
  keystore: KeystoreV3,
  password: string
): Promise<`0x${string}`> {
  if (keystore.version !== 3) {
    throw new Error(`Unsupported keystore version: ${keystore.version}. Expected version 3.`);
  }

  const passwordBuffer = Buffer.from(password, "utf8");
  const kdfparams = keystore.crypto.kdfparams;
  const salt = Buffer.from(kdfparams.salt, "hex");

  let derivedKey: Buffer;
  if (keystore.crypto.kdf === "scrypt") {
    derivedKey = deriveScryptKey(
      passwordBuffer,
      salt,
      kdfparams.n || 8192,
      kdfparams.r || 8,
      kdfparams.p || 1,
      kdfparams.dklen || 32
    );
  } else if (keystore.crypto.kdf === "pbkdf2") {
    const iterations = kdfparams.c || 262144;
    const dklen = kdfparams.dklen || 32;
    derivedKey = crypto.pbkdf2Sync(passwordBuffer, salt, iterations, dklen, "sha256");
  } else {
    throw new Error(`Unsupported KDF algorithm: ${keystore.crypto.kdf}`);
  }

  const macKey = derivedKey.subarray(16, 32);
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");

  // Validate MAC integrity
  const macPayload = Buffer.concat([macKey, ciphertext]);
  const computedMac = keccak256(bytesToHex(macPayload)).slice(2);

  if (computedMac.toLowerCase() !== keystore.crypto.mac.toLowerCase()) {
    throw new Error("Invalid keystore password or corrupt keystore payload (MAC mismatch).");
  }

  if (keystore.crypto.cipher !== "aes-128-ctr") {
    throw new Error(`Unsupported cipher: ${keystore.crypto.cipher}. Expected aes-128-ctr.`);
  }

  const encryptionKey = derivedKey.subarray(0, 16);
  const iv = Buffer.from(keystore.crypto.cipherparams.iv, "hex");

  const decipher = crypto.createDecipheriv("aes-128-ctr", encryptionKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const privateKey = `0x${decrypted.toString("hex")}` as `0x${string}`;

  // Sanity check derived address against keystore address
  const account = privateKeyToAccount(privateKey);
  if (account.address.slice(2).toLowerCase() !== keystore.address.toLowerCase()) {
    throw new Error("Integrity check failed: Decrypted private key does not match keystore address.");
  }

  return privateKey;
}

/**
 * Generates a fresh random secp256k1 keypair and encrypts it into a KeystoreV3.
 */
export async function generateKeystore(
  password: string,
  meta?: { agentId?: string; description?: string }
): Promise<{ address: `0x${string}`; privateKey: `0x${string}`; keystore: KeystoreV3 }> {
  const privateKey = generatePrivateKey();
  const keystore = await encryptPrivateKeyToKeystore(privateKey, password, meta);
  return {
    address: `0x${keystore.address}`,
    privateKey,
    keystore,
  };
}

/**
 * Persists a keystore JSON securely with restrictive POSIX file permissions (0600: read/write owner only).
 */
export async function saveKeystoreToFile(filePath: string, keystore: KeystoreV3): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const content = JSON.stringify(keystore, null, 2);
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}

/**
 * Loads a keystore JSON from a file.
 */
export async function loadKeystoreFromFile(filePath: string): Promise<KeystoreV3> {
  const content = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(content) as KeystoreV3;
  if (parsed.version !== 3 || !parsed.crypto || !parsed.crypto.ciphertext) {
    throw new Error(`File at ${filePath} does not appear to be a valid Web3 Keystore v3 document.`);
  }
  return parsed;
}
