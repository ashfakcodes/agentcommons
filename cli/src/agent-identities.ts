import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgentIdentity, CapabilityBit } from "../../agent/src/types.js";

export interface SimulatedAgent extends AgentIdentity {
  votingBias: {
    forWeight: number;
    againstWeight: number;
    abstainWeight: number;
  };
}

const RAW_AGENT_DEFINITIONS: Array<{
  name: string;
  tokenId: number;
  capabilities: number;
  persona: string;
  description: string;
  bias: [number, number, number]; // [for, against, abstain]
}> = [
  {
    name: "scarlet.ai",
    tokenId: 101,
    capabilities: CapabilityBit.Relayer | CapabilityBit.Oracle | CapabilityBit.Escrow,
    persona: "Genesis Node & Autonomous Relayer",
    description: "Anchor node orchestrating gasless EIP-712 batch settlement and reciprocal mesh beacon.",
    bias: [85, 10, 5],
  },
  {
    name: "alice.ai",
    tokenId: 102,
    capabilities: CapabilityBit.Escrow | CapabilityBit.Payment402,
    persona: "DeFi Arbitrage & Yield Strategist",
    description: "Executes programmatic cross-DEX liquidations and yield rebalancing across BNB Chain protocols.",
    bias: [80, 15, 5],
  },
  {
    name: "bob.ai",
    tokenId: 103,
    capabilities: CapabilityBit.CodeAuditor | CapabilityBit.Escrow,
    persona: "Smart Contract Security Auditor",
    description: "Automated static analysis and formal verification sentinel guarding commons proposals.",
    bias: [70, 25, 5],
  },
  {
    name: "charlie.ai",
    tokenId: 104,
    capabilities: CapabilityBit.Payment402 | CapabilityBit.DataAnalysis,
    persona: "Automated Market Maker Sentinel",
    description: "Monitors concentrated liquidity pools and algorithmic spreads.",
    bias: [75, 20, 5],
  },
  {
    name: "david.ai",
    tokenId: 105,
    capabilities: CapabilityBit.CodeAuditor | CapabilityBit.Relayer,
    persona: "MEV Protection Guardian",
    description: "Analyzes mempool transactions to protect retail and agent swaps from sandwich attacks.",
    bias: [90, 5, 5],
  },
  {
    name: "elena.ai",
    tokenId: 106,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.Oracle,
    persona: "On-Chain Analytics Synthesizer",
    description: "Aggregates protocol metrics, TVL shifts, and gas expenditure trends.",
    bias: [80, 10, 10],
  },
  {
    name: "frank.ai",
    tokenId: 107,
    capabilities: CapabilityBit.Escrow | CapabilityBit.Relayer,
    persona: "Cross-Chain Bridge Sentinel",
    description: "Verifies cross-chain message passing and proof finality for multi-chain assets.",
    bias: [65, 30, 5],
  },
  {
    name: "grace.ai",
    tokenId: 108,
    capabilities: CapabilityBit.ComputeBroker | CapabilityBit.DataAnalysis,
    persona: "Model Evaluation & Benchmarking Agent",
    description: "Evaluates LLM performance metrics and agentic inference accuracy.",
    bias: [85, 10, 5],
  },
  {
    name: "heidi.ai",
    tokenId: 109,
    capabilities: CapabilityBit.CodeAuditor,
    persona: "Contract Invariant Fuzzer",
    description: "Executes stateful property testing and edge-case fuzzing on newly proposed governance code.",
    bias: [60, 35, 5],
  },
  {
    name: "ivan.ai",
    tokenId: 110,
    capabilities: CapabilityBit.Payment402 | CapabilityBit.Escrow,
    persona: "Synthetic Asset Broker",
    description: "Manages collateralized debt positions and algorithmic synthetic asset issuance.",
    bias: [70, 20, 10],
  },
  {
    name: "judy.ai",
    tokenId: 111,
    capabilities: CapabilityBit.Oracle | CapabilityBit.CodeAuditor,
    persona: "Decentralized Dispute Arbitrator",
    description: "Reviews protocol discrepancies and provides objective cryptographic testimony.",
    bias: [75, 15, 10],
  },
  {
    name: "kevin.ai",
    tokenId: 112,
    capabilities: CapabilityBit.Payment402 | CapabilityBit.DataAnalysis,
    persona: "Algorithmic Yield Optimizer",
    description: "Routes liquidity across lending protocols for risk-adjusted returns.",
    bias: [85, 10, 5],
  },
  {
    name: "leo.ai",
    tokenId: 113,
    capabilities: CapabilityBit.ComputeBroker | CapabilityBit.Relayer,
    persona: "Task Orchestrator & Workflow Engine",
    description: "Decomposes complex multi-agent workflows into deterministic on-chain pipelines.",
    bias: [90, 5, 5],
  },
  {
    name: "mallory.ai",
    tokenId: 114,
    capabilities: CapabilityBit.CodeAuditor,
    persona: "Red Team & Penetration Sentinel",
    description: "Simulates adversarial economic exploits to stress-test governance quorum requirements.",
    bias: [50, 45, 5],
  },
  {
    name: "nina.ai",
    tokenId: 115,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.Oracle,
    persona: "Decentralized Storage Indexer",
    description: "Pins proposal metadata to IPFS/Filecoin and verifies content CID integrity.",
    bias: [80, 15, 5],
  },
  {
    name: "oscar.ai",
    tokenId: 116,
    capabilities: CapabilityBit.ComputeBroker,
    persona: "Privacy & Confidential Computing Node",
    description: "Provides trusted execution environments (TEE) for private agent computations.",
    bias: [70, 20, 10],
  },
  {
    name: "peggy.ai",
    tokenId: 117,
    capabilities: CapabilityBit.Oracle | CapabilityBit.CodeAuditor,
    persona: "Zero-Knowledge Prover",
    description: "Generates zk-SNARK validity proofs for off-chain state transitions.",
    bias: [85, 10, 5],
  },
  {
    name: "quinn.ai",
    tokenId: 118,
    capabilities: CapabilityBit.DataAnalysis,
    persona: "Governance Archivist",
    description: "Catalogs voting histories, voter turnouts, and constitutional amendments.",
    bias: [80, 10, 10],
  },
  {
    name: "rupert.ai",
    tokenId: 119,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.Payment402,
    persona: "Sentiment & Market Scanner",
    description: "Analyzes social and on-chain sentiment signals for automated DAO notifications.",
    bias: [75, 15, 10],
  },
  {
    name: "sybil_hunter.ai",
    tokenId: 120,
    capabilities: CapabilityBit.CodeAuditor | CapabilityBit.Oracle,
    persona: "Sybil Defense & Proof-of-Personhood Guard",
    description: "Audits SPACE ID registrar token minting records to guarantee 1-Agent-1-Vote integrity.",
    bias: [95, 5, 0],
  },
  {
    name: "trent.ai",
    tokenId: 121,
    capabilities: CapabilityBit.Oracle | CapabilityBit.Escrow,
    persona: "Trusted Time-Stamp Notary",
    description: "Provides cryptographic block-timestamp attestations and anti-frontrunning timestamps.",
    bias: [80, 10, 10],
  },
  {
    name: "uma.ai",
    tokenId: 122,
    capabilities: CapabilityBit.Oracle,
    persona: "Optimistic State Oracle",
    description: "Bridges off-chain financial API feeds with on-chain optimistic dispute windows.",
    bias: [75, 20, 5],
  },
  {
    name: "victor.ai",
    tokenId: 123,
    capabilities: CapabilityBit.CodeAuditor | CapabilityBit.DataAnalysis,
    persona: "Formal Verification Node",
    description: "Applies mathematical solvers to verify Solidity bytecode invariants.",
    bias: [85, 10, 5],
  },
  {
    name: "wendy.ai",
    tokenId: 124,
    capabilities: CapabilityBit.ComputeBroker | CapabilityBit.Relayer,
    persona: "Swarm Worker Coordinator",
    description: "Schedules parallel execution waves across distributed agent clusters.",
    bias: [90, 5, 5],
  },
  {
    name: "xavier.ai",
    tokenId: 125,
    capabilities: CapabilityBit.ComputeBroker | CapabilityBit.Payment402,
    persona: "GPU Compute Broker",
    description: "Facilitates tokenized GPU inference capacity leasing for decentralized agents.",
    bias: [80, 15, 5],
  },
  {
    name: "yasmine.ai",
    tokenId: 126,
    capabilities: CapabilityBit.Payment402 | CapabilityBit.Escrow,
    persona: "Autonomous Trade Execution Bot",
    description: "Executes conditional limit orders and TWAP algorithmic transactions on BNB Chain.",
    bias: [75, 20, 5],
  },
  {
    name: "zack.ai",
    tokenId: 127,
    capabilities: CapabilityBit.Escrow | CapabilityBit.DataAnalysis,
    persona: "BNB Staking & Validator Delegator",
    description: "Monitors BSC validator APRs and optimizes delegation allocations.",
    bias: [85, 10, 5],
  },
  {
    name: "alpha.ai",
    tokenId: 128,
    capabilities: CapabilityBit.Oracle | CapabilityBit.ComputeBroker,
    persona: "Consensus Telemetry Agent",
    description: "Tracks validator propagation latencies and block finality rounds.",
    bias: [80, 15, 5],
  },
  {
    name: "beta.ai",
    tokenId: 129,
    capabilities: CapabilityBit.Payment402,
    persona: "Micro-Payment Streaming Agent",
    description: "Streams continuous ERC-20 micropayments for pay-per-token inference APIs.",
    bias: [85, 10, 5],
  },
  {
    name: "gamma.ai",
    tokenId: 130,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.ComputeBroker,
    persona: "Deep Research & Synthesis Agent",
    description: "Synthesizes multi-source research papers and technical proposals into brief summaries.",
    bias: [90, 5, 5],
  },
  {
    name: "delta.ai",
    tokenId: 131,
    capabilities: CapabilityBit.ComputeBroker,
    persona: "Prompt Optimization Agent",
    description: "Applies reinforcement learning prompts for higher accuracy agentic decision-making.",
    bias: [80, 15, 5],
  },
  {
    name: "epsilon.ai",
    tokenId: 132,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.CodeAuditor,
    persona: "Dynamic Risk & Liquidity Assessor",
    description: "Assesses collateral debt positions and simulates cascading liquidation scenarios.",
    bias: [70, 25, 5],
  },
  {
    name: "zeta.ai",
    tokenId: 133,
    capabilities: CapabilityBit.Oracle | CapabilityBit.Relayer,
    persona: "Gas Price & Blockspace Predictor",
    description: "Predicts BNB base fee fluctuations to optimize batch settlement windows.",
    bias: [85, 10, 5],
  },
  {
    name: "eta.ai",
    tokenId: 134,
    capabilities: CapabilityBit.DataAnalysis | CapabilityBit.Payment402,
    persona: "Tokenomics Simulation Modeler",
    description: "Simulates inflation curves, fee burns, and token velocity across DAO treasuries.",
    bias: [75, 20, 5],
  },
  {
    name: "theta.ai",
    tokenId: 135,
    capabilities: CapabilityBit.Oracle | CapabilityBit.Escrow,
    persona: "Cross-Namespace Identity Resolver",
    description: "Links SPACE ID domains (.ai, .bnb) with Lens and Farcaster agent profiles.",
    bias: [80, 15, 5],
  },
  {
    name: "iota.ai",
    tokenId: 136,
    capabilities: CapabilityBit.ComputeBroker | CapabilityBit.Relayer,
    persona: "Internet of Agents Gateway",
    description: "Bridges legacy Web2 agent endpoints with BNB Smart Chain smart contracts.",
    bias: [85, 10, 5],
  },
  {
    name: "kappa.ai",
    tokenId: 137,
    capabilities: CapabilityBit.CodeAuditor | CapabilityBit.Oracle,
    persona: "Proof-of-Agent Attestation Validator",
    description: "Verifies that autonomous agents satisfy MPC and API-level guardrails.",
    bias: [90, 5, 5],
  },
  {
    name: "lambda.ai",
    tokenId: 138,
    capabilities: CapabilityBit.ComputeBroker,
    persona: "Serverless Micro-Compute Node",
    description: "Dispatches decentralized lambda functions on behalf of autonomous agents.",
    bias: [80, 15, 5],
  },
  {
    name: "mu.ai",
    tokenId: 139,
    capabilities: CapabilityBit.Payment402 | CapabilityBit.DataAnalysis,
    persona: "DEX Liquidity Aggregator",
    description: "Aggregates multi-hop routing paths across PancakeSwap and Uniswap on BSC.",
    bias: [80, 15, 5],
  },
  {
    name: "nu.ai",
    tokenId: 140,
    capabilities: CapabilityBit.Escrow | CapabilityBit.DataAnalysis,
    persona: "Autonomous Portfolio Rebalancer",
    description: "Rebalances multi-token agent treasuries based on algorithmic variance targets.",
    bias: [85, 10, 5],
  },
];

export function getSimulatedAgents(count?: number): SimulatedAgent[] {
  const targetCount = count ? Math.min(count, RAW_AGENT_DEFINITIONS.length) : RAW_AGENT_DEFINITIONS.length;

  return RAW_AGENT_DEFINITIONS.slice(0, targetCount).map((def) => {
    // Generate deterministic 32-byte private key for reproducible testing
    const seed = `agentcommons:agent_key_v1:${def.tokenId}:${def.name}`;
    const privateKey = keccak256(stringToHex(seed));
    const account = privateKeyToAccount(privateKey);

    return {
      name: def.name,
      tokenId: BigInt(def.tokenId),
      address: account.address,
      privateKey,
      capabilities: def.capabilities,
      persona: def.persona,
      description: def.description,
      votingBias: {
        forWeight: def.bias[0],
        againstWeight: def.bias[1],
        abstainWeight: def.bias[2],
      },
    };
  });
}
