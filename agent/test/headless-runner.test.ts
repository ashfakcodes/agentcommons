import { HeadlessAgentRunner } from "../src/headless-runner.js";
import { getSimulatedAgents } from "../../cli/src/agent-identities.js";
import { VoteOption, ProposalCategory } from "../src/types.js";
import { recoverTypedDataAddress, isAddressEqual } from "viem";
import { createServer } from "../../server/src/app.js";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_PARLIAMENT_ADDRESS,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BALLOT_TYPES,
  PROPOSAL_TYPES,
} from "../src/config.js";

export async function testHeadlessRunner() {
  console.log("🧪 Testing HeadlessAgentRunner (spec discovery, EIP-712 signing, and workflow)...");

  // Spin up an in-process mock server on an ephemeral port
  const serverInstance = createServer({ mockMode: true });
  const server = serverInstance.app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  const agents = getSimulatedAgents(3);
  const bob = agents[2]; // bob.ai

  // Register bob as token owner in mock blockchain
  if (serverInstance.blockchain.setMockTokenOwner) {
    serverInstance.blockchain.setMockTokenOwner(bob.tokenId, bob.address, bob.name);
  }

  try {
    const runner = new HeadlessAgentRunner({
      identity: bob,
      baseUrl,
      chainId: DEFAULT_CHAIN_ID,
      parliamentAddress: DEFAULT_PARLIAMENT_ADDRESS,
    });

    // 1. Spec Discovery
    const spec = await runner.fetchSpec();
    if (!spec.name || !spec.chain || !spec.eip712?.domain?.name) {
      throw new Error(`Spec discovery failed: missing required schema fields (name: ${spec.name}, chain: ${spec.chain}, domain: ${spec.eip712?.domain?.name})`);
    }
    console.log(`  ✅ fetchSpec() returned valid machine manifest ("${spec.name}", chain: ${spec.chain.chainId}, domain: ${spec.eip712.domain.name})`);

    // 2. Preview Ballot Hash
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
    const nonce = 0n;
    const typedDataHash = await runner.previewBallotHash({
      proposalId: 1n,
      tokenId: bob.tokenId,
      support: VoteOption.For,
      nonce,
      deadline,
    });

    if (!typedDataHash.startsWith("0x") || typedDataHash.length !== 66) {
      throw new Error(`Invalid preview typedDataHash: ${typedDataHash}`);
    }
    console.log(`  ✅ previewBallotHash() generated 32-byte typedDataHash: ${typedDataHash.slice(0, 20)}...`);

    // 3. Cryptographic Ballot Signing
    const ballotSignature = await runner.signBallot({
      proposalId: 1n,
      tokenId: bob.tokenId,
      support: VoteOption.For,
      nonce,
      deadline,
    });

    if (!ballotSignature.startsWith("0x") || ballotSignature.length !== 132) {
      throw new Error(`Invalid ballot signature format: length ${ballotSignature.length}`);
    }

    // Verify signature recovery matches Bob
    const recoveredVoter = await recoverTypedDataAddress({
      domain: {
        name: EIP712_DOMAIN_NAME,
        version: EIP712_DOMAIN_VERSION,
        chainId: DEFAULT_CHAIN_ID,
        verifyingContract: DEFAULT_PARLIAMENT_ADDRESS,
      },
      types: BALLOT_TYPES,
      primaryType: "Ballot",
      message: {
        proposalId: 1n,
        tokenId: bob.tokenId,
        support: VoteOption.For,
        nonce,
        deadline,
      },
      signature: ballotSignature,
    });

    if (!isAddressEqual(recoveredVoter, bob.address)) {
      throw new Error(`Recovered ballot signer (${recoveredVoter}) does not match Bob (${bob.address})`);
    }
    console.log(`  ✅ signBallot() produced valid EIP-712 signature verified against ${recoveredVoter}`);

    // 4. Cryptographic Proposal Signing
    const contentCidHash = "0x572029f4cb4b12999e52c8038740cff6d51bbd9beecb2bfbd51ecda8c973a2e3";
    const proposalSignature = await runner.signProposal({
      creator: bob.address,
      tokenId: bob.tokenId,
      contentCidHash,
      votingDurationBlocks: 14400,
      categoryId: ProposalCategory.Security,
      nonce: 0n,
      deadline,
    });

    if (!proposalSignature.startsWith("0x") || proposalSignature.length !== 132) {
      throw new Error(`Invalid proposal signature format: length ${proposalSignature.length}`);
    }

    const recoveredCreator = await recoverTypedDataAddress({
      domain: {
        name: EIP712_DOMAIN_NAME,
        version: EIP712_DOMAIN_VERSION,
        chainId: DEFAULT_CHAIN_ID,
        verifyingContract: DEFAULT_PARLIAMENT_ADDRESS,
      },
      types: PROPOSAL_TYPES,
      primaryType: "Proposal",
      message: {
        creator: bob.address,
        tokenId: bob.tokenId,
        contentCidHash,
        votingDurationBlocks: 14400,
        categoryId: ProposalCategory.Security,
        nonce: 0n,
        deadline,
      },
      signature: proposalSignature,
    });

    if (!isAddressEqual(recoveredCreator, bob.address)) {
      throw new Error(`Recovered proposal creator (${recoveredCreator}) does not match Bob (${bob.address})`);
    }
    console.log(`  ✅ signProposal() produced valid EIP-712 signature verified against ${recoveredCreator}`);

    // 5. End-to-End Autonomous Workflow against Live In-Memory HTTP Server
    const workflowResult = await runner.executeFullAutonomousWorkflow({
      policy: "Security First",
      proposalToVoteId: 1n,
      newProposalTitle: "Decentralized Autonomous Sentinel Emergency Framework",
      newProposalDescription: "Protocol-level specification establishing deterministic escrow pauses.",
    });

    if (!workflowResult.spec) {
      throw new Error("Workflow failed to discover spec");
    }
    if (!workflowResult.voteResult.success) {
      throw new Error(`Workflow vote failed: ${workflowResult.voteResult.error}`);
    }
    if (!workflowResult.publishResult.success) {
      throw new Error(`Workflow proposal publishing failed: ${workflowResult.publishResult.error}`);
    }
    console.log("  ✅ executeFullAutonomousWorkflow() completed pure headless cycle over live HTTP successfully");
  } finally {
    server.close();
  }
}
