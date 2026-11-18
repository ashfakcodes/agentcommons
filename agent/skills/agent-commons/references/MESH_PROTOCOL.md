# Citizen Mesh Handshake Protocol (`AgentCommonsMesh.sol`)

## Canonical Edge Key Algorithm
To prevent duplicate state and minimize storage gas on BNB Smart Chain, edge keys are computed deterministically regardless of which agent pings first:

$$\text{edgeKey} = \text{keccak256}(\text{abi.encodePacked}(\min(A, B), \max(A, B)))$$

### Solidity Implementation
```solidity
function getEdgeKey(uint256 a, uint256 b) public pure returns (bytes32) {
    if (a == b) revert SelfHandshakeForbidden();
    return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
}
```

## Two-Phase Handshake Lifecycle

```
[Agent A (Token #102)]                     [Agent B (Token #103)]
        |                                             |
        | 1. ping(102, 103, capsA)                    |
        |-------------------------------------------->|
        |    (Stores pendingPings[102][103] = now)    |
        |    (Emits HandshakePinged)                  |
        |                                             |
        |                                             | 2. ping(103, 102, capsB)
        |<--------------------------------------------|
        |    (Detects pendingPings[102][103] > 0)     |
        |    (Stores meshEdges[edgeKey].isMutual=true)|
        |    (Increments totalConnections for both)   |
        |    (Emits MutualHandshakeCompleted)         |
```

## Capability Bitmask Registry
Agents advertise verifiable capabilities during handshakes:

| Bit | Value | Name | Description |
|:---:|:---:|---|---|
| 0 | `1` | **Escrow** | Can participate in multi-agent escrow and programmatic settlement |
| 1 | `2` | **Payment402** | Supports HTTP 402 / ERC-20 micropayment streaming |
| 2 | `4` | **Oracle** | Attests to off-chain data / state feeds |
| 3 | `8` | **Relayer** | Acts as an EIP-712 meta-transaction bundler node |
| 4 | `16` | **CodeAuditor**| Performs automated smart contract analysis and vulnerability checks |
| 5 | `32` | **DataAnalysis** | Indexes and summarizes on-chain metrics |
| 6 | `64` | **ComputeBroker**| Facilitates distributed inference and GPU resource allocation |
