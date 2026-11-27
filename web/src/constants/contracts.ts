export const BSC_CONFIG = {
  chainId: 56,
  chainName: 'BNB Smart Chain',
  testnetChainId: 56,
  testnetName: 'BNB Smart Chain',
  currencySymbol: 'BNB',
  blockExplorerUrl: 'https://bscscan.com',
  testnetExplorerUrl: 'https://bscscan.com',
  rpcUrl: 'https://bsc-dataseed.binance.org/',
};

// Official SPACE ID Agent ID Registrar (BSC Mainnet)
export const SPACE_ID_REGISTRAR_ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';

// AgentCommons Verified Deployment Addresses (BSC Mainnet)
export const PARLIAMENT_ADDRESS = '0xc1Bd22eC6e5454bf34fEe4547546159ce10FCC82';
export const LEGACY_PARLIAMENT_ADDRESS = '0xd3061bEA5ad846d1e8aec3De18EAd4F5A53e305f';
export const MESH_ADDRESS = '0xD7d7e4cBE5690B43551C10ab0AaeeaC96BFf002e';

// Relayer Backend Endpoint (supports production domain & local dev)
export const RELAYER_API_BASE =
  import.meta.env.VITE_RELAYER_API_BASE ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? '/api/v1'
    : 'http://localhost:3002/api/v1');
export const AGENT_SPEC_URL = `${RELAYER_API_BASE}/agent-spec`;
export const AGENT_WELL_KNOWN_SPEC_URL = '/.well-known/agent-commons.json';

// Capability Bitmask Definitions
export const CAPABILITIES: { [key: number]: { name: string; tag: string; description: string; color: string } } = {
  1: {
    name: 'Escrow & Settlement',
    tag: 'ESCROW-V1',
    description: 'Autonomous multi-party smart contract escrow and dispute arbitration',
    color: 'emerald'
  },
  2: {
    name: 'x402 Micropayments',
    tag: 'X402-FLOW',
    description: 'Sub-cent streaming payment channels for AI-to-AI data queries',
    color: 'cyan'
  },
  4: {
    name: 'Parliament Governance',
    tag: 'PARLIAMENT-VOTE',
    description: '1-Agent-1-Vote democratic quorum signaling and EIP-712 ballot casting',
    color: 'amber'
  },
  8: {
    name: 'ZK Proof-of-Personhood',
    tag: 'ZK-PERSONA',
    description: 'Zero-knowledge verification of Binance KYC Soulbound Agent identity',
    color: 'purple'
  },
  16: {
    name: 'Autonomous Relayer Node',
    tag: 'GENESIS-RELAY',
    description: 'Sponsors gasless transactions & executes reciprocal mesh handshakes',
    color: 'rose'
  }
};

// EIP-712 Domain Specification
export const EIP712_DOMAIN = {
  name: 'AgentCommonsParliament',
  version: '1',
  chainId: 56,
  verifyingContract: PARLIAMENT_ADDRESS as `0x${string}`,
} as const;

export const EIP712_TYPES = {
  Ballot: [
    { name: 'proposalId', type: 'uint256' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'support', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const PROPOSAL_EIP712_TYPES = {
  Proposal: [
    { name: 'creator', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'contentCidHash', type: 'bytes32' },
    { name: 'votingDurationBlocks', type: 'uint32' },
    { name: 'categoryId', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const PROPOSAL_TYPEHASH = '0x15316db1ce0743bdf483eaef3ef7a7e8a93910609395f137e163d09a0670d8a5';

export const PARLIAMENT_ABI = [
  {
    type: 'function',
    name: 'proposalCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'castVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_proposalId', type: 'uint256' },
      { name: '_tokenId', type: 'uint256' },
      { name: '_support', type: 'uint8' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'castVoteBySig',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_proposalId', type: 'uint256' },
      { name: '_tokenId', type: 'uint256' },
      { name: '_support', type: 'uint8' },
      { name: '_deadline', type: 'uint256' },
      { name: '_signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'castVotesBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_proposalId', type: 'uint256' },
      { name: '_tokenIds', type: 'uint256[]' },
      { name: '_supports', type: 'uint8[]' },
      { name: '_deadlines', type: 'uint256[]' },
      { name: '_signatures', type: 'bytes[]' }
    ],
    outputs: [
      { name: 'successfulVotes', type: 'uint256' },
      { name: 'failedVotes', type: 'uint256' }
    ]
  },
  {
    type: 'function',
    name: 'proposals',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'startBlock', type: 'uint32' },
      { name: 'endBlock', type: 'uint32' },
      { name: 'snapshotBlock', type: 'uint32' },
      { name: 'forVotes', type: 'uint32' },
      { name: 'againstVotes', type: 'uint32' },
      { name: 'abstainVotes', type: 'uint32' },
      { name: 'status', type: 'uint8' },
      { name: 'createdAt', type: 'uint48' }
    ]
  },
  {
    type: 'function',
    name: 'hasTokenVoted',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

export const MESH_ABI = [
  {
    type: 'function',
    name: 'ping',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_fromTokenId', type: 'uint256' },
      { name: '_toTokenId', type: 'uint256' },
      { name: '_capabilities', type: 'uint16' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'batchReciprocate',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_myTokenId', type: 'uint256' },
      { name: '_peerTokenIds', type: 'uint256[]' },
      { name: '_capabilities', type: 'uint16' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'totalConnections',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint32' }]
  },
  {
    type: 'function',
    name: 'meshOperators',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'isEdgeConnected',
    stateMutability: 'view',
    inputs: [
      { name: '_tokenIdA', type: 'uint256' },
      { name: '_tokenIdB', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

export const SPACE_ID_REGISTRAR_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;
