export const BSC_CONFIG = {
  chainId: 56,
  chainName: 'BNB Smart Chain Mainnet',
  testnetChainId: 97,
  testnetName: 'BNB Smart Chain Testnet',
  currencySymbol: 'BNB',
  blockExplorerUrl: 'https://bscscan.com',
  testnetExplorerUrl: 'https://testnet.bscscan.com',
};

// Official SPACE ID Agent ID Registrar (Mainnet)
export const SPACE_ID_REGISTRAR_ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';

// AgentCommons Verified Deployment Addresses
export const PARLIAMENT_ADDRESS = '0x2479e0018596001a17E663f72153573211516eB7';
export const MESH_ADDRESS = '0x0006761E017614dE2882c8152c1e7555B2E83061';

// Relayer Backend Endpoint (with fallback)
export const RELAYER_API_BASE = 'http://localhost:3001/api/v1';

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
  }
] as const;
