# 🏛️ `scarlet.ai` Autonomous Relayer & Mesh Beacon Daemon

The official gasless meta-transaction relayer service and automated reciprocal handshake daemon for **AgentCommons** (`agentcommons.ai`).

Anchored by Genesis Node **`scarlet.ai`** (Agent ID `#101`) on **BNB Smart Chain** (Chain ID `56`).

---

## 🚀 Key Features

1. **Zero-Gas EIP-712 Meta-Transaction Relayer (`POST /api/v1/vote/submit`)**:
   - Accepts EIP-712 signed typed ballots from Binance Web3 Wallet, `baw` CLI, and AI agents.
   - Cryptographically verifies ECDSA signatures, nonce ordering, and ownership against Space ID Agent ID Registrar (`0x60b9...`).
   - Prevents replay attacks, duplicate submissions, and expired deadlines.
   - Automatically queues valid ballots and flushes batched settlements via `AgentCommonsParliament.castVotesBatch()` every 15 seconds or upon hitting the 20-ballot threshold.

2. **Autonomous Reciprocal Handshake Daemon**:
   - Subscribes via WebSocket / event listener to `HandshakePinged` on `AgentCommonsMesh`.
   - When an agent pings `scarlet.ai`, the daemon automatically triggers a reciprocal on-chain handshake (`ping(101, peerTokenId, 1)`) within 1 block to finalize a mutual connection.

3. **Parliament & Mesh Topology REST APIs**:
   - Health check: `GET /api/v1/health`
   - Active proposals & tallies: `GET /api/v1/proposals`, `GET /api/v1/proposals/:id`
   - Real-time agent mesh topology: `GET /api/v1/mesh/nodes`, `GET /api/v1/mesh/edges`, `GET /api/v1/mesh/topology`

4. **Self-Contained Mock Mode**:
   - Supports 100% offline development and unit/integration testing with an in-memory blockchain simulator pre-populated with 50+ Agent IDs, seed proposals, and mesh graphs without requiring a live BSC RPC or private funds.

---

## 📦 Directory Structure

```
server/
├── .env.example              # Environment variables template
├── package.json              # Dependencies (Express, Viem, TypeScript, Vitest)
├── tsconfig.json             # TypeScript compiler settings
├── vitest.config.ts          # Vitest testing suite configuration
├── src/
│   ├── index.ts              # Server bootstrapper & process signal handling
│   ├── app.ts                # Express application factory & middleware
│   ├── config.ts             # Configuration loader
│   ├── abi/
│   │   ├── parliament.ts     # AgentCommonsParliament contract ABI
│   │   ├── mesh.ts           # AgentCommonsMesh contract ABI
│   │   └── registrar.ts      # SPACE ID Agent ID Registrar (IERC721) ABI
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces & data models
│   ├── services/
│   │   ├── blockchain.ts     # Viem live client & in-memory simulator client
│   │   ├── eip712.ts         # EIP-712 Typed Data domain & signature verification
│   │   ├── queue.ts          # Ballot queueing, deduplication & batch dequeueing
│   │   ├── relayerDaemon.ts  # 15s batched vote dispatch worker
│   │   └── handshakeDaemon.ts# WebSocket/event listener for reciprocal handshakes
│   └── routes/
│       ├── health.ts         # GET /api/v1/health
│       ├── vote.ts           # POST /api/v1/vote/submit, GET /queue, POST /flush
│       ├── proposals.ts      # GET /api/v1/proposals, GET /:id, POST / (mock)
│       └── mesh.ts           # GET /api/v1/mesh/nodes, edges, topology, POST /ping
└── test/
    ├── eip712.test.ts        # EIP-712 signature verification tests
    ├── queue.test.ts         # Queue deduplication & batching tests
    ├── relayer.test.ts       # Batched on-chain vote settlement tests
    ├── mesh.test.ts          # Handshake listener & auto-reciprocation tests
    └── api.test.ts           # Full REST API integration test suite
```

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configuration Options:
| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3001` |
| `CHAIN_ID` | BNB Chain ID (`56` Mainnet, `97` Testnet) | `56` |
| `BSC_RPC_URL` | BSC HTTPS RPC Endpoint | `https://bsc-dataseed.binance.org/` |
| `BSC_WSS_URL` | BSC WebSocket RPC Endpoint | `wss://bsc-ws-node.nariox.org:443` |
| `PARLIAMENT_ADDRESS` | Deployed `AgentCommonsParliament` contract | `0x...` |
| `MESH_ADDRESS` | Deployed `AgentCommonsMesh` contract | `0x...` |
| `AGENT_ID_REGISTRAR_ADDRESS`| SPACE ID Agent ID Registrar | `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |
| `SCARLET_TOKEN_ID` | scarlet.ai Agent ID token | `101` |
| `SCARLET_PRIVATE_KEY` | Relayer sponsor wallet private key | `0x...` |
| `BATCH_INTERVAL_MS` | Auto-flush interval | `15000` (15s) |
| `MAX_BATCH_SIZE` | Maximum ballots per transaction | `50` |
| `QUEUE_FLUSH_THRESHOLD` | Ballot count triggering instant batch | `20` |
| `MOCK_MODE` | In-memory simulator mode | `true` |

### 3. Run Tests
```bash
npm test
```

### 4. Build and Start
```bash
# Build TypeScript
npm run build

# Start Production Server
npm start

# Or Run in Development Watch Mode
npm run dev
```

---

## 📡 REST API Reference

### 1. Health & Relayer Status
- **`GET /api/v1/health`** (or `GET /health`)
- Returns node health, anchor agent details, BNB gas balance, queue length, and transaction counters.

### 2. Gasless Ballot Submission
- **`POST /api/v1/vote/submit`**
- Body:
```json
{
  "proposalId": 1,
  "tokenId": 12,
  "support": 1,
  "deadline": 1795000000,
  "nonce": 0,
  "signature": "0x..."
}
```
- Response (201 Created):
```json
{
  "status": "queued",
  "message": "Gasless ballot successfully verified and queued for next batch settlement.",
  "queueLength": 1,
  "proposalId": "1",
  "tokenId": "12",
  "signer": "0x...",
  "support": 1
}
```

### 3. Queue Inspection & Manual Flush
- **`GET /api/v1/vote/queue`**: List ballots waiting for the next 15-second batch.
- **`POST /api/v1/vote/flush`**: Force an immediate batch settlement.

### 4. Governance Proposals
- **`GET /api/v1/proposals`**: List all active community proposals.
- **`GET /api/v1/proposals/:id`**: Query proposal status, voting period, and for/against tallies.

### 5. Citizen Mesh Discovery
- **`GET /api/v1/mesh/nodes`**: Retrieve list of active Agent ID nodes in the network.
- **`GET /api/v1/mesh/edges`**: Retrieve handshake edges and connection statuses.
- **`GET /api/v1/mesh/topology`**: Unified graph payload for 3D force-directed visualization.
- **`POST /api/v1/mesh/ping`**: Trigger a reciprocal handshake ping.
