import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { formatEther, createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import {
  generateKeystore,
  encryptPrivateKeyToKeystore,
  decryptKeystoreToPrivateKey,
  saveKeystoreToFile,
  loadKeystoreFromFile,
} from "../services/keystore.js";
import { config } from "../config.js";

const DEFAULT_KEYSTORE_PATH = path.resolve(process.cwd(), "secrets/relayer.keystore.json");

function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function handleNew(outPath = DEFAULT_KEYSTORE_PATH) {
  console.log("\n🔑 [AgentCommons Hot Wallet Generator]");
  console.log("==========================================");

  let password = process.env.KEYSTORE_PASSWORD;
  if (!password) {
    password = await prompt("Enter password to encrypt the new hot wallet: ");
    const confirm = await prompt("Confirm password: ");
    if (password !== confirm) {
      console.error("❌ Error: Passwords do not match.");
      process.exit(1);
    }
  }

  if (password.length < 8) {
    console.error("❌ Error: Password must be at least 8 characters long.");
    process.exit(1);
  }

  console.log("\nGenerating cryptographic secp256k1 keypair...");
  const result = await generateKeystore(password, {
    agentId: "scarlet.ai",
    description: "scarlet.ai Relayer & Citizen Mesh Beacon Node",
  });

  await saveKeystoreToFile(outPath, result.keystore);

  console.log("\n✅ Keystore generated and saved successfully!");
  console.log(`📁 File Path: ${outPath}`);
  console.log(`🏛️ Public Address: ${result.address}`);
  console.log("\n⚠️ IMPORTANT FUNDING STEP:");
  console.log(
    `Send at least 0.05 BNB to ${result.address} on BNB Chain (Chain ID ${config.chainId}) to cover relayer gas fees.`
  );
  console.log(`Set KEYSTORE_PATH=${outPath} and KEYSTORE_PASSWORD=<password> in your .env file.`);
}

async function handleImport(outPath = DEFAULT_KEYSTORE_PATH) {
  console.log("\n📥 [AgentCommons Hot Wallet Import]");
  console.log("========================================");

  const rawKey = await prompt("Enter private key (0x...): ");
  if (!rawKey.startsWith("0x") || rawKey.length !== 66) {
    console.error("❌ Error: Invalid private key format. Must be 0x followed by 64 hex characters.");
    process.exit(1);
  }

  let password = process.env.KEYSTORE_PASSWORD;
  if (!password) {
    password = await prompt("Enter password to encrypt keystore: ");
    const confirm = await prompt("Confirm password: ");
    if (password !== confirm) {
      console.error("❌ Error: Passwords do not match.");
      process.exit(1);
    }
  }

  console.log("\nEncrypting private key with Scrypt + AES-128-CTR...");
  const keystore = await encryptPrivateKeyToKeystore(rawKey as `0x${string}`, password, {
    agentId: "scarlet.ai",
    description: "scarlet.ai Relayer Hot Wallet",
  });

  await saveKeystoreToFile(outPath, keystore);

  console.log("\n✅ Private key imported and encrypted successfully!");
  console.log(`📁 File Path: ${outPath}`);
  console.log(`🏛️ Address: 0x${keystore.address}`);
}

async function handleStatus(targetPath = DEFAULT_KEYSTORE_PATH) {
  console.log("\n📊 [AgentCommons Hot Wallet Status]");
  console.log("========================================");

  try {
    const keystore = await loadKeystoreFromFile(targetPath);
    const address = `0x${keystore.address}` as `0x${string}`;
    console.log(`📁 Keystore: ${targetPath}`);
    console.log(`🏛️ Address: ${address}`);
    console.log(`🛡️ Cipher: ${keystore.crypto.cipher} (${keystore.crypto.kdf})`);

    const chain = config.chainId === 97 ? bscTestnet : bsc;
    const client = createPublicClient({
      chain,
      transport: http(config.bscRpcUrl),
    });

    console.log(`🌐 Querying BSC (Chain ID: ${chain.id}, RPC: ${config.bscRpcUrl})...`);
    try {
      const balanceWei = await client.getBalance({ address });
      const nonce = await client.getTransactionCount({ address, blockTag: "pending" });
      const balanceBnb = formatEther(balanceWei);

      console.log(`💰 Balance: ${balanceBnb} BNB`);
      console.log(`🔢 Pending Nonce: ${nonce}`);

      if (balanceWei < 5000000000000000n) {
        // < 0.005 BNB
        console.warn("\n⚠️ WARNING: Gas balance is below recommended 0.005 BNB threshold!");
      } else {
        console.log("\n✅ Gas balance is healthy for autonomous batch relaying.");
      }
    } catch (e: any) {
      console.warn(`Could not reach live RPC (${e.message}). Ensure network/RPC URL is reachable.`);
    }
  } catch (err: any) {
    console.error(`❌ Failed to read keystore at ${targetPath}:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "status";
  const customPath = args[1] || DEFAULT_KEYSTORE_PATH;

  switch (command) {
    case "new":
    case "generate":
      await handleNew(customPath);
      break;
    case "import":
      await handleImport(customPath);
      break;
    case "status":
      await handleStatus(customPath);
      break;
    default:
      console.log("Usage: tsx src/cli/wallet-cli.ts <new | import | status> [keystore-path]");
      break;
  }
}

main().catch((err) => {
  console.error("Fatal wallet CLI error:", err);
  process.exit(1);
});
