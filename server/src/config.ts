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
  batchIntervalMs: number;
  maxBatchSize: number;
  queueFlushThreshold: number;
  mockMode: boolean;
}

const parseHexAddress = (val: string | undefined, defaultVal: string): `0x${string}` => {
  const str = (val || defaultVal).trim();
  if (str.startsWith("0x")) return str as `0x${string}`;
  return `0x${str}` as `0x${string}`;
};

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || "3001", 10),
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
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  ),
  batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || "15000", 10),
  maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || "50", 10),
  queueFlushThreshold: parseInt(process.env.QUEUE_FLUSH_THRESHOLD || "20", 10),
  mockMode: process.env.MOCK_MODE === "true" || !process.env.BSC_RPC_URL || process.env.BSC_RPC_URL.includes("localhost"),
};
