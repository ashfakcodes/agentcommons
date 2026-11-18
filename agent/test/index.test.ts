import { getSimulatedAgents } from "../../cli/src/agent-identities.js";
import { AgentCommonsSDK } from "../src/agent-commons-sdk.js";
import { VoteOption, CapabilityBit } from "../src/types.js";
import { DEFAULT_CHAIN_ID, DEFAULT_PARLIAMENT_ADDRESS, DEFAULT_MESH_ADDRESS } from "../src/config.js";

async function testSdk() {
  console.log("🧪 Testing AgentCommonsSDK & BawCliWrapper...\n");

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

  // Test 3: Gasless Vote EIP-712 Signing
  const { ballot } = await agentSdk.voteGasless({
    proposalId: 1n,
    support: VoteOption.For,
  });

  if (!ballot.signature || !ballot.signature.startsWith("0x")) {
    throw new Error("Ballot signature generation failed");
  }
  console.log(`  ✅ EIP-712 ballot successfully signed: ${ballot.signature.slice(0, 24)}...`);

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

  console.log("\n========================================================");
  console.log("📊 Agent SDK Test: All 5 tests passed!");
  console.log("========================================================\n");
}

testSdk().catch((err) => {
  console.error("SDK test failed:", err);
  process.exit(1);
});
