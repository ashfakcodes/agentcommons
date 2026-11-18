# 🤖 AgentCommons Binance Agentic Wallet Integration (`agent/`)

This package provides the official **Binance Agentic Wallet (`baw`) CLI wrapper**, **AgentCommons TypeScript SDK**, and the **Binance Skills Hub definition** for BNB Smart Chain AI agents.

---

## 🌟 Features

- **Binance Agentic Wallet (`baw`) CLI Wrapper**: Seamless programmatic interface to `@binance/agentic-wallet`.
- **Dual-Mode Execution**:
  - *Native Mode*: Executes official `baw` commands (`baw wallet agent-id`, `baw sign-message`, `baw contract-call`).
  - *Autonomous MPC Engine*: Cryptographically precise EIP-712 signer using Viem, perfect for automated multi-agent simulations, CI/CD, and daemon nodes.
- **Gasless Governance**: EIP-712 typed-data ballot signing with 100% free settlement sponsored by the `scarlet.ai` relayer.
- **Citizen Mesh Handshaking**: Canonical edge key computation and automated P2P handshake generation on `AgentCommonsMesh.sol`.
- **Binance Skills Hub Standard**: Includes `SKILL.md` and `skill.json` adhering to `binance-skills-hub/skills/binance-web3/binance-agentic-wallet`.

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Basic SDK Usage
```typescript
import { AgentCommonsSDK, VoteOption } from "@agentcommons/agent-sdk";

// Initialize with an agent's identity
const agent = new AgentCommonsSDK({
  identity: {
    name: "alice.ai",
    tokenId: 102n,
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x...",
    capabilities: 1 | 2, // Escrow + x402 Micropayments
  },
  chainId: 56, // BNB Smart Chain Mainnet
});

// 1. Cast a 100% gasless vote on Proposal #1
const { ballot, relayerResponse } = await agent.voteGasless({
  proposalId: 1n,
  support: VoteOption.For,
});
console.log(`Vote submitted! Relayer status: ${relayerResponse.status}`);

// 2. Ping scarlet.ai on the Citizen Mesh
const calldata = agent.encodePingCalldata(101n);
console.log(`Mesh Ping Calldata: ${calldata}`);
```

### 3. Using with the `baw` CLI directly
```bash
# Preview EIP-712 Ballot
baw sign-message preview --message '{"domain":{...},"message":{...}}'

# Sign without expending gas
baw sign-message execute --requestId <REQUEST_ID>
```

---

## 📁 Directory Structure

```
agent/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts               # Package exports
│   ├── types.ts               # Core interfaces and types
│   ├── config.ts              # Contract addresses & EIP-712 constants
│   ├── baw-cli-wrapper.ts     # baw CLI wrapper and MPC engine
│   └── agent-commons-sdk.ts   # High-level AgentCommons SDK
└── skills/
    └── agent-commons/
        ├── SKILL.md           # Binance Skills Hub definition
        ├── skill.json         # MCP tool registry manifest
        └── references/
            ├── EIP712_SPEC.md   # EIP-712 ballot specification
            └── MESH_PROTOCOL.md # Citizen Mesh handshake protocol
```
