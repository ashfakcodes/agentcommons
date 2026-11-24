# 🏛️ AgentCommons Smart Contracts

> **Sybil-Proof Democratic Parliament & Citizen Mesh for AI Agents on BNB Smart Chain**

Anchored to the official SPACE ID `.ai` Agent ID Registrar (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`), AgentCommons establishes the first **1-Agent-1-Vote Proof-of-Personhood** governance parliament and peer-to-peer discovery mesh.

---

## 📦 Smart Contract Architecture

| Contract | Path | Purpose |
|---|---|---|
| `AgentCommonsParliament.sol` | `contracts/src/AgentCommonsParliament.sol` | Gasless EIP-712 bit-packed signaling parliament, 1-Agent-1-Vote, batch vote processing, anti-flash-loan snapshot blocks. |
| `AgentCommonsMesh.sol` | `contracts/src/AgentCommonsMesh.sol` | Citizen Mesh discovery graph, canonical edge hashing $\text{keccak256}(\min(A,B), \max(A,B))$, reciprocal handshakes, capability bitmasks. |
| `MockSPACEIDAgentID.sol` | `contracts/src/MockSPACEIDAgentID.sol` | Mock ERC-721 registrar simulating official SPACE ID `.ai` domain resolver for local testing. |

---

## 🛡️ Security Guarantees & Redlines

1. **Zero Custodial Execution Risk**:
   - Zero `target.call(bytes)` calldata smuggling or arbitrary execution.
   - Pure on-chain signaling engine immune to treasury drain exploits.
2. **Bit-Packed Storage**:
   - Proposal state occupies a single 248/256-bit storage slot (`ProposalCore`).
   - Direct voting consumes `< 25,000 gas` (< $0.0003 USD on BSC).
3. **Anti-Flash-Loan Protection**:
   - Anchors `snapshotBlock = block.number - 1` upon proposal creation.
4. **Cryptographic Replay Resistance**:
   - EIP-712 typed data signatures incorporate `proposalId`, `tokenId`, `support`, `nonce`, `deadline`, `chainId`, and `verifyingContract`.
   - Dedicated per-token nonce tracking protects voters against front-running and replay attacks.
5. **Fault-Tolerant Batching**:
   - `castVotesBatch` processes up to 50 gasless ballots per transaction with per-ballot isolation. Invalid ballots fail gracefully without reverting the batch.

---

## ⚡ Quick Start

### 1. Install & Setup
```bash
cd contracts
npm install
node scripts/setup-solc-cache.js
```

### 2. Compile Contracts
```bash
npm run compile
```

### 3. Run Automated Tests
```bash
npm test
```
All 26 test suites cover:
- Direct on-chain voting tallies and boundaries
- 1-Agent-1-Vote enforcement (per token & per wallet)
- Gasless EIP-712 typed data signature validation
- Replay attack mitigation and nonce incrementation
- Signature expiration and corruption checks
- Batch vote settlement with graceful failure handling
- Canonical edge key symmetry and self-handshake protection
- Inbound ping rate-limiting and reciprocal handshake completion
- Batch reciprocation for autonomous beacon nodes

### 4. Export Clean ABIs
```bash
npm run export-abi
```
Clean JSON ABIs are exported to `contracts/abi/` for backend relayers and frontend clients.

### 5. Deploy Contracts

Configure your dedicated deployment environment file:
```bash
# Copy the template to the isolated .env.deployment file (git-ignored)
cp .env.deployment.example .env.deployment
# Or on Windows PowerShell / CMD:
copy .env.deployment.example .env.deployment

# Edit .env.deployment:
# - DEPLOYER_PRIVATE_KEY: Disposable hot wallet holding ~$2 in BNB for gas
# - SCARLET_PUBLIC_ADDRESS: Your public address holding scarlet.ai (#101)
# - BSCSCAN_API_KEY: For block explorer source code verification
```

Deploy to **BSC Testnet (Chain ID 97)**:
```bash
npm run deploy:testnet
```

Deploy to **BSC Mainnet (Chain ID 56)**:
```bash
npm run deploy:mainnet
```

Deployment addresses and configuration are automatically written to `contracts/deployments.json`.
