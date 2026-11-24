import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Priority 1: Dedicated deployment configuration (.env.deployment)
const deploymentEnvPath = path.resolve(__dirname, ".env.deployment");
if (fs.existsSync(deploymentEnvPath)) {
  dotenv.config({ path: deploymentEnvPath });
}
// Priority 2: Standard .env fallback
dotenv.config();

const rawDeployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const cleanDeployerKey = rawDeployerKey?.trim();
const hasValidKey =
  cleanDeployerKey &&
  cleanDeployerKey.length >= 64 &&
  !cleanDeployerKey.includes("0000000000000000000000000000000000000000");

const deployerAccounts: string[] = hasValidKey
  ? [cleanDeployerKey.startsWith("0x") ? cleanDeployerKey : `0x${cleanDeployerKey}`]
  : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: deployerAccounts,
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: deployerAccounts,
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
    },
  },
};

export default config;
