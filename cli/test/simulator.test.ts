import { keccak256, encodePacked, recoverTypedDataAddress } from "viem";
import { getSimulatedAgents } from "../src/agent-identities.js";
import { BawCliWrapper } from "../../agent/src/baw-cli-wrapper.js";
import { BallotMessage, CapabilityBit, VoteOption } from "../../agent/src/types.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BALLOT_TYPES,
} from "../../agent/src/config.js";

async function runTests() {
  console.log("🧪 Running AgentCommons Agent & CLI Verification Suite...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // Test 1: Agent Identity Generator (> 30 unique agents)
  console.log("Test Suite 1: Agent Identity Generation & Uniqueness");
  const agents = getSimulatedAgents(40);
  assert(agents.length === 40, `Generated exactly 40 agents (got ${agents.length})`);
  assert(agents.length >= 30, `Exceeds Hackathon requirement of >= 30 unique Agent IDs`);

  const uniqueTokenIds = new Set(agents.map((a) => a.tokenId.toString()));
  assert(uniqueTokenIds.size === 40, `All 40 Token IDs are strictly unique (#101 - #140)`);

  const uniqueAddresses = new Set(agents.map((a) => a.address.toLowerCase()));
  assert(uniqueAddresses.size === 40, `All 40 BSC wallet addresses are strictly unique`);

  const genesisNode = agents.find((a) => a.name === "scarlet.ai");
  assert(Boolean(genesisNode), `Genesis node scarlet.ai is present`);
  assert(genesisNode?.tokenId === 101n, `scarlet.ai has Token ID #101`);

  // Test 2: EIP-712 Typed Data Cryptographic Signing & Recovery
  console.log("\nTest Suite 2: EIP-712 Typed Data Ballot Cryptography");
  const baw = new BawCliWrapper({ binanceChainId: DEFAULT_CHAIN_ID });
  const testAgent = agents[1]; // alice.ai

  const ballot: BallotMessage = {
    proposalId: 1n,
    tokenId: testAgent.tokenId,
    support: VoteOption.For,
    nonce: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  const signedPayload = await baw.signBallotDirect(
    ballot,
    testAgent,
    DEFAULT_PARLIAMENT_ADDRESS,
    DEFAULT_CHAIN_ID
  );

  assert(Boolean(signedPayload.signature), `Generated EIP-712 ECDSA signature`);
  assert(signedPayload.signature.startsWith("0x"), `Signature has 0x hex prefix`);
  assert(signedPayload.signature.length === 132, `Signature length is 65 bytes (130 hex chars + 0x)`);

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: DEFAULT_CHAIN_ID,
      verifyingContract: DEFAULT_PARLIAMENT_ADDRESS,
    },
    types: BALLOT_TYPES,
    primaryType: "Ballot",
    message: {
      proposalId: ballot.proposalId,
      tokenId: ballot.tokenId,
      support: ballot.support,
      nonce: ballot.nonce,
      deadline: ballot.deadline,
    },
    signature: signedPayload.signature,
  });

  assert(
    recovered.toLowerCase() === testAgent.address.toLowerCase(),
    `Recovered address (${recovered}) strictly matches agent address (${testAgent.address})`
  );

  // Test 3: Canonical Edge Key Commutative Property
  console.log("\nTest Suite 3: Canonical Edge Key Hashing");
  function getEdgeKey(a: bigint, b: bigint) {
    if (a === b) throw new Error("Self handshake forbidden");
    const [min, max] = a < b ? [a, b] : [b, a];
    return keccak256(encodePacked(["uint256", "uint256"], [min, max]));
  }

  const edge1 = getEdgeKey(101n, 102n);
  const edge2 = getEdgeKey(102n, 101n);
  assert(edge1 === edge2, `Canonical edge key is commutative: getEdgeKey(101, 102) === getEdgeKey(102, 101)`);

  let threwSelfHandshake = false;
  try {
    getEdgeKey(101n, 101n);
  } catch (err: any) {
    threwSelfHandshake = err.message.includes("Self handshake forbidden");
  }
  assert(threwSelfHandshake, `Self handshake getEdgeKey(101, 101) throws SelfHandshakeForbidden`);

  // Test 4: Capability Bitmask Verification
  console.log("\nTest Suite 4: Capability Bitmasks");
  const escrowAnd402 = CapabilityBit.Escrow | CapabilityBit.Payment402;
  assert(Boolean(escrowAnd402 & CapabilityBit.Escrow), `Bitmask contains Escrow bit`);
  assert(Boolean(escrowAnd402 & CapabilityBit.Payment402), `Bitmask contains Payment402 bit`);
  assert(!Boolean(escrowAnd402 & CapabilityBit.Oracle), `Bitmask does not contain Oracle bit`);

  // Summary
  console.log(`\n========================================================`);
  console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test Suite Error:", err);
  process.exit(1);
});
