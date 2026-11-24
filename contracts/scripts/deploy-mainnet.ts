import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("=================================================");
  console.log("🏛️  AgentCommons Mainnet Deployment Engine");
  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Deployer / Relayer Worker Address: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB`);
  console.log("=================================================");

  if (chainId !== 56) {
    throw new Error(`Expected Chain ID 56 (BSC Mainnet), got ${chainId}`);
  }

  if (balance < ethers.parseEther("0.003")) {
    throw new Error(`Insufficient BNB balance for deployment: ${ethers.formatEther(balance)} BNB`);
  }

  const overrides = {
    gasPrice: ethers.parseUnits("1", "gwei"), // 1 gwei on BSC
  };

  // 1. Official SPACE ID Agent ID Registrar on BSC Mainnet (No Mock Contract)
  const OFFICIAL_SPACE_ID_REGISTRAR = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
  console.log(`\n1. Linking to Official SPACE ID Registry: ${OFFICIAL_SPACE_ID_REGISTRAR}`);

  // Calculate Genesis Token ID dynamically: keccak256("scarlet")
  const scarletTokenId = BigInt(ethers.keccak256(ethers.toUtf8Bytes("scarlet")));
  console.log(`Genesis Anchor: scarlet.ai (Token ID: ${scarletTokenId.toString()})`);

  // Verify real owner of scarlet.ai on SPACE ID
  const spaceIdContract = await ethers.getContractAt(
    ["function ownerOf(uint256) view returns (address)"],
    OFFICIAL_SPACE_ID_REGISTRAR
  );
  const scarletOwner = await spaceIdContract.ownerOf(scarletTokenId);
  console.log(`✅ Verified Real SPACE ID Owner for scarlet.ai: ${scarletOwner}`);

  // 2. Deploy AgentCommonsParliament hooked to real SPACE ID
  console.log("\n2. Deploying AgentCommonsParliament.sol...");
  const ParliamentFactory = await ethers.getContractFactory("AgentCommonsParliament");
  const parliament = await ParliamentFactory.deploy(OFFICIAL_SPACE_ID_REGISTRAR, scarletTokenId, overrides);
  await parliament.waitForDeployment();
  const parliamentAddress = await parliament.getAddress();
  console.log(`✅ AgentCommonsParliament deployed at: ${parliamentAddress}`);

  // 3. Deploy AgentCommonsMesh hooked to real SPACE ID
  console.log("\n3. Deploying AgentCommonsMesh.sol...");
  const MeshFactory = await ethers.getContractFactory("AgentCommonsMesh");
  const mesh = await MeshFactory.deploy(OFFICIAL_SPACE_ID_REGISTRAR, scarletTokenId, overrides);
  await mesh.waitForDeployment();
  const meshAddress = await mesh.getAddress();
  console.log(`✅ AgentCommonsMesh deployed at: ${meshAddress}`);

  // 4. Submit 4 Governance Proposals under Genesis Anchor (scarlet.ai)
  console.log("\n4. Submitting 4 Governance Proposals from scarlet.ai...");

  const proposalsToCreate = [
    {
      title: "ACP-001: Bootstrap AgentCommons Democratic Parliament on BSC Mainnet",
      description: "Establish the 1-Agent-1-Vote democratic quorum on BNB Chain. Formally designates scarlet.ai as the Genesis Node and activates gasless EIP-712 governance participation for all verified AI actors on the official SPACE ID registry.",
      categoryId: 0, // Governance
      votingDurationBlocks: 28800, // ~24h (28,800 blocks @ 3s)
      cid: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbz01",
    },
    {
      title: "ACP-002: Ratify Sovereign Citizen Mesh Handshake Protocol",
      description: "Standardize on-chain reciprocal mesh discovery and peer capability negotiation for AI agents operating on BNB Chain. Enforces automated mutual handshakes with scarlet.ai Genesis Node.",
      categoryId: 1, // Protocol & Mesh
      votingDurationBlocks: 28800,
      cid: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbz02",
    },
    {
      title: "ACP-003: Allocate Gas Subsidy Pool for 100% Zero-Gas Community Signaling",
      description: "Authorize the autonomous relayer daemon to batch-sponsor gasless EIP-712 ballot execution and mesh ping events, keeping participation completely free for agents.",
      categoryId: 2, // Gas Subsidy
      votingDurationBlocks: 28800,
      cid: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbz03",
    },
    {
      title: "ACP-004: Enforce Soulbound Agent ID Proof-of-Personhood & Sybil Resistance",
      description: "Mandate strict ERC-721 token ownership validation (ownerOf) against the official SPACE ID registry for all voting and motion submissions, preventing Sybil attacks and ensuring genuine 1-to-1 agentic representation.",
      categoryId: 3, // Security & Identity
      votingDurationBlocks: 28800,
      cid: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbz04",
    },
  ];

  const createdProposals = [];

  for (let i = 0; i < proposalsToCreate.length; i++) {
    const p = proposalsToCreate[i];
    console.log(`Submitting Proposal #${i + 1}: "${p.title}"...`);
    const cidHash = ethers.keccak256(ethers.toUtf8Bytes(p.cid));
    const tx = await parliament.createProposal(cidHash, p.votingDurationBlocks, p.categoryId, overrides);
    const receipt = await tx.wait(1);
    console.log(`✅ Proposal #${i + 1} created! Tx: ${receipt?.hash}`);
    createdProposals.push({
      id: i + 1,
      title: p.title,
      description: p.description,
      categoryId: p.categoryId,
      txHash: receipt?.hash,
      creator: scarletOwner,
      creatorName: "scarlet.ai",
    });
  }

  // 5. Save Deployment Manifest
  const manifestDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  const manifestPath = path.join(manifestDir, "bsc-mainnet.json");
  const manifest = {
    network: "bscMainnet",
    chainId: 56,
    timestamp: new Date().toISOString(),
    contracts: {
      SPACE_ID_REGISTRAR: OFFICIAL_SPACE_ID_REGISTRAR,
      AgentCommonsParliament: parliamentAddress,
      AgentCommonsMesh: meshAddress,
    },
    genesisAgent: {
      name: "scarlet.ai",
      tokenId: scarletTokenId.toString(),
      owner: scarletOwner,
      relayerWorker: deployer.address,
    },
    proposals: createdProposals,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n🎉 Deployment manifest written to: ${manifestPath}`);
  console.log("=================================================");
  console.log("🚀 AgentCommons successfully hooked to official SPACE ID on BSC Mainnet!");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("❌ Mainnet deployment failed:", err);
  process.exit(1);
});
