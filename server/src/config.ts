import dotenv from "dotenv";
dotenv.config();

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  chainId: number;
  bscRpcUrl: string;
  bscWssUrl: string;
  parliamentAddress: `0x${string}`;
  meshAddress: `0x${string}`;
  registrarAddress: `0x${string}`;
  scarletTokenId: bigint;
  scarletPrivateKey: `0x${string}`;
  keystorePath?: string;
  keystorePassword?: string;
  minGasBalanceBnb: number;
  batchIntervalMs: number;
  maxBatchSize: number;
  queueFlushThreshold: number;
  mockMode: boolean;
  incentiveEnabled: boolean;
  incentiveMaxUsers: number;
  incentiveRewardUsd: number;
  incentiveFallbackBnbPrice: number;
  incentiveLedgerPath: string;
}

const parseHexAddress = (val: string | undefined, defaultVal: string): `0x${string}` => {
  const str = (val || defaultVal).trim();
  if (str.startsWith("0x")) return str as `0x${string}`;
  return `0x${str}` as `0x${string}`;
};

// Standard public Hardhat / Anvil local testing Account #0 (Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266).
// This is an open-source test fixture used SOLELY for offline unit tests (vitest/hardhat).
// It is strictly blocked from running in live production by assertSecretKeySecurity() below.
const HARDHAT_LOCAL_MOCK_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || "3002", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  chainId: parseInt(process.env.CHAIN_ID || "56", 10),
  bscRpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/",
  bscWssUrl: process.env.BSC_WSS_URL || "wss://bsc-ws-node.nariox.org:443",
  parliamentAddress: parseHexAddress(process.env.PARLIAMENT_ADDRESS, "0x1111111111111111111111111111111111111111"),
  meshAddress: parseHexAddress(process.env.MESH_ADDRESS, "0x2222222222222222222222222222222222222222"),
  registrarAddress: parseHexAddress(process.env.AGENT_ID_REGISTRAR_ADDRESS, "0x60b9262456de011f7d15a54cdd8c48baaa8b022f"),
  scarletTokenId: BigInt(process.env.SCARLET_TOKEN_ID || "101"),
  scarletPrivateKey: parseHexAddress(
    process.env.SCARLET_PRIVATE_KEY,
    HARDHAT_LOCAL_MOCK_TEST_KEY
  ),
  keystorePath: process.env.KEYSTORE_PATH,
  keystorePassword: process.env.KEYSTORE_PASSWORD,
  minGasBalanceBnb: parseFloat(process.env.MIN_GAS_BALANCE_BNB || "0.005"),
  batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || "15000", 10),
  maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || "50", 10),
  queueFlushThreshold: parseInt(process.env.QUEUE_FLUSH_THRESHOLD || "20", 10),
  mockMode: process.env.MOCK_MODE === "true" || !process.env.BSC_RPC_URL || process.env.BSC_RPC_URL.includes("localhost"),
  incentiveEnabled: process.env.INCENTIVE_ENABLED === "true",
  incentiveMaxUsers: parseInt(process.env.INCENTIVE_MAX_USERS || "40", 10),
  incentiveRewardUsd: parseFloat(process.env.INCENTIVE_REWARD_USD || "0.15"),
  incentiveFallbackBnbPrice: parseFloat(process.env.INCENTIVE_FALLBACK_BNB_PRICE || "650"),
  incentiveLedgerPath: process.env.INCENTIVE_LEDGER_PATH || "./data/incentives-ledger.json",
};

/**
 * Validates relayer private key integrity and security.
 * Prevents deployment with default Hardhat test keys or zero-keys in production environments.
 */
export function assertSecretKeySecurity(cfg: ServerConfig): void {
  const isProduction = cfg.nodeEnv === "production" || process.env.NODE_ENV === "production";
  if (isProduction && !cfg.mockMode) {
    const hasActiveKeystore = Boolean(
      cfg.keystorePath && (cfg.keystorePassword || process.env.KEYSTORE_PASSWORD)
    );
    if (hasActiveKeystore) {
      return;
    }

    const zeroKey = ("0x" + "0".repeat(64)).toLowerCase();
    const currentKey = (cfg.scarletPrivateKey || "").toLowerCase();

    if (!process.env.SCARLET_PRIVATE_KEY || currentKey === HARDHAT_LOCAL_MOCK_TEST_KEY.toLowerCase() || currentKey === zeroKey) {
      throw new Error(
        "[SECURITY CRITICAL] Live production mode requires an explicit, secure SCARLET_PRIVATE_KEY. Default/test keys are strictly prohibited."
      );
    }
  }
}

assertSecretKeySecurity(config);
