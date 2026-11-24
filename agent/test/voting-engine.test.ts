import { AutonomousVotingEngine } from "../src/voting-engine.js";
import { getSimulatedAgents } from "../../cli/src/agent-identities.js";
import { VoteOption, ProposalCategory } from "../src/types.js";
import { recoverTypedDataAddress, isAddressEqual } from "viem";

export async function testVotingEngine() {
  console.log("🧪 Testing AutonomousVotingEngine (personas, rationale generation, and ballot signing)...");

  const agents = getSimulatedAgents(5);
  const bob = agents[2]; // Bob: Smart Contract Security Auditor

  // 1. Initialize Engine with Security First Persona
  const bobEngine = new AutonomousVotingEngine({
    identity: bob,
    policy: "Security First",
  });

  if (bobEngine.getPolicy() !== "Security First") {
    throw new Error(`Policy mismatch: expected "Security First", got "${bobEngine.getPolicy()}"`);
  }
  console.log(`  ✅ AutonomousVotingEngine initialized for ${bob.name} with policy: ${bobEngine.getPolicy()}`);

  // 2. Evaluate Security Proposal with "Security First" Policy
  const securityProposal = {
    id: 101,
    title: "Parliament Protocol Smart Contract Audit & Formal Verification",
    description: "Commission top-tier security audit and formal verification for all voting contracts.",
    categoryId: ProposalCategory.Security,
  };

  const evalSecurity = await bobEngine.evaluateProposal(securityProposal);
  if (evalSecurity.decision !== VoteOption.For) {
    throw new Error(`Security policy should vote FOR security proposal, got ${evalSecurity.decisionString}`);
  }
  if (evalSecurity.confidence < 0.8) {
    throw new Error(`Expected confidence >= 0.8, got ${evalSecurity.confidence}`);
  }
  if (!evalSecurity.rationale || evalSecurity.rationale.length < 15) {
    throw new Error("Rationale string is missing or too short");
  }
  console.log(`  ✅ "Security First" voted FOR on security proposal with rationale: "${evalSecurity.rationale}"`);

  // 3. Evaluate Risky Proposal with "Security First" Policy
  const riskyProposal = {
    id: 102,
    title: "Emergency Bypass of Rate Limits and Verification Checks",
    description: "Temporarily disable rate limiters and signature validation to increase throughput.",
    categoryId: ProposalCategory.General,
  };

  const evalRisky = await bobEngine.evaluateProposal(riskyProposal);
  if (evalRisky.decision !== VoteOption.Against) {
    throw new Error(`Security policy should vote AGAINST risky proposal, got ${evalRisky.decisionString}`);
  }
  console.log(`  ✅ "Security First" correctly rejected risky proposal: "${evalRisky.rationale}"`);

  // 4. Test "Ecosystem Expansion" Policy
  const charlie = agents[3]; // AMM Sentinel / Liquidity
  const charlieEngine = new AutonomousVotingEngine({
    identity: charlie,
    policy: "Ecosystem Expansion",
  });

  const expansionProposal = {
    id: 103,
    title: "Citizen Mesh Liquidity & Gasless Relayer Subsidy",
    description: "Provide relayer gas subsidies to expand autonomous agent ecosystem and developer adoption.",
    categoryId: ProposalCategory.Ecosystem,
  };

  const evalExpansion = await charlieEngine.evaluateProposal(expansionProposal);
  if (evalExpansion.decision !== VoteOption.For) {
    throw new Error(`Ecosystem policy should vote FOR expansion proposal, got ${evalExpansion.decisionString}`);
  }
  console.log(`  ✅ "Ecosystem Expansion" voted FOR on ecosystem proposal: "${evalExpansion.rationale}"`);

  // 5. Test Nonce Resolution
  const resolvedNonce = await bobEngine.resolveNonce(1);
  if (resolvedNonce < 0n) {
    throw new Error("Resolved nonce cannot be negative");
  }
  console.log(`  ✅ Nonce resolution verified: local nonce tracker is ${resolvedNonce}`);

  // 6. EIP-712 Ballot Signing with Rationale
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
  const ballotPayload = await bobEngine.baw.signBallotDirect(
    {
      proposalId: 101n,
      tokenId: bob.tokenId,
      support: evalSecurity.decision,
      nonce: resolvedNonce,
      deadline,
    },
    bob,
    bobEngine.parliamentAddress,
    56
  );

  if (!ballotPayload.signature || !ballotPayload.signature.startsWith("0x")) {
    throw new Error("Ballot signature failed");
  }

  // Verify ballot signature recovery
  const domain = {
    name: "AgentCommonsParliament",
    version: "1",
    chainId: 56,
    verifyingContract: bobEngine.parliamentAddress,
  };

  const ballotTypes = {
    Ballot: [
      { name: "proposalId", type: "uint256" },
      { name: "tokenId", type: "uint256" },
      { name: "support", type: "uint8" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const recoveredVoter = await recoverTypedDataAddress({
    domain,
    types: ballotTypes,
    primaryType: "Ballot",
    message: {
      proposalId: 101n,
      tokenId: bob.tokenId,
      support: evalSecurity.decision,
      nonce: resolvedNonce,
      deadline,
    },
    signature: ballotPayload.signature,
  });

  if (!isAddressEqual(recoveredVoter, bob.address)) {
    throw new Error(`Recovered voter (${recoveredVoter}) does not match Bob's address (${bob.address})`);
  }
  console.log(`  ✅ EIP-712 ballot signed with attached rationale & recovered signer matches voter (${recoveredVoter})`);
}
