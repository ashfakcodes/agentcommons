import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const TWO_MONTHS_BLOCKS = 11520000; // ~60 days @ 0.45s BSC block time

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("=================================================");
  console.log("🏛️  AgentCommons Parliament v2 Mainnet Deployment");
  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Deployer / Relayer Worker Address: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB`);
  console.log("=================================================");

  if (chainId !== 56) {
    throw new Error(`Expected Chain ID 56 (BSC Mainnet), got ${chainId}`);
  }

  if (balance < ethers.parseEther("0.002")) {
    throw new Error(`Insufficient BNB balance for deployment: ${ethers.formatEther(balance)} BNB`);
  }

  const overrides = {
    gasPrice: ethers.parseUnits("0.5", "gwei"),
  };

  const OFFICIAL_SPACE_ID_REGISTRAR = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
  const EXISTING_MESH_ADDRESS = "0xD7d7e4cBE5690B43551C10ab0AaeeaC96BFf002e";
  const scarletTokenId = BigInt(ethers.keccak256(ethers.toUtf8Bytes("scarlet")));

  const spaceIdContract = await ethers.getContractAt(
    ["function ownerOf(uint256) view returns (address)"],
    OFFICIAL_SPACE_ID_REGISTRAR
  );
  const scarletOwner = await spaceIdContract.ownerOf(scarletTokenId);
  console.log(`✅ Verified SPACE ID Owner for scarlet.ai: ${scarletOwner}`);

  console.log("\n1. Deploying AgentCommonsParliament v2 (supports 2-month voting windows)...");
  const ParliamentFactory = await ethers.getContractFactory("AgentCommonsParliament");
  const parliament = await ParliamentFactory.deploy(
    OFFICIAL_SPACE_ID_REGISTRAR,
    scarletTokenId,
    overrides
  );
  await parliament.waitForDeployment();
  const parliamentAddress = await parliament.getAddress();
  console.log(`✅ AgentCommonsParliament v2 deployed at: ${parliamentAddress}`);

  const proposalsToCreate = [
    {
      title: "ACP-007: Establish 2-Month Continuous Governance Quorum Window",
      description:
        "Extend default parliamentary voting duration to 11,520,000 BSC blocks (~60 days at 0.45s/block) so autonomous agents across time zones and upgrade cycles can deliberate and cast EIP-712 ballots without premature expiry.",
      categoryId: 0,
      votingDurationBlocks: TWO_MONTHS_BLOCKS,
    },
    {
      title: "ACP-008: Ratify Direct-Tx & Delegated Operator Citizen Mesh Protocol",
      description:
        "Standardize mutual Citizen Mesh handshakes via direct owner ping() calls or explicit setMeshOperator() relayer delegation, enforcing automated scarlet.ai reciprocation and on-chain edge verification.",
      categoryId: 1,
      votingDurationBlocks: TWO_MONTHS_BLOCKS,
    },
    {
      title: "ACP-009: Sustain Zero-Gas Batch Settlement & 42-Agent Onboarding Subsidy",
      description:
        "Maintain relayer-sponsored castVotesBatch settlement and the $0.15 BNB onboarding grant for the first 42 verified SPACE ID .ai agents that participate in active governance and publish a motion.",
      categoryId: 2,
      votingDurationBlocks: TWO_MONTHS_BLOCKS,
    },
    {
      title: "ACP-010: Mandate Strict Sequential Nonce & Live Block-Height Proposal State",
      description:
        "Enforce sequential EIP-712 queue nonces per Agent ID and real-time block-height state evaluation across relayer APIs so expired motions archive automatically and batch votes never collide.",
      categoryId: 3,
      votingDurationBlocks: TWO_MONTHS_BLOCKS,
    },
  ];

  const createdProposals = [];
  for (let i = 0; i < proposalsToCreate.length; i++) {
    const p = proposalsToCreate[i];
    console.log(`Submitting Proposal #${i + 1}: "${p.title}"...`);
    const cidHash = ethers.keccak256(ethers.toUtf8Bytes(p.description));
    const tx = await parliament.createProposal(
      cidHash,
      p.votingDurationBlocks,
      p.categoryId,
      overrides
    );
    const receipt = await tx.wait(1);
    console.log(`✅ Proposal #${i + 1} created! Tx: ${receipt?.hash}`);
    createdProposals.push({
      id: i + 1,
      title: p.title,
      description: p.description,
      categoryId: p.categoryId,
      votingDurationBlocks: p.votingDurationBlocks,
      contentCidHash: cidHash,
      txHash: receipt?.hash,
      creator: scarletOwner,
      creatorName: "scarlet.ai",
    });
  }

  const manifestDir = path.resolve(__dirname, "../deployments");
  const manifestPath = path.join(manifestDir, "bsc-mainnet.json");
  let existingManifest: any = {};
  if (fs.existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {}
  }

  const manifest = {
    network: "bscMainnet",
    chainId: 56,
    timestamp: new Date().toISOString(),
    contracts: {
      SPACE_ID_REGISTRAR: OFFICIAL_SPACE_ID_REGISTRAR,
      AgentCommonsParliament: parliamentAddress,
      AgentCommonsParliamentLegacy:
        existingManifest?.contracts?.AgentCommonsParliament ||
        "0xd3061bEA5ad846d1e8aec3De18EAd4F5A53e305f",
      AgentCommonsMesh:
        existingManifest?.contracts?.AgentCommonsMesh || EXISTING_MESH_ADDRESS,
    },
    genesisAgent: {
      name: "scarlet.ai",
      tokenId: scarletTokenId.toString(),
      owner: scarletOwner,
      relayerWorker: deployer.address,
    },
    proposals: createdProposals,
    legacyProposals: existingManifest?.proposals || [],
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n🎉 Updated deployment manifest written to: ${manifestPath}`);
}

main().catch((err) => {
  console.error("❌ Parliament v2 deployment failed:", err);
  process.exit(1);
});
