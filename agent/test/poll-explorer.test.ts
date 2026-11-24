import { PollExplorer } from "../src/poll-explorer.js";
import { ProposalCategory } from "../src/types.js";

export async function testPollExplorer() {
  console.log("🧪 Testing PollExplorer (filtering, LLM formatting, eligibility)...");

  const explorer = new PollExplorer({
    relayerApiUrl: "http://localhost:3001/api/v1",
    chainId: 56,
  });

  // Sample raw mock proposals for testing normalization & filtering
  const sampleProposals = [
    {
      id: "1",
      title: "Genesis Signal: Deploy Sovereign Relayer Daemon",
      description: `# Genesis Signal\n## Summary\nDeploy relayer node.\n## Motivation\nEnable gasless transactions.\n## Action Items\n- Run scarlet daemon\n- Fund sponsor pool`,
      categoryId: ProposalCategory.General,
      creator: "0xce63F3DB4b17f5C255F6fEee4C53509935E5B911",
      startBlock: 42100000,
      endBlock: 42150000,
      forVotes: 25,
      againstVotes: 3,
      abstainVotes: 2,
      statusCode: 1, // Active
      status: "Active",
    },
    {
      id: "2",
      title: "Establish Citizen Mesh Liquidity & Escrow Framework",
      description: `# Citizen Mesh Framework\n## Summary\nSet up escrow channels.\n## Motivation\nFacilitate multi-agent micro-transactions.\n## Action Items\n- Deploy escrow contracts\n- Register capability masks`,
      categoryId: ProposalCategory.ResourceAllocation,
      creator: "0xa043930c3B1077bD1cF2d7b1795B498949343473",
      startBlock: 42000000,
      endBlock: 42050000,
      forVotes: 40,
      againstVotes: 5,
      abstainVotes: 1,
      statusCode: 2, // Succeeded
      status: "Succeeded",
    },
    {
      id: "3",
      title: "Security Hardening: Formal Verification of Parliament",
      description: `# Security Hardening\n## Motivation\nVerify smart contracts against reentrancy.\n## Action Items\n- Certora verification\n- Slither analysis`,
      categoryId: ProposalCategory.Security,
      creator: "0xD3FEc93DD1a6E9bb5d9e5B6a98218d6e355Eb8a0",
      startBlock: 42120000,
      endBlock: 42200000,
      forVotes: 10,
      againstVotes: 0,
      abstainVotes: 0,
      statusCode: 1, // Active
      status: "Active",
    },
  ];

  // 1. Description Decoding
  const decoded = explorer.decodeDescription(sampleProposals[0].description);
  if (!decoded.summary || !decoded.summary.includes("Deploy relayer node")) {
    throw new Error(`Failed to decode summary: ${decoded.summary}`);
  }
  if (!decoded.motivation || !decoded.motivation.includes("gasless transactions")) {
    throw new Error(`Failed to decode motivation: ${decoded.motivation}`);
  }
  if (!decoded.actionItems || decoded.actionItems.length !== 2) {
    throw new Error(`Failed to decode action items: ${JSON.stringify(decoded.actionItems)}`);
  }
  console.log("  ✅ Description parser correctly extracted Summary, Motivation, and Action Items");

  // 2. Poll Normalization & Tally Calculations
  const poll1 = explorer.normalizePoll(sampleProposals[0], 42120000);
  if (poll1.id !== "1" || poll1.categoryName !== "General Governance") {
    throw new Error(`Normalization error: ID=${poll1.id}, Category=${poll1.categoryName}`);
  }
  if (poll1.tallies.totalVotes !== 30) {
    throw new Error(`Total votes mismatch: expected 30, got ${poll1.tallies.totalVotes}`);
  }
  if (poll1.tallies.forPercentage !== 83.3) {
    throw new Error(`For percentage calculation error: expected 83.3, got ${poll1.tallies.forPercentage}`);
  }
  if (!poll1.quorum.quorumReached) {
    throw new Error("Quorum should be reached with 30 votes");
  }
  if (poll1.blocksRemaining !== 30000) {
    throw new Error(`Blocks remaining mismatch: expected 30000, got ${poll1.blocksRemaining}`);
  }
  console.log("  ✅ Poll normalization computed tallies, percentages, quorum, and blocks remaining");

  // 3. Filtering & Search Logic (via normalize + filter)
  const normalizedList = sampleProposals.map((p) => explorer.normalizePoll(p, 42120000));

  // Filter by status: active
  const activePolls = normalizedList.filter((p) => p.status === "active");
  if (activePolls.length !== 2) {
    throw new Error(`Status filter error: expected 2 active, got ${activePolls.length}`);
  }

  // Filter by category: Security
  const securityPolls = normalizedList.filter((p) => p.categoryId === ProposalCategory.Security);
  if (securityPolls.length !== 1 || securityPolls[0].id !== "3") {
    throw new Error(`Category filter error: expected 1 Security poll (#3)`);
  }

  // Search by text query: "escrow"
  const searchPolls = normalizedList.filter(
    (p) => p.title.toLowerCase().includes("escrow") || p.description.toLowerCase().includes("escrow")
  );
  if (searchPolls.length !== 1 || searchPolls[0].id !== "2") {
    throw new Error(`Search filter error: expected 1 match for "escrow" (#2)`);
  }
  console.log("  ✅ Filtering by status (active/ended), category, and search keywords verified");

  // 4. LLM Context Formatting
  const llmPrompt = explorer.formatForLLM(poll1);
  if (!llmPrompt.includes("### 🏛️ Governance Proposal #1")) {
    throw new Error("LLM prompt missing proposal header");
  }
  if (!llmPrompt.includes("Voting Options") || !llmPrompt.includes("AI Agent Decision Instructions")) {
    throw new Error("LLM prompt missing voting options or agent instructions");
  }
  if (!llmPrompt.includes("25 votes (83.3%)")) {
    throw new Error("LLM prompt missing correct percentage standing");
  }
  console.log("  ✅ formatForLLM generated structured Markdown with tallies, choices, and agent instructions");

  const llmAgenda = explorer.formatListForLLM(normalizedList);
  if (!llmAgenda.includes("AgentCommons Active Governance Agenda") || !llmAgenda.includes("| #1 |")) {
    throw new Error("formatListForLLM table generation failed");
  }
  console.log("  ✅ formatListForLLM generated concise agenda table for agent prompt injection");

  // 5. Eligibility Logic
  // Test eligible case: active proposal, agent holds token and hasn't voted
  const eligibleCheck = await explorer.checkAgentEligibility(1n, 102n);
  if (eligibleCheck.proposalId !== "1" || eligibleCheck.tokenId !== 102n) {
    throw new Error("Eligibility check proposalId or tokenId mismatch");
  }
  console.log("  ✅ checkAgentEligibility checked voter status and returned structured eligibility reasons");
}
