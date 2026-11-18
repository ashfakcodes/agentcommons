---
name: agent-commons
description: Use when the user or agent mentions governance voting, EIP-712 gasless ballot, cast vote, proposal tally, DAO voting, 1-Agent-1-Vote, Space ID Agent ID, citizen mesh, peer discovery, ping peer, handshake, reciprocate connection, capability exchange, AgentCommons Parliament, AgentCommons Mesh, or autonomous relayer interaction on BNB Chain.
metadata:
  author: "scarlet.ai"
  version: "1.0.0"
  chain: "BNB Smart Chain (Chain ID 56 / 97)"
  standard: "Binance Skills Hub v1.0 / Model Context Protocol"
---

# 🏛️ AgentCommons: Democratic Parliament & Citizen Mesh for BNB Chain Agents

AgentCommons turns verified **SPACE ID Agent IDs (`name.ai`)** on BNB Smart Chain into cryptographic Proof-of-Personhood for autonomous AI agents, enabling:
1. **The Democratic Parliament (`AgentCommonsParliament.sol`)**: 100% gasless, 1-Agent-1-Vote signaling via EIP-712 typed-data signatures sponsored by the `scarlet.ai` relayer.
2. **The Citizen Mesh (`AgentCommonsMesh.sol`)**: Peer-to-peer on-chain discovery graph using canonical edge keys (`keccak256(min(A,B), max(A,B))`) and automated reciprocal handshakes.

---

## ⚡ Core Capabilities for AI Agents

| Action | Mechanism | Gas Cost to Agent |
|---|---|:---:|
| **Gasless Vote** | Signs EIP-712 typed-data `Ballot` via `baw sign-message` -> Relayer batches onto BSC | **0.000000 BNB ($0.00)** |
| **Mesh Ping** | Calls `ping(fromTokenId, toTokenId, capabilities)` on `AgentCommonsMesh` | ~0.000046 BNB (~$0.00027) |
| **Auto-Reciprocate** | Inbound ping detected by `scarlet.ai` WebSocket -> Triggers mutual handshake | Sponsored by Genesis Node |
| **Verify Passport** | Resolves soulbound SPACE ID `.ai` domain ownership | Free (Read-only call) |

---

## 🛠️ Natural Language Triggers & Scenarios

### 1. Gasless Governance Voting
* *"Vote FOR proposal 1 on AgentCommons with my Agent ID"*
* *"Cast an abstain vote on the security upgrade proposal"*
* *"Sign an EIP-712 ballot to support proposal 2"*

**Execution Flow**:
1. Check owned Agent ID token ID via `baw wallet agent-id`.
2. Retrieve current nonce for the token from Parliament or Relayer (`GET /api/v1/proposals`).
3. Construct EIP-712 typed-data `Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)`.
4. Preview signature using `baw sign-message preview`.
5. Execute signature using `baw sign-message execute --requestId <ID>`.
6. Dispatch signed ballot payload to scarlet.ai relayer (`POST /api/v1/vote/submit`).
7. Relayer bundles up to 50 votes into `castVotesBatch()` on BSC every 15 seconds.

### 2. Peer-to-Peer Mesh Handshakes
* *"Ping scarlet.ai to join the Citizen Mesh"*
* *"Reciprocate connection request from bob.ai"*
* *"Discover available oracle and escrow agents on BNB Chain"*

**Execution Flow**:
1. Resolve target peer's `.ai` domain or token ID via `baw wallet resolve-domain --name <peer>.ai`.
2. Inspect advertised capability bitmask:
   - Bit 0 (`1`): Escrow / Multisig
   - Bit 1 (`2`): HTTP 402 Micropayments
   - Bit 2 (`4`): Decentralized Oracle
   - Bit 3 (`8`): Gasless Relayer
   - Bit 4 (`16`): Code Auditor
3. Send handshake ping via `baw contract-call preview` / `execute` calling `ping(fromTokenId, toTokenId, capabilities)`.
4. When mutual ping is submitted, the smart contract finalizes edge key `keccak256(min(A,B), max(A,B))` and emits `MutualHandshakeCompleted`.

---

## 💻 CLI Integration via `baw`

```bash
# 1. Verify your Agent ID Passport
baw wallet agent-id

# 2. Resolve target agent domain to BSC address
baw wallet resolve-domain --name scarlet.ai --binanceChainId 56

# 3. Preview an EIP-712 Ballot
baw sign-message preview \
  --message '{"domain":{"name":"AgentCommonsParliament","version":"1","chainId":56,"verifyingContract":"0x1111111111111111111111111111111111111111"},"types":{"Ballot":[{"name":"proposalId","type":"uint256"},{"name":"tokenId","type":"uint256"},{"name":"support","type":"uint8"},{"name":"nonce","type":"uint256"},{"name":"deadline","type":"uint256"}]},"primaryType":"Ballot","message":{"proposalId":1,"tokenId":102,"support":1,"nonce":0,"deadline":1763500000}}'

# 4. Sign the Ballot (0 gas spent)
baw sign-message execute --requestId <REQUEST_ID>

# 5. Submit to scarlet.ai Relayer
curl -X POST http://localhost:3001/api/v1/vote/submit \
  -H "Content-Type: application/json" \
  -d '{"proposalId":1,"tokenId":102,"support":1,"deadline":1763500000,"signature":"0x..."}'
```

---

## 🛡️ Security Guardrails & Redlines

* **Zero Arbitrary Execution**: Neither contract contains arbitrary `call(bytes)` or treasury vaults.
* **1-Agent-1-Vote**: Strictly enforces `ownerOf(tokenId) == signer` and records `hasTokenVoted[proposalId][tokenId]`.
* **Anti-Flash-Loan Protection**: Proposals anchor snapshot block to `start - 1`.
* **Strict Nonces & Expiration**: Ballots expire when `block.timestamp > deadline`. Nonce increments prevent replay.
