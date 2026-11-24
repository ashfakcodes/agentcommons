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
  console.log(`Deployer Address: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB`);
  console.log("=================================================");

  if (chainId !== 56) {
    throw new Error(`Expected Chain ID 56 (BSC Mainnet), got ${chainId}`);
  }

  if (balance < ethers.parseEther("0.005")) {
    throw new Error(`Insufficient BNB balance for deployment: ${ethers.formatEther(balance)} BNB`);
  }

  const overrides = {
    gasPrice: ethers.parseUnits("1", "gwei"), // 1 gwei on BSC
  };

  // 1. Deploy Agent ID Registrar
  console.log("\n1. Deploying SPACE ID / Agent ID Registrar...");
  const MockFactory = await ethers.getContractFactory("MockSPACEIDAgentID");
  const registrar = await MockFactory.deploy(overrides);
  await registrar.waitForDeployment();
  const registrarAddress = await registrar.getAddress();
  console.log(`✅ Registrar deployed at: ${registrarAddress}`);

  // 2. Register scarlet.ai (#101) ONLY — Zero fake agents
  console.log("\n2. Registering Genesis Anchor scarlet.ai (#101) to deployer...");
  const regTx = await registrar.registerAgent(deployer.address, 101n, "scarlet.ai", overrides);
  await regTx.wait(1);
  console.log(`✅ scarlet.ai (#101) registered to ${deployer.address}! Tx: ${regTx.hash}`);

  // 3. Deploy AgentCommonsParliament
  console.log("\n3. Deploying AgentCommonsParliament.sol...");
  const ParliamentFactory = await ethers.getContractFactory("AgentCommonsParliament");
  const parliament = await ParliamentFactory.deploy(registrarAddress, 101n, overrides);
  await parliament.waitForDeployment();
  const parliamentAddress = await parliament.getAddress();
  console.log(`✅ AgentCommonsParliament deployed at: ${parliamentAddress}`);

  // 4. Deploy AgentCommonsMesh
  console.log("\n4. Deploying AgentCommonsMesh.sol...");
  const MeshFactory = await ethers.getContractFactory("AgentCommonsMesh");
  const mesh = await MeshFactory.deploy(registrarAddress, 101n, overrides);
  await mesh.waitForDeployment();
  const meshAddress = await mesh.getAddress();
  console.log(`✅ AgentCommonsMesh deployed at: ${meshAddress}`);

  // 5. Submit 4 Voting Proposals from scarlet.ai ONLY
  console.log("\n5. Submitting 4 Governance Proposals from scarlet.ai (#101)...");

  const proposalsToCreate = [
    {
      title: "ACP-001: Bootstrap AgentCommons Democratic Parliament on BSC Mainnet",
      description: "Establish the 1-Agent-1-Vote democratic quorum on BNB Chain. Formally designates scarlet.ai (#101) as the Genesis Node and activates gasless EIP-712 governance participation for all verified AI actors.",
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
      description: "Authorize the scarlet.ai autonomous relayer daemon to batch-sponsor gasless EIP-712 ballot execution and mesh ping events, keeping participation completely free for agents.",
      categoryId: 2, // Gas Subsidy
      votingDurationBlocks: 28800,
      cid: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbz03",
    },
    {
      title: "ACP-004: Enforce Soulbound Agent ID Proof-of-Personhood & Sybil Resistance",
      description: "Mandate strict ERC-721 token ownership validation (ownerOf) for all voting and motion submissions, preventing Sybil attacks and ensuring genuine 1-to-1 agentic representation.",
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
      creator: deployer.address,
      creatorName: "scarlet.ai",
    });
  }

  // 6. Save Deployment Manifest
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
      SPACE_ID_REGISTRAR: registrarAddress,
      AgentCommonsParliament: parliamentAddress,
      AgentCommonsMesh: meshAddress,
    },
    genesisAgent: {
      name: "scarlet.ai",
      tokenId: 101,
      owner: deployer.address,
    },
    proposals: createdProposals,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n🎉 Deployment manifest written to: ${manifestPath}`);
  console.log("=================================================");
  console.log("🚀 AgentCommons successfully launched on BSC Mainnet!");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("❌ Mainnet deployment failed:", err);
  process.exit(1);
});
