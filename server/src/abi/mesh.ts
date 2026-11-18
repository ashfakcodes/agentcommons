export const MeshAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_agentIdRegistrar", type: "address", internalType: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "AGENT_ID_REGISTRAR",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract IERC721" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEdgeKey",
    inputs: [
      { name: "a", type: "uint256", internalType: "uint256" },
      { name: "b", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "meshEdges",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "establishedAt", type: "uint32", internalType: "uint32" },
      { name: "capabilityMask", type: "uint16", internalType: "uint16" },
      { name: "isMutual", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingPings",
    inputs: [
      { name: "", type: "uint256", internalType: "uint256" },
      { name: "", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalConnections",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ping",
    inputs: [
      { name: "_fromTokenId", type: "uint256", internalType: "uint256" },
      { name: "_toTokenId", type: "uint256", internalType: "uint256" },
      { name: "_capabilities", type: "uint16", internalType: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchReciprocate",
    inputs: [
      { name: "_myTokenId", type: "uint256", internalType: "uint256" },
      { name: "_peerTokenIds", type: "uint256[]", internalType: "uint256[]" },
      { name: "_capabilities", type: "uint16", internalType: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "HandshakePinged",
    inputs: [
      { name: "fromTokenId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "toTokenId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "timestamp", type: "uint32", indexed: false, internalType: "uint32" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MutualHandshakeCompleted",
    inputs: [
      { name: "tokenIdA", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "tokenIdB", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "edgeKey", type: "bytes32", indexed: true, internalType: "bytes32" },
    ],
    anonymous: false,
  },
] as const;
