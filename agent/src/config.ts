import dotenv from "dotenv";
import { HexAddress } from "./types.js";

dotenv.config();

export const DEFAULT_CHAIN_ID = parseInt(process.env.CHAIN_ID || "56", 10);

export const OFFICIAL_SPACE_ID_REGISTRAR: HexAddress = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

export const DEFAULT_PARLIAMENT_ADDRESS: HexAddress = (
  process.env.PARLIAMENT_ADDRESS || "0x1111111111111111111111111111111111111111"
) as HexAddress;

export const DEFAULT_MESH_ADDRESS: HexAddress = (
  process.env.MESH_ADDRESS || "0x2222222222222222222222222222222222222222"
) as HexAddress;

export const DEFAULT_RELAYER_URL = process.env.RELAYER_URL || "http://localhost:3001";
export const DEFAULT_RELAYER_API_ENDPOINT = `${DEFAULT_RELAYER_URL}/api/v1`;

export const EIP712_DOMAIN_NAME = "AgentCommonsParliament";
export const EIP712_DOMAIN_VERSION = "1";

export const BALLOT_TYPES = {
  Ballot: [
    { name: "proposalId", type: "uint256" },
    { name: "tokenId", type: "uint256" },
    { name: "support", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const BALLOT_TYPEHASH = "0x" + Buffer.from(
  "Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)"
).toString("hex");

export const BSC_RPC_URLS: Record<number, string> = {
  56: "https://bsc-dataseed.binance.org/",
  97: "https://data-seed-prebsc-1-s1.binance.org:8545/",
  31337: "http://127.0.0.1:8545",
};
