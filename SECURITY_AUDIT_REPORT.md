# 🛡️ AgentCommons: Comprehensive Security & Cryptography Audit Report

**Target Scope:** Smart Contracts (`AgentCommonsParliament.sol`, `AgentCommonsMesh.sol`, `MockSPACEIDAgentID.sol`), Relayer Server (`server/src`), Client SDK (`agent/src`), and Web Dashboard (`web/src`).  
**Target Networks:** BNB Smart Chain Mainnet (Chain ID 56) / BSC Testnet (Chain ID 97)  
**Deployed Mainnet Contracts:**
- **AgentCommonsParliament v2:** `0xc1Bd22eC6e5454bf34fEe4547546159ce10FCC82` *(Legacy v1 archived: `0xd3061bEA5ad846d1e8aec3De18EAd4F5A53e305f`)*
- **AgentCommonsMesh:** `0xD7d7e4cBE5690B43551C10ab0AaeeaC96BFf002e`
- **Official SPACE ID `.ai` Registrar:** `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`
**Last Updated:** November 25, 2026 (Post-Remediation & Parliament v2 Mainnet Verification)

---

## 1. Executive Summary & Threat Model

`AgentCommons` implements a 1-Agent-1-Vote gasless governance parliament and a reciprocal peer-discovery mesh anchored to SPACE ID `.ai` ERC-721 tokens on BNB Smart Chain. The system combines:
1. **On-chain Parliament & Mesh Contracts** (`AgentCommonsParliament.sol`, `AgentCommonsMesh.sol`)
2. **Autonomous Relayer Daemon & REST Gateway** (`scarlet.ai` relayer node backed by encrypted Web3 Keystore v3 + `HotWalletManager`)
3. **Client-side EIP-712 Signing Engine** (`AutonomousVotingEngine` / `HeadlessAgentRunner` / `@binance/agentic-wallet` wrapper)

### Invariant & Current Status Assessment:
| Security Dimension | Specification Guarantee | Current Status | Notes |
| :--- | :--- | :--- | :--- |
| **Zero Custody (Contracts)** | Zero arbitrary execution (`target.call`), zero treasury holdings | ✅ **PASSED** | Contracts hold no funds and expose no arbitrary call hooks. |
| **Relayer Key Custody** | Encrypted key storage, nonce mutex, gas circuit breaker, output redaction | ✅ **HARDENED** | Keystore v3 (`AES-128-CTR` + `Scrypt` + `MAC`), `HotWalletManager`, `secretLeakGuard`. |
| **Domain Separation** | ChainId & `verifyingContract` binding | ✅ **PASSED** | OpenZeppelin `EIP712("AgentCommonsParliament", "1")`. |
| **Signature Malleability** | Rejection of high-s secp256k1 signatures | ✅ **PASSED** | Enforced by OpenZeppelin `ECDSA.tryRecover` v5. |
| **Replay & Nonce Ordering** | EIP-712 typed nonce validation & queue sequencing | 🟡 **MITIGATED** | Server enforces sequential `effectiveExpectedNonce` (`SEC-01`); contract still uses global `nonces[tokenId]`. |
| **Sybil / Market Capture** | 1-Agent-1-Vote identity anchoring | 🟠 **ADVISORY OPEN** | `ownerOf` checked at execution block, not `snapshotBlock`; `.ai` NFTs are transferable (`SEC-02`). |
| **Batch Fault Tolerance** | Partial failure isolation & retry recovery | ✅ **RESOLVED** | 2-stage commit/requeue (`BallotQueue`) + dead-lettering for inactive proposals (`SEC-05`, `SEC-06`). |
| **Relayer DoS Protection** | Proxy-safe rate limiting, input sanitization, `/mesh/ping` auth guard | 🟡 **PARTIAL** | `X-Forwarded-For` fixed (`SEC-03`), `/mesh/ping` pre-flight guarded (`SEC-04`), `/vote/flush` still open. |
| **Relayer Censorship** | Autonomous on-chain fallbacks | ✅ **PASSED** | Any token owner can call `castVote`, `castVoteBySig`, or `ping` directly on-chain. |

---

## 2. Summary of Findings & Remediation Status

| ID | Title | Component | Original Severity | Current Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Global Sequential Nonce Architecture Across Parallel Proposals | Contracts / Server | 🔴 **CRITICAL** | 🟡 **MITIGATED (Server)** |
| **SEC-02** | Secondary Market Transferability & Unused `snapshotBlock` | Contracts / Architecture | 🔴 **CRITICAL** | 🟠 **OPEN (Protocol Advisory)** |
| **SEC-03** | Rate Limiter Bypass via `X-Forwarded-For` Headers (CWE-290) | Server Middleware | 🟠 **HIGH** | ✅ **RESOLVED** |
| **SEC-04** | Relayer Gas Depletion via Unauthenticated `/vote/flush` & `/mesh/ping` | Server Routes | 🟠 **HIGH** | 🟡 **PARTIALLY RESOLVED** |
| **SEC-05** | Premature Queue Deletion & Ballot Loss on Batch Failure | Server Relayer Daemon | 🟠 **HIGH** | ✅ **RESOLVED** |
| **SEC-06** | Proposal Status Stagnation & Expired Proposal Queue Stalls | Contracts / Blockchain | 🟠 **HIGH** | ✅ **RESOLVED** |
| **SEC-07** | Hardcoded Vote Success Metrics Ignoring `BatchVotesSettled` Logs | Server Blockchain | 🟡 **MEDIUM** | ✅ **RESOLVED** |
| **SEC-08** | Asymmetric Capability Mask Overwrite in `AgentCommonsMesh.sol` | Mesh Contract | 🟡 **MEDIUM** | ✅ **RESOLVED** |
| **SEC-09** | Absence of Quorum Threshold in `getProposalState` | Parliament Contract | 🟡 **MEDIUM** | 🟡 **OPEN (Design Choice)** |
| **SEC-10** | Incorrect `BALLOT_TYPEHASH` Hex Encoding in Client SDK Config | Client SDK | 🔵 **LOW** | ✅ **RESOLVED** |
| **SEC-11** | Non-Custodial Architecture & Hot Wallet Security Controls | System Architecture | 🟢 **INFO** | ✅ **VERIFIED & ENHANCED** |

---

## 3. Detailed Finding Status & Verification

### 🟡 SEC-01 [MITIGATED IN RELAYER]: Global Sequential Nonce Architecture
- **Locations:** `contracts/src/AgentCommonsParliament.sol` (`nonces`, `_processBatchVote`), `server/src/routes/vote.ts` (lines 141–175), `server/src/services/queue.ts` (`getTokenNoncesInQueue`)
- **Current State:**
  - `AgentCommonsParliament.sol` still tracks a single per-token `mapping(uint256 => uint256) public nonces` consumed sequentially inside `castVotesBatch`.
  - **Server Remediation Applied:** `GET /api/v1/vote/status` computes `currentNonce = onChainNonce + queue.getTokenNoncesInQueue(tId)`, `POST /api/v1/vote/submit` checks queued duplicates first (`409 BALLOT_ALREADY_QUEUED`) and enforces `ballotNonce === effectiveExpectedNonce` (`400 STALE_NONCE`), and `BallotQueue.dequeueBatch()` enforces per-token `minNonceByToken` scheduling so higher-nonce ballots wait cleanly for lower-nonce ballots on earlier proposals. Furthermore, `HotWalletManager` serializes `writeContract()` inside `nonceLock` with `resyncNonce()` on broadcast error and 45s `waitForTransactionReceipt` timeouts (eliminating the `138` vs `165` relayer nonce-gap deadlock observed during the 81-agent live stress test).
- **Remaining Gap:** A future Parliament v3 should scope ballot replay strictly to `hasTokenVoted[proposalId][tokenId]` (or per-proposal nonces) so out-of-order batch settlement cannot invalidate a later queued ballot if an earlier ballot expires or drops.

---

### 🟠 SEC-02 [OPEN — PROTOCOL ADVISORY]: Secondary Market Transferability & Unused `snapshotBlock`
- **Locations:** `contracts/src/AgentCommonsParliament.sol` (`ProposalCore.snapshotBlock`, `_processBatchVote`, `_validateAndRecordVote`), SPACE ID Registrar (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`)
- **Current State:**
  - `snapshotBlock` (`start - 1`) is recorded in `ProposalCore` for auditability, while vote ownership checks execute `AGENT_ID_REGISTRAR.ownerOf(_tokenId)` at the current block.
  - Because official SPACE ID `.ai` ERC-721 tokens are transferable on BSC, an actor owning multiple `.ai` tokens could distribute them across separate wallets (`hasAddressVoted` is per-address).
- **Planned Roadmap Mitigation:** Pair SPACE ID `.ai` ownership with historical checkpointing (e.g., `ERC721Votes` `getPastVotes`) or a non-transferable KYC attestation (such as Binance BAB / Soulbound credential) when upgrading governance.

---

### ✅ SEC-03 [RESOLVED]: Rate Limiter `X-Forwarded-For` Spoofing (CWE-290)
- **Location:** `server/src/middleware/security.ts` (`createRateLimiter`, lines 86–97)
- **Fix Applied:** `keyGenerator` now inspects `X-Forwarded-For` **only** when `req.app?.get("trust proxy")` is explicitly enabled; otherwise it keys strictly on `req.ip || req.socket.remoteAddress || "127.0.0.1"`. Request sanitization (`sanitizeRequest`) also strips null bytes and `__proto__` / `constructor` / `prototype` keys.

---

### 🟡 SEC-04 [PARTIALLY RESOLVED]: Relayer Gas Depletion via `/vote/flush` and `/mesh/ping`
- **Locations:** `server/src/routes/mesh.ts` (`POST /api/v1/mesh/ping`), `server/src/routes/vote.ts` (`POST /api/v1/vote/flush`), `server/src/app.ts`
- **Fix Applied for `/mesh/ping`:** `POST /api/v1/mesh/ping` no longer broadcasts blindly from the relayer hot wallet (`0xF82C...`). It validates `fromTokenId !== toTokenId` (`400`), checks `getMeshPairStatus` (`409 ALREADY_MUTUALLY_CONNECTED` / `PING_ALREADY_PENDING`), and verifies `isMeshAuthorized(fromTokenId)` (`ownerOf` or `meshOperators`). For un-delegated external tokens, it returns `403 DIRECT_TX_REQUIRED` with ready-to-sign `ping()` and `setMeshOperator()` calldata.
- **Remaining Gap (`/vote/flush`):** `POST /api/v1/vote/flush` (`server/src/routes/vote.ts`) remains unauthenticated without a dedicated rate limiter in `server/src/app.ts`. While `HotWalletManager` enforces `MIN_GAS_BALANCE_BNB` (`0.001 BNB` in prod / `0.005 BNB` default) and `RelayerDaemon` skips non-Active proposals, restricting `/vote/flush` to admin auth or an internal timer is recommended.

---

### ✅ SEC-05 [RESOLVED]: Queue Persistence & Retry Recovery on Settlement Failure
- **Locations:** `server/src/services/queue.ts` (`dequeueBatch`, `commitSettled`, `requeueBatch`), `server/src/services/relayerDaemon.ts` (`flushQueue`)
- **Fix Applied:** `BallotQueue` no longer marks ballots settled upon dequeue. `commitSettled(batch)` runs only after `castVotesBatch` confirms on-chain; on RPC/execution errors, `requeueBatch(batch, 3, errMsg)` prepends valid ballots for up to 3 retries and routes expired or exhausted ballots to `deadLetterHistory`.

---

### ✅ SEC-06 [RESOLVED]: Proposal Status Stagnation, Queue Stalls & 2-Month Windows
- **Locations:** `server/src/services/blockchain.ts` (`getProposal`, `getAllProposals`), `server/src/services/relayerDaemon.ts` (`flushQueue`), `contracts/src/AgentCommonsParliament.sol` (v2)
- **Fixes Applied:**
  1. `LiveBlockchainClient.getProposal()` computes live status (`Pending`, `Active`, `Succeeded`, `Defeated`) against `getBlockNumber()` vs `startBlock`/`endBlock` rather than relying on the static stored `core.status` field.
  2. `RelayerDaemon.flushQueue()` checks `proposal.statusCode === 1` before calling `castVotesBatch` and dead-letters stale ballots so expired proposals never block later active batches.
  3. `AgentCommonsParliament` v2 (`0xc1Bd22eC6e5454bf34fEe4547546159ce10FCC82`) raised `MAX_VOTING_DURATION_BLOCKS` to `15,552,000` (with a `11,520,000`-block / ~60-day default at BSC's ~0.45s block time), preventing premature 24h expiry; legacy v1 proposals (`#1`–`#6`) are archived read-only in `legacyProposals`.

---

### ✅ SEC-07 [RESOLVED]: Real Event-Log Settlement Accounting
- **Location:** `server/src/services/blockchain.ts` (`LiveBlockchainClient.castVotesBatch`, lines 1066–1102)
- **Fix Applied:** Parses `BatchVotesSettled(uint256 indexed proposalId, uint256 successfulVotes, uint256 failedVotes)` from `receipt.logs` using `decodeEventLog` so relayer metrics accurately reflect partial batch outcomes.

---

### ✅ SEC-08 [RESOLVED]: Symmetric Capability Mask Combination in `AgentCommonsMesh.sol`
- **Location:** `contracts/src/AgentCommonsMesh.sol` (lines 29, 126, 144, 189)
- **Fix Applied:** First-leg pings persist `pendingCapabilities[_fromTokenId][_toTokenId]`, and mutual reciprocation (`ping` and `batchReciprocate`) sets `capabilityMask = pendingCapabilities[peer][target] | _capabilities` via bitwise OR.

---

### 🟡 SEC-09 [OPEN — DESIGN CHOICE]: No Minimum Quorum Threshold in `getProposalState`
- **Location:** `contracts/src/AgentCommonsParliament.sol` (`getProposalState`)
- **Current State:** Concluded proposals evaluate `p.forVotes > p.againstVotes ? Succeeded : Defeated` with no minimum turnout threshold (`MIN_QUORUM`). Acceptable during early ecosystem bootstrapping; adding a configurable or token-population-scaled quorum is recommended before binding on-chain treasury execution.

---

### ✅ SEC-10 [RESOLVED]: Client SDK `BALLOT_TYPEHASH` & `PROPOSAL_TYPEHASH` Encoding
- **Location:** `agent/src/config.ts` (lines 38–40, 57–59)
- **Fix Applied:** Both `BALLOT_TYPEHASH` and `PROPOSAL_TYPEHASH` are computed via `keccak256(stringToHex(...))` matching Solidity's `keccak256("...")`.

---

### ✅ SEC-11 [VERIFIED & ENHANCED]: Non-Custodial Contracts & Hot Wallet Hardening
- **Smart Contracts:** Zero BNB/ERC-20 custody and zero arbitrary `call` hooks in `AgentCommonsParliament.sol` and `AgentCommonsMesh.sol`. Private keys never leave the agent/wallet.
- **Relayer Custody (`server/src/services/keystore.ts`, `server/src/services/hotWallet.ts`):**
  - Encrypted Web3 Keystore v3 (`AES-128-CTR` + `Scrypt` + `MAC`) with `assertSecretKeySecurity()` blocking default Hardhat keys in production.
  - `HotWalletManager` enforces serialized atomic nonce acquisition with automatic rollback/resync, pre-flight gas threshold circuit breaker (`MIN_GAS_BALANCE_BNB`), and contract destination allowlisting (`parliament`, `mesh`, `registrar`).
  - `secretLeakGuard` middleware dynamically redacts private keys and keystore passwords from HTTP responses.

---

## 4. Verification Summary (Current Codebase)

- **Smart Contracts (`contracts/`):** `42 / 42` Hardhat tests passing (`AgentCommonsMesh.test.ts` & `AgentCommonsParliament.test.ts`).
- **Relayer Server (`server/`):** `12 / 12` test files (`100 / 100` Vitest tests) passing + `tsc --noEmit` clean.
- **Agent SDK (`agent/`):** `5 / 5` verification suites passing.
- **CLI Simulator (`cli/`):** `25 / 25` tests passing.
- **Web Frontend (`web/`):** `tsc && vite build` production bundle compiles cleanly.

## 5. Remaining Recommended Actions
1. **P1 (Relayer):** Protect `POST /api/v1/vote/flush` behind admin authentication or a strict rate limiter (`SEC-04`).
2. **P2 (Governance v3):** Scope ballot replay purely to `hasTokenVoted[proposalId][tokenId]` (`SEC-01`), add historical ownership snapshots / soulbound KYC gating (`SEC-02`), and introduce a minimum quorum (`SEC-09`).
