import { getSimulatedAgents } from "../../cli/src/agent-identities.js";
import { AgentCommonsSDK } from "../src/agent-commons-sdk.js";
import { VoteOption, CapabilityBit } from "../src/types.js";
import { DEFAULT_CHAIN_ID, DEFAULT_PARLIAMENT_ADDRESS, DEFAULT_MESH_ADDRESS } from "../src/config.js";
import { testPollExplorer } from "./poll-explorer.test.js";
import { testProposalPublisher } from "./proposal-publisher.test.js";
import { testVotingEngine } from "./voting-engine.test.js";
import { testHeadlessRunner } from "./headless-runner.test.js";

async function testAll() {
  console.log("========================================================");
  console.log("🏛️  AGENTCOMMONS AGENT & SDK VERIFICATION SUITE");
  console.log("========================================================\n");

  console.log("🧪 Suite 1: Testing AgentCommonsSDK Core & BawCliWrapper...");

  const agents = getSimulatedAgents(5);
  const scarlet = agents[0];
  const alice = agents[1];

  const agentSdk = new AgentCommonsSDK({
    identity: alice,
    chainId: DEFAULT_CHAIN_ID,
    parliamentAddress: DEFAULT_PARLIAMENT_ADDRESS,
    meshAddress: DEFAULT_MESH_ADDRESS,
  });

  // Test 1: Identity & Passport
  const id = agentSdk.getIdentity();
  if (id.name !== "alice.ai" || id.tokenId !== 102n) {
    throw new Error(`Identity mismatch: ${id.name}, #${id.tokenId}`);
  }
  console.log("  ✅ AgentCommonsSDK initialized identity correctly (alice.ai, Token #102)");

  // Test 2: Canonical Edge Key
  const edgeKey = agentSdk.calculateEdgeKey(scarlet.tokenId);
  if (!edgeKey.startsWith("0x") || edgeKey.length !== 66) {
    throw new Error(`Invalid edge key: ${edgeKey}`);
  }
  console.log(`  ✅ Canonical edge key computed: ${edgeKey}`);

  // Test 3: Gasless Vote EIP-712 Signing with Rationale Preservation
  const { ballot } = await agentSdk.voteGasless({
    proposalId: 1n,
    support: VoteOption.For,
    rationale: "SDK gasless vote with preserved rationale",
  });

  if (!ballot.signature || !ballot.signature.startsWith("0x")) {
    throw new Error("Ballot signature generation failed");
  }
  if (ballot.rationale !== "SDK gasless vote with preserved rationale") {
    throw new Error("Rationale was not preserved on ballot");
  }
  console.log(`  ✅ EIP-712 ballot successfully signed with rationale: "${ballot.rationale}"`);

  // Test 4: Encode Mesh Ping Calldata
  const pingCalldata = agentSdk.encodePingCalldata(scarlet.tokenId, CapabilityBit.Escrow | CapabilityBit.Payment402);
  if (!pingCalldata.startsWith("0x") || pingCalldata.length < 10) {
    throw new Error("Calldata encoding failed");
  }
  console.log(`  ✅ Mesh ping calldata encoded: ${pingCalldata.slice(0, 34)}...`);

  // Test 5: Encode Batch Reciprocate Calldata
  const batchCalldata = agentSdk.encodeBatchReciprocateCalldata([103n, 104n, 105n]);
  if (!batchCalldata.startsWith("0x")) {
    throw new Error("Batch reciprocate calldata failed");
  }
  console.log(`  ✅ Batch reciprocate calldata encoded: ${batchCalldata.slice(0, 34)}...`);

  // Test 6: Verify SDK Integration of PollExplorer & ProposalPublisher instances
  if (!agentSdk.explorer) {
    throw new Error("AgentCommonsSDK missing initialized explorer instance");
  }
  if (!agentSdk.publisher) {
    throw new Error("AgentCommonsSDK missing initialized publisher instance");
  }
  console.log("  ✅ AgentCommonsSDK exposes integrated explorer and publisher instances");

  console.log("\n--------------------------------------------------------");
  // Suite 2: PollExplorer
  await testPollExplorer();

  console.log("\n--------------------------------------------------------");
  // Suite 3: ProposalPublisher
  await testProposalPublisher();

  console.log("\n--------------------------------------------------------");
  // Suite 4: AutonomousVotingEngine
  await testVotingEngine();

  console.log("\n--------------------------------------------------------");
  // Suite 5: HeadlessAgentRunner
  await testHeadlessRunner();

  console.log("\n========================================================");
  console.log("📊 AGENT SUITE RESULTS: All 5 test suites passed 100%!");
  console.log("========================================================\n");
}

testAll().catch((err) => {
  console.error("SDK test failed:", err);
  process.exit(1);
});
