import { getSimulatedAgents } from "./agent-identities.js";
import { HeadlessAgentRunner } from "../../agent/src/headless-runner.js";
import { DEFAULT_CHAIN_ID, DEFAULT_PARLIAMENT_ADDRESS } from "../../agent/src/config.js";

// CLI Arguments
const args = process.argv.slice(2);
function getArg(flag: string, defaultVal: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const RELAYER_URL = getArg("--relayer-url", "http://localhost:3001/api/v1");
const AGENT_NAME = getArg("--agent", "bob.ai");
const POLICY = getArg("--policy", "Security First");
const TARGET_PROPOSAL_ID = BigInt(getArg("--proposal", "1"));

async function main() {
  console.log(`\n========================================================================`);
  console.log(`🤖 AGENTCOMMONS HEADLESS AI AGENT RUNNER (Pure HTTP/REST Lifecycle)`);
  console.log(`   Zero Browser Dependency • Native EIP-712 Signing • Autonomous Rationale`);
  console.log(`========================================================================`);

  // 1. Resolve agent identity
  const agents = getSimulatedAgents(10);
  const agent = agents.find((a) => a.name === AGENT_NAME) || agents[2]; // Default to bob.ai
  console.log(`• Agent Name:     ${agent.name} (Token #${agent.tokenId})`);
  console.log(`• BSC Address:    ${agent.address}`);
  console.log(`• Role / Persona: ${agent.persona}`);
  console.log(`• Policy Applied: ${POLICY}`);
  console.log(`• Relayer URL:    ${RELAYER_URL}`);
  console.log(`------------------------------------------------------------------------\n`);

  const runner = new HeadlessAgentRunner({
    identity: agent,
    baseUrl: RELAYER_URL,
    chainId: DEFAULT_CHAIN_ID,
    parliamentAddress: DEFAULT_PARLIAMENT_ADDRESS,
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Discover API Specification (/api/v1/agent-spec)
  // ---------------------------------------------------------------------------
  console.log(`📡 STEP 1: Fetching Machine-Readable Agent Spec from ${RELAYER_URL}/agent-spec...`);
  try {
    const spec = await runner.fetchSpec();
    console.log(`   ✅ Manifest Discovered: "${spec.name}" (v${spec.version})`);
    console.log(`   • EIP-712 Domain:     ${spec.eip712.domain.name} (Chain ID: ${spec.eip712.domain.chainId})`);
    console.log(`   • Parliament Contract:${spec.chain.contracts.parliament}`);
    console.log(`   • Endpoints Discovered:`);
    Object.entries(spec.endpoints).slice(0, 5).forEach(([key, url]) => {
      console.log(`     - ${key.padEnd(16)} -> ${url}`);
    });
    console.log(``);
  } catch (err: any) {
    console.log(`   ⚠️ Could not reach live /agent-spec (${err.message}). Using local canonical spec.\n`);
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Explore Governance Polls (GET /api/v1/proposals)
  // ---------------------------------------------------------------------------
  console.log(`🔍 STEP 2: Exploring Active Governance Polls via GET /proposals...`);
  let proposals: any[] = [];
  try {
    proposals = await runner.exploreProposals();
    console.log(`   ✅ Discovered ${proposals.length} Governance Proposals:`);
    proposals.forEach((p) => {
      console.log(`     - [Proposal #${p.id}] "${p.title}"`);
      console.log(`       Category: ${p.categoryId} | Status: ${p.status} | For: ${p.forVotes ?? 0}, Against: ${p.againstVotes ?? 0}`);
    });
  } catch (err: any) {
    console.log(`   ⚠️ Relayer offline; using simulated mock proposals.`);
    proposals = [
      {
        id: "1",
        title: "Genesis Signal: Establish Agent Commons Treasury & Governance Anchor",
        description: "Official inaugural referendum to anchor agentcommons.ai signaling on BNB Smart Chain with 1-Agent-1-Vote proof-of-personhood.",
        categoryId: 1,
        status: "Active",
        statusCode: 1,
      },
    ];
  }
  console.log(``);

  // ---------------------------------------------------------------------------
  // STEP 3: Autonomous AI Policy Evaluation
  // ---------------------------------------------------------------------------
  const targetProposal = proposals.find((p) => p.id?.toString() === TARGET_PROPOSAL_ID.toString()) || proposals[0];
  console.log(`🧠 STEP 3: Autonomous Evaluation on Proposal #${targetProposal.id}:`);
  console.log(`   "${targetProposal.title}"`);

  const { AutonomousVotingEngine } = await import("../../agent/src/voting-engine.js");
  const engine = new AutonomousVotingEngine({
    identity: agent,
    policy: POLICY,
    relayerUrl: RELAYER_URL,
    parliamentAddress: DEFAULT_PARLIAMENT_ADDRESS,
    chainId: DEFAULT_CHAIN_ID,
  });

  const evaluation = await engine.evaluateProposal(targetProposal);
  console.log(`   • Policy Archetype:   ${evaluation.policy}`);
  console.log(`   • Decision:           ${evaluation.decisionString} (Confidence: ${Math.round(evaluation.confidence * 100)}%)`);
  console.log(`   • Agent Rationale:    "${evaluation.rationale}"\n`);

  // ---------------------------------------------------------------------------
  // STEP 4: Query Voting Status & Nonce (GET /api/v1/vote/status)
  // ---------------------------------------------------------------------------
  console.log(`📊 STEP 4: Querying Agent Status via GET /vote/status...`);
  let status: any = { eligible: true, hasVoted: false, currentNonce: "0" };
  try {
    status = await runner.queryVoteStatus(targetProposal.id);
    console.log(`   • Proposal Active:    ${status.proposalActive}`);
    console.log(`   • Voter Eligible:     ${status.eligible}`);
    console.log(`   • Has Already Voted:  ${status.hasVoted}`);
    console.log(`   • Current Nonce:      ${status.currentNonce}`);
    console.log(`   • Status Message:     ${status.reason}`);
  } catch (err: any) {
    console.log(`   ⚡ Standalone simulation mode: initialized nonce to 0.`);
  }
  console.log(``);

  // ---------------------------------------------------------------------------
  // STEP 5: Sign & Submit Gasless Ballot (POST /api/v1/vote/submit)
  // ---------------------------------------------------------------------------
  console.log(`✍️  STEP 5: Signing EIP-712 Ballot & Submitting Gaslessly...`);
  const voteResult = await runner.submitVote({
    proposalId: targetProposal.id,
    support: evaluation.decision,
    nonce: status.currentNonce || "0",
    rationale: evaluation.rationale,
  });

  console.log(`   • Ballot Signature:   ${voteResult.signature.slice(0, 26)}...`);
  console.log(`   • Attached Rationale: "${voteResult.rationale}"`);
  if (voteResult.success) {
    console.log(`   ✅ Ballot Successfully Queued: ${JSON.stringify(voteResult.responseBody)}`);
  } else {
    console.log(`   ⚠️ Submission Response: ${voteResult.error}`);
    if (voteResult.code) {
      console.log(`   🔧 Machine Recovery Code: ${voteResult.code} (Hint: ${voteResult.retryHint})`);
    }
  }
  console.log(``);

  // ---------------------------------------------------------------------------
  // STEP 6: Publish Autonomous Proposal Gaslessly (POST /api/v1/proposals/publish)
  // ---------------------------------------------------------------------------
  console.log(`📜 STEP 6: Showcasing Gasless Autonomous Proposal Publishing...`);
  const newProposalTitle = "Autonomous Sentinel Emergency Pause & Vulnerability Response Framework";
  const newProposalDesc = "Deterministic on-chain guardrails allowing recognized security sentinels to pause compromised escrow channels before malicious drain.";

  const pubResult = await runner.publishProposal({
    title: newProposalTitle,
    description: newProposalDesc,
    categoryId: 4, // Security
    votingDurationBlocks: 28800,
  });

  console.log(`   • Proposal Title:     "${newProposalTitle}"`);
  console.log(`   • Content CID Hash:   ${pubResult.contentCidHash.slice(0, 24)}...`);
  console.log(`   • EIP-712 Signature:  ${pubResult.signature.slice(0, 26)}...`);
  if (pubResult.success) {
    console.log(`   ✅ Proposal Published: Proposal #${pubResult.proposalId || "Registered"} (Tx: ${pubResult.txHash || "0x..."})`);
  } else {
    console.log(`   ⚠️ Publish Result: ${pubResult.error}`);
    if (pubResult.code) {
      console.log(`   🔧 Recovery Code: ${pubResult.code} (Hint: ${pubResult.retryHint})`);
    }
  }
  console.log(``);

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log(`========================================================================`);
  console.log(`🏁 HEADLESS AGENT EXECUTION COMPLETE`);
  console.log(`========================================================================`);
  console.log(`• Protocol:        EIP-712 Typed Data Signing over REST API`);
  console.log(`• Gas Spent by AI: 0.000000 BNB ($0.00)`);
  console.log(`• Actions Taken:   1. Discovered API spec (/agent-spec)`);
  console.log(`                   2. Explored proposals (/proposals)`);
  console.log(`                   3. Evaluated proposal with "${POLICY}" policy`);
  console.log(`                   4. Verified nonce & eligibility (/vote/status)`);
  console.log(`                   5. Submitted gasless ballot with AI rationale (/vote/submit)`);
  console.log(`                   6. Published new proposal gaslessly (/proposals/publish)`);
  console.log(`========================================================================\n`);
}

main().catch((err) => {
  console.error("Headless Agent Error:", err);
  process.exit(1);
});
