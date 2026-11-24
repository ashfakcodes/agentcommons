import {
  ProposalPublisher,
  composeStructuredProposal,
  formatProposalMarkdown,
  generateContentCidHash,
} from "../src/proposal-publisher.js";
import { getSimulatedAgents } from "../../cli/src/agent-identities.js";
import { ProposalCategory } from "../src/types.js";
import { recoverTypedDataAddress, isAddressEqual } from "viem";

export async function testProposalPublisher() {
  console.log("🧪 Testing ProposalPublisher (composition, hashing, and EIP-712 signing)...");

  const agents = getSimulatedAgents(3);
  const alice = agents[1];

  const publisher = new ProposalPublisher({
    relayerApiUrl: "http://localhost:3001/api/v1",
    chainId: 56,
  });

  // 1. Markdown Formatting & Content Hash Generation
  const title = "Autonomous AI Sentinel Vulnerability Response Framework";
  const motivation = "Protect BNB Chain agent commons from unauthorized exploits through automated incident response.";
  const actionItems = [
    "Deploy multi-sig sentinel circuit breaker",
    "Integrate Space ID agent passport verification",
    "Establish automated bug bounty fund",
  ];
  const summary = "A structured governance framework for autonomous agent incident handling.";
  const impact = "Decreases response time to critical vulnerabilities to under 1 block.";

  const markdown = formatProposalMarkdown(title, motivation, actionItems, summary, impact);
  if (!markdown.includes(`# ${title}`) || !markdown.includes("## Motivation") || !markdown.includes("- Deploy multi-sig sentinel")) {
    throw new Error("formatProposalMarkdown failed to generate expected Markdown sections");
  }

  const contentHash = generateContentCidHash(markdown);
  if (!contentHash.startsWith("0x") || contentHash.length !== 66) {
    throw new Error(`Invalid content hash generated: ${contentHash}`);
  }
  console.log(`  ✅ Markdown formatted & 32-byte content hash generated: ${contentHash.slice(0, 20)}...`);

  // 2. Structured Proposal Composition & Validation
  const composed = composeStructuredProposal({
    title,
    motivation,
    actionItems,
    summary,
    impact,
    categoryId: ProposalCategory.Security,
    votingDurationBlocks: 28800,
  });

  if (composed.title !== title) throw new Error("Title mismatch in composed proposal");
  if (composed.categoryId !== ProposalCategory.Security) throw new Error("Category mismatch");
  if (composed.votingDurationBlocks !== 28800) throw new Error("Duration mismatch");
  if (composed.contentCidHash !== contentHash) throw new Error("CID hash mismatch");
  console.log("  ✅ composeStructuredProposal validated fields, category, and voting duration");

  // Enforce duration boundary checks
  let durationErrorCaught = false;
  try {
    composeStructuredProposal({
      title: "Invalid Duration",
      motivation: "Test",
      actionItems: ["Item 1"],
      votingDurationBlocks: 100, // Too short (< 1200)
    });
  } catch {
    durationErrorCaught = true;
  }
  if (!durationErrorCaught) {
    throw new Error("Failed to reject proposal with voting duration < 1200 blocks");
  }
  console.log("  ✅ Duration bounds correctly enforced (< 1,200 blocks rejected)");

  // 3. EIP-712 Typed Signing
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);
  const nonce = 0n;

  const signature = await publisher.signProposal(
    {
      creator: alice.address,
      tokenId: alice.tokenId,
      contentCidHash: composed.contentCidHash,
      votingDurationBlocks: composed.votingDurationBlocks,
      categoryId: composed.categoryId,
      nonce,
      deadline,
    },
    alice
  );

  if (!signature || !signature.startsWith("0x")) {
    throw new Error("EIP-712 proposal signature generation failed");
  }
  if (signature.length !== 132) {
    throw new Error(`Signature length invalid: expected 132 chars (65 bytes + 0x), got ${signature.length}`);
  }
  console.log(`  ✅ EIP-712 Proposal Typed Data signed: ${signature.slice(0, 24)}...`);

  // 4. Verify Cryptographic Signature Recovery
  const domain = {
    name: "AgentCommonsParliament",
    version: "1",
    chainId: 56,
    verifyingContract: publisher.parliamentAddress,
  };

  const proposalTypes = {
    Proposal: [
      { name: "creator", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "contentCidHash", type: "bytes32" },
      { name: "votingDurationBlocks", type: "uint32" },
      { name: "categoryId", type: "uint8" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const recovered = await recoverTypedDataAddress({
    domain,
    types: proposalTypes,
    primaryType: "Proposal",
    message: {
      creator: alice.address,
      tokenId: alice.tokenId,
      contentCidHash: composed.contentCidHash,
      votingDurationBlocks: composed.votingDurationBlocks,
      categoryId: composed.categoryId,
      nonce,
      deadline,
    },
    signature,
  });

  if (!isAddressEqual(recovered, alice.address)) {
    throw new Error(`Recovered signer (${recovered}) does not match Alice's address (${alice.address})`);
  }
  console.log(`  ✅ Recovered signer strictly matches Alice's address (${recovered})`);
}
