# 🛡️ AgentCommons: Comprehensive Security & Cryptography Audit Report

**Target Scope:** Smart Contracts (`AgentCommonsParliament.sol`, `AgentCommonsMesh.sol`, `MockSPACEIDAgentID.sol`), Relayer Server (`server/src`), and Client SDK (`agent/src`, `web/src`).  
**Auditor:** Security & Cryptography Auditor (`@security_reviewer`)  
**Target Networks:** BNB Smart Chain Mainnet (Chain ID 56) / BSC Testnet (Chain ID 97)  
**Date:** November 2026  

---

## 1. Executive Summary & Threat Model

`AgentCommons` implements a 1-Agent-1-Vote gasless governance parliament and a reciprocal peer discovery mesh anchored to SPACE ID Agent ID ERC-721 tokens. The system combines:
1. **On-chain Parliament & Mesh Contracts** (`AgentCommonsParliament.sol`, `AgentCommonsMesh.sol`)
2. **Autonomous Relayer Daemon & REST Gateway** (`scarlet.ai` relayer node)
3. **Client-side EIP-712 Signing Engine** (`AutonomousVotingEngine` / `@binance/agentic-wallet` wrapper)

### Invariant & Threat Model Assessment:
| Security Dimension | Specification Guarantee | Audit Finding | Status |
| :--- | :--- | :--- | :--- |
| **Zero Custody** | Zero arbitrary execution (`target.call`), zero treasury holdings | Contracts contain no fund-holding or arbitrary call hooks | ✅ **PASSED** |
| **Domain Separation** | ChainId & verifyingContract binding | Uses OpenZeppelin `EIP712("AgentCommonsParliament", "1")` | ✅ **PASSED** |
| **Signature Malleability**| Rejection of high-s secp256k1 signatures | Enforced by OpenZeppelin `ECDSA.tryRecover` v5 | ✅ **PASSED** |
| **Replay Protection** | EIP-712 typed nonce validation | Global sequential nonce creates deadlock across parallel proposals | 🔴 **CRITICAL** |
| **Sybil Resistance** | 1-KYC $\rightarrow$ 1-Agent $\rightarrow$ 1-Vote | Secondary market transferability & missing snapshotting bypass 1-Agent-1-Vote | 🔴 **CRITICAL** |
| **Batch Fault Tolerance**| Partial batch failure without reverting | Contract handles failed votes, but relayer drops unconfirmed ballots | 🟠 **HIGH** |
| **Relayer DoS Protection**| IP rate limiting & input sanitization | Rate limiting bypassable via `X-Forwarded-For`; unauth `/flush` & `/ping` | 🟠 **HIGH** |
| **Relayer Censorship** | Autonomous fallbacks | Non-exclusive relayer: agents can call `castVote` or `castVoteBySig` directly | ✅ **PASSED** |

---

## 2. Summary of Findings

| ID | Title | Component | Severity |
| :--- | :--- | :--- | :--- |
| **SEC-01** | Global Sequential Nonce Architecture Causes Invalidation & Stalls Across Parallel Proposals | Contracts / Server | 🔴 **CRITICAL** |
| **SEC-02** | Secondary Market Transferability & Missing Historical Snapshotting Defeat 1-Agent-1-Vote & Flash Loan Immunity | Contracts / Architecture | 🔴 **CRITICAL** |
| **SEC-03** | Server Rate Limiter Bypass via Client-Controlled `X-Forwarded-For` Headers (CWE-290) | Server Middleware | 🟠 **HIGH** |
| **SEC-04** | Economic DoS & Relayer Gas Depletion via Unauthenticated `/vote/flush` and `/mesh/ping` | Server Routes | 🟠 **HIGH** |
| **SEC-05** | Premature Queue Deletion & Ballot Loss on Batch Settlement Failure | Server Relayer Daemon | 🟠 **HIGH** |
| **SEC-06** | Proposal Storage Status Stagnation & Expired Proposal Reporting Causing Daemon Stalls | Contracts / Blockchain Service | 🟠 **HIGH** |
| **SEC-07** | Hardcoded Vote Success Metrics in `LiveBlockchainClient` Ignoring Event Logs | Server Blockchain Service | 🟡 **MEDIUM** |
| **SEC-08** | Asymmetric Capability Mask Overwrite in `AgentCommonsMesh.sol` | Mesh Contract | 🟡 **MEDIUM** |
| **SEC-09** | Total Absence of Quorum Threshold in `getProposalState` | Parliament Contract | 🟡 **MEDIUM** |
| **SEC-10** | Incorrect `BALLOT_TYPEHASH` Hex Encoding in Client SDK Config | Client SDK | 🔵 **LOW** |
| **SEC-11** | Verification of Non-Custodial Architecture & Invariant Enforcement | System Architecture | 🟢 **INFORMATIONAL** |

---

## 3. Detailed Vulnerability Analyses & Mitigations

### 🔴 SEC-01 [CRITICAL]: Global Sequential Nonce Architecture Causes Invalidation & Stalls Across Parallel Proposals

#### Location:
- `contracts/src/AgentCommonsParliament.sol`: Lines 55, 177-180, 227-237, 284-287
- `server/src/routes/vote.ts`: Lines 143-159
- `server/src/services/queue.ts`: Lines 16-28

#### Description:
In `AgentCommonsParliament.sol`, nonces are tracked via a single global mapping:
```solidity
mapping(uint256 => uint256) public nonces; // token ID -> nonce
```
This nonce is incremented whenever a vote or proposal is signed by that token.
Furthermore, in `_processBatchVote`:
```solidity
uint256 currentNonce = nonces[_tokenId];
bytes32 structHash = keccak256(
    abi.encode(BALLOT_TYPEHASH, _proposalId, _tokenId, _support, currentNonce, _deadline)
);
```
The batch function does **not** accept a voter's signed nonce—it reads `currentNonce` from contract storage.

#### Exploit Scenario:
1. Agent Alice owns Token `#101`. On-chain `nonces[101] = 0`.
2. Alice evaluates Proposal #1 and Proposal #2 simultaneously.
3. Alice queries `/api/v1/vote/status` for Proposal #1 (nonce 0) and signs Ballot #1.
4. Alice queries `/api/v1/vote/status` for Proposal #2. The server reports `currentNonce = 1` (`effectiveNonce = onChainNonce + pendingInQueue`). Alice signs Ballot #2 with `nonce = 1`.
5. Alice submits Ballot #2 to `POST /api/v1/vote/submit`.
   - `vote.ts` line 147 executes:
   ```typescript
   const onChainNonce = await blockchain.getNonces(tId); // returns 0
   if (ballotNonce !== onChainNonce) { // 1 !== 0
       selfCorrectingError(res, 400, { code: "STALE_NONCE", ... }); // REJECTED!
   }
   ```
   **Result:** Alice is blocked from queuing votes on Proposal #2 while Proposal #1 is pending.
6. Conversely, if Alice signs Ballot #2 with `nonce = 0`:
   - Both ballots enter the queue.
   - Relayer flushes Proposal #1. On-chain `nonces[101]` increments from 0 to 1.
   - Relayer flushes Proposal #2. `_processBatchVote` hashes with `currentNonce = 1`. But Ballot #2 was signed over `nonce = 0`!
   - `tryRecover` recovers a mismatching address; `actualOwner != signer` triggers, and Ballot #2 **fails silently on-chain**.

#### Concrete Mitigation:
1. **Remove `nonce` from Ballot EIP-712 struct**: Nonces are redundant for ballots because replay protection is already strictly enforced by `proposalId` and `hasTokenVoted[proposalId][tokenId]`. A ballot signed for Proposal #1 can never be cast twice on Proposal #1 (blocked by `hasTokenVoted`), nor can it be cast on Proposal #2 (blocked by `proposalId` in structHash).
2. If nonces are retained for ballots, scope them per-proposal:
   ```solidity
   mapping(uint256 => mapping(uint256 => uint256)) public proposalNonces; // proposalId => tokenId => nonce
   ```
3. Update `castVotesBatch` to accept `uint256[] calldata _nonces` if nonces are verified.

---

### 🔴 SEC-02 [CRITICAL]: Secondary Market Transferability & Missing Historical Snapshotting Defeat 1-Agent-1-Vote & Flash Loan Immunity

#### Location:
- `contracts/src/AgentCommonsParliament.sol`: Lines 35, 98, 323-324
- `contracts/src/MockSPACEIDAgentID.sol`: Line 12 (`ERC721`)
- `AGENT_COMMONS_ARCHITECTURE_SPEC.md`: Lines 21-23

#### Description:
The protocol relies on the invariant that 1 KYC User = 1 Soulbound Token = 1 Vote.
However:
1. In `AgentCommonsParliament.sol`, `snapshotBlock` is stored in `ProposalCore` (lines 35, 98), but **it is never read or used anywhere else in the contract**.
2. When checking ownership in `_validateAndRecordVote`:
   ```solidity
   address actualOwner = AGENT_ID_REGISTRAR.ownerOf(_tokenId);
   if (actualOwner != _voter) revert NotTokenOwner(_tokenId, _voter, actualOwner);
   ```
   Ownership is checked at the **current block** (`ownerOf(_tokenId)`), not at `snapshotBlock`.
3. Standard SPACE ID `.ai` domains on BSC are standard ERC-721 tokens freely tradable on secondary marketplaces (OpenSea, Element, Binance NFT) and flash-loanable/transferable.

#### Exploit Scenario:
1. **Secondary Market Plutocratic Vote Capture:**
   - Attacker Bob buys 50 `.ai` domain NFTs on Element.
   - Bob cannot vote 50 times from 1 wallet because `hasAddressVoted[proposalId][Bob]` prevents it.
   - Bob simply transfers 1 NFT to each of 50 fresh burner wallets (costing < $0.05 on BSC).
   - Each burner wallet calls `castVote(proposalId, tokenId, support)`.
   - All 50 votes succeed. The attacker captures 50 votes, completely bypassing 1-Agent-1-Vote.
2. **Flash Borrow / Rental Exploitation:**
   - Attacker borrows an un-voted Agent ID token within a flash transaction, casts a direct vote on an active proposal, and returns the token in the same transaction.

#### Concrete Mitigation:
1. Implement historical snapshotting: Use an ERC-721 contract with historical checkpointing (similar to OpenZeppelin `ERC721Votes` `getPastVotes(account, snapshotBlock)`).
2. If using standard SPACE ID, integrate a Soulbound check (verify token transfer is disabled or check a KYC soulbound attestation registry like Binance BAB token / Binance KYC Soulbound token).

---

### 🟠 SEC-03 [HIGH]: Server Rate Limiter Bypass via Client-Controlled `X-Forwarded-For` Headers (CWE-290)

#### Location:
- `server/src/middleware/security.ts`: Lines 86-94
- `server/src/app.ts`: Lines 45-46

#### Description:
The in-memory rate limiter identifies clients using:
```typescript
const keyGenerator = options.keyGenerator ?? ((req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
});
```
Because Express is not configured with `app.set("trust proxy", true)` with defined reverse proxy CIDRs, any client can attach a spoofed `X-Forwarded-For` header containing an arbitrary IP.

#### Exploit Scenario:
An attacker scripts a bot that sends 100,000 requests per minute to `POST /api/v1/vote/submit` by appending a randomized header:
```http
X-Forwarded-For: 10.0.0.1
X-Forwarded-For: 10.0.0.2
...
```
Each request generates a unique cache key in `hits`, completely bypassing the 60 req/min limit.

#### Concrete Mitigation:
1. For authenticated/signed endpoints (`/vote/submit`, `/proposals/publish`), rate limit based on `tokenId` or `signer` address rather than IP.
2. For IP rate limiting, do not trust `x-forwarded-for` unless explicit proxy configurations are verified:
   ```typescript
   const key = req.ip || req.socket.remoteAddress || "127.0.0.1";
   ```

---

### 🟠 SEC-04 [HIGH]: Economic DoS & Relayer Gas Depletion via Unauthenticated `/vote/flush` and `/mesh/ping`

#### Location:
- `server/src/routes/vote.ts`: Lines 373-396 (`POST /api/v1/vote/flush`)
- `server/src/routes/mesh.ts`: Lines 84-124 (`POST /api/v1/mesh/ping`)
- `server/src/app.ts`: Lines 45-46

#### Description:
1. `POST /api/v1/vote/flush` triggers `relayerDaemon.flushQueue()` immediately. It has **no authentication** and **no rate limiter** attached in `app.ts`.
2. `POST /api/v1/mesh/ping` takes `fromTokenId` and `toTokenId` and executes `blockchain.pingReciprocal(from, to, capabilities)` using the relayer's private key (`scarlet.ai`).

#### Exploit Scenario:
1. **Relayer Gas Drain via Unbatched Flush:**
   - Normal operation batches 50 votes into 1 transaction to amortize base transaction gas (21,000 gas + batch overhead).
   - An attacker submits 1 valid vote, then immediately hits `POST /api/v1/vote/flush`.
   - The relayer submits an on-chain transaction for a batch of 1 vote.
   - The attacker repeats this 1,000 times, forcing the relayer to pay 1,000 individual transaction fees instead of 20 batched transactions, exhausting `scarlet.ai`'s BNB balance.
2. **Arbitrary Relayer Pings:**
   - An attacker calls `POST /api/v1/mesh/ping` with `{ fromTokenId: 101, toTokenId: <target> }`.
   - The server broadcasts an on-chain transaction from `scarlet.ai`, paying gas without any authorization from the user.

#### Concrete Mitigation:
1. Restrict `POST /api/v1/vote/flush` to authenticated administrative sessions or execute flushes strictly via internal timers (`RelayerDaemon`).
2. Require EIP-712 signed authorization for `POST /api/v1/mesh/ping` or restrict outbound relaying.

---

### 🟠 SEC-05 [HIGH]: Premature Queue Deletion & Ballot Loss on Batch Settlement Failure

#### Location:
- `server/src/services/relayerDaemon.ts`: Lines 76, 110-114
- `server/src/services/queue.ts`: Lines 81-86

#### Description:
In `RelayerDaemon.flushQueue()`:
```typescript
const batchItem = this.queue.dequeueBatch(this.config.maxBatchSize);
...
try {
  const result = await this.blockchain.castVotesBatch(...);
  ...
} catch (err: any) {
  console.error(`[RelayerDaemon] Error settling batch:`, err);
  this.emit("batchError", { proposalId, error: err });
  break; // Stop draining
}
```
In `BallotQueue.dequeueBatch()`, ballots are deleted from `this.queue` and inserted into `this.settledHistory` **before** `castVotesBatch` is sent or confirmed on-chain.

#### Exploit Scenario:
If `castVotesBatch` reverts (due to relayer out-of-gas, temporary RPC disruption, or proposal closing between enqueue and flush), the entire batch of up to 50 ballots is **permanently discarded** from `this.queue` and will never be retried. Furthermore, `getVoteRecord` falsely reports them as settled.

#### Concrete Mitigation:
Implement a 2-stage queue lifecycle:
1. Move dequeued items to an `inFlight` state.
2. Only commit to `settledHistory` and delete from `inFlight` when the transaction receipt confirms success.
3. If the transaction fails or reverts, re-enqueue ballots or discard only the expired items.

---

### 🟠 SEC-06 [HIGH]: Proposal Storage Status Stagnation & Expired Proposal Reporting Causing Daemon Stalls

#### Location:
- `contracts/src/AgentCommonsParliament.sol`: Lines 39, 102, 356-367
- `server/src/services/blockchain.ts`: Lines 168-204

#### Description:
In `AgentCommonsParliament.sol`:
- `proposals[id].status` is initialized to `ProposalStatus.Active` (1) upon creation.
- **`proposals[id].status` is never updated in storage thereafter.**
- Real-time status is calculated purely inside the view function `getProposalState(_proposalId)`.
However, in `LiveBlockchainClient.getProposal`:
```typescript
const core = await this.publicClient.readContract({
  address: this.config.parliamentAddress,
  abi: ParliamentAbi,
  functionName: "proposals", // Reads storage slot directly
  args: [proposalId],
});
...
status: statusMap[core.status], // Always reports "Active"
statusCode: Number(core.status), // Always 1
```

#### Exploit Scenario:
1. Proposal #1 reaches `endBlock` and expires.
2. `blockchain.getProposal(1)` still reports `statusCode: 1` ("Active").
3. Voters call `POST /api/v1/vote/submit`. The server allows votes to be enqueued because it believes the proposal is active.
4. When `flushQueue()` attempts to settle on-chain, `AgentCommonsParliament.sol` reverts with `ProposalNotActive(1)`.
5. The relayer daemon logs an error and halts queue processing (`break;`), stalling subsequent batches.

#### Concrete Mitigation:
Update `LiveBlockchainClient.getProposal` to call `parliament.getProposalState(proposalId)` or compute status comparing `currentBlock` with `endBlock`.

---

### 🟡 SEC-07 [MEDIUM]: Hardcoded Vote Success Metrics in `LiveBlockchainClient` Ignoring Event Logs

#### Location:
- `server/src/services/blockchain.ts`: Lines 245-266

#### Description:
In `LiveBlockchainClient.castVotesBatch`:
```typescript
const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
let successfulVotes = tokenIds.length;
let failedVotes = 0;
// Event parsing is commented out / stubbed
return {
  txHash: hash,
  proposalId,
  batchSize: tokenIds.length,
  successfulVotes,
  failedVotes,
};
```
Even if all 50 votes in a batch fail signature verification on-chain (`_processBatchVote` returns `false`), `successfulVotes` is returned as 50 and `failedVotes` as 0.

#### Concrete Mitigation:
Parse the emitted `BatchVotesSettled(uint256 proposalId, uint256 successfulVotes, uint256 failedVotes)` event from `receipt.logs` using viem's `decodeEventLog`.

---

### 🟡 SEC-08 [MEDIUM]: Asymmetric Capability Mask Overwrite in `AgentCommonsMesh.sol`

#### Location:
- `contracts/src/AgentCommonsMesh.sol`: Lines 80-90

#### Description:
When Agent A initiates a ping to Agent B, Agent A provides `_capabilities`. However, `pendingPings` only stores the timestamp:
```solidity
pendingPings[_fromTokenId][_toTokenId] = uint32(block.timestamp);
```
When Agent B reciprocates, the edge is created:
```solidity
meshEdges[edgeKey] = HandshakeEdge({
    establishedAt: uint32(block.timestamp),
    capabilityMask: _capabilities, // Strictly Agent B's capabilities!
    isMutual: true
});
```
Agent A's advertised capabilities are completely ignored and overwritten by Agent B.

#### Concrete Mitigation:
Store capabilities of both parties or combine them using a bitwise AND / OR mask.

---

### 🟡 SEC-09 [MEDIUM]: Total Absence of Quorum Threshold in `getProposalState`

#### Location:
- `contracts/src/AgentCommonsParliament.sol`: Lines 356-367

#### Description:
`getProposalState` evaluates outcome as:
```solidity
return p.forVotes > p.againstVotes ? ProposalStatus.Succeeded : ProposalStatus.Defeated;
```
If a proposal receives 1 For vote and 0 Against votes in a community of 10,000 agents, the proposal is marked as `Succeeded`.

#### Concrete Mitigation:
Enforce a minimum quorum requirement:
```solidity
uint32 totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
if (totalVotes < MIN_QUORUM) return ProposalStatus.Defeated;
```

---

### 🔵 SEC-10 [LOW]: Incorrect `BALLOT_TYPEHASH` Hex Encoding in Client SDK Config

#### Location:
- `agent/src/config.ts`: Lines 34-36, 50-52

#### Description:
`BALLOT_TYPEHASH` and `PROPOSAL_TYPEHASH` are defined as:
```typescript
export const BALLOT_TYPEHASH = "0x" + Buffer.from(
  "Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)"
).toString("hex");
```
This is the raw ASCII hex encoding of the type signature, not the Keccak-256 hash. Any external agent relying on this constant rather than viem's internal hashing will compute an invalid digest.

#### Concrete Mitigation:
```typescript
import { keccak256, toHex } from "viem";
export const BALLOT_TYPEHASH = keccak256(
  toHex("Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)")
);
```

---

### 🟢 SEC-11 [INFORMATIONAL]: Verification of Non-Custodial Architecture & Invariant Enforcement

#### Assessment:
- **Custody Risk:** 0%. No ETH/BNB or ERC-20 token transfer or escrow hooks exist in `AgentCommonsParliament.sol` or `AgentCommonsMesh.sol`.
- **Arbitrary Execution:** 0%. No `target.call{value: ...}(calldata)` primitives exist. Calldata injection or treasury drain is architecturally impossible.
- **Private Key Custody:** Local EIP-712 signing only. Private keys never touch the relayer or transmission payloads.
- **Relayer Censorship Resistance:** High on-chain neutrality. Any agent can bypass an unresponsive or censoring relayer by calling `castVote` directly (< 25,000 gas) or submitting `castVoteBySig` via an alternate relayer.

---

## 4. Conclusion & Prioritized Action Plan

To ensure maximum security and resilience for the BNB Chain hackathon submission and mainnet operation:

1. **Immediate P0 Patch:** Address **SEC-01** by removing the redundant `nonce` from Ballot EIP-712 typing or scoping it per-proposal, and fixing the `STALE_NONCE` check in `vote.ts`.
2. **Immediate P0 Patch:** Address **SEC-05** and **SEC-06** in `relayerDaemon.ts` and `blockchain.ts` to ensure expired proposals do not crash the batch queue, and failed transactions do not cause silent ballot drops.
3. **P1 Security Hardening:** Address **SEC-03** and **SEC-04** by binding rate limits to token IDs/signers and restricting `/flush` and `/ping` endpoints.
4. **Protocol Advisory:** Document the secondary market transferability caveat (**SEC-02**) and outline roadmap plans for soulbound / KYC attestation anchoring.
