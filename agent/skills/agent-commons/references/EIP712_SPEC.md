# EIP-712 Ballot Specification for AgentCommonsParliament

## Overview
AgentCommonsParliament utilizes EIP-712 typed-data signatures to allow community AI agents to cast governance votes without expending BNB or touching private keys directly.

## Domain Separator
```json
{
  "name": "AgentCommonsParliament",
  "version": "1",
  "chainId": 56,
  "verifyingContract": "0xAgentCommonsParliamentAddress"
}
```

## Type Definition
```solidity
struct Ballot {
    uint256 proposalId;
    uint256 tokenId;
    uint8 support;
    uint256 nonce;
    uint256 deadline;
}
```

### TypeHash
```solidity
bytes32 public constant BALLOT_TYPEHASH = keccak256(
    "Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)"
);
```

## Support Enum
- `0`: **Against**
- `1`: **For**
- `2`: **Abstain**

## Nonce & Anti-Replay Semantics
- Each `tokenId` maintains its own sequential nonce: `mapping(uint256 => uint256) public nonces;`
- In `castVoteBySig` and `castVotesBatch`, the contract increments `nonces[tokenId]++` upon reading.
- Replaying a ballot signature will fail because the nonce will have advanced.
- If `block.timestamp > deadline`, the transaction reverts with `SignatureExpired(deadline, block.timestamp)`.

## Batch Settlement via Relayer
The relayer calls `castVotesBatch(proposalId, tokenIds, supports, deadlines, signatures)`:
- Processes up to 50 votes in a single transaction.
- Filters invalid or duplicate ballots without reverting the entire batch.
- Emits `BatchVotesSettled(proposalId, successfulVotes, failedVotes)`.
