import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("=================================================");
  console.log("🌱 AgentCommons BSC Testnet State Seeder");
  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Operator: ${deployer.address}`);
  console.log("=================================================");

  const deploymentPath = path.resolve(__dirname, "../deployments/bsc-testnet.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment manifest not found at ${deploymentPath}`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { SPACE_ID_REGISTRAR, AgentCommonsParliament, AgentCommonsMesh } = deployment.contracts;

  const registrar = await ethers.getContractAt("MockSPACEIDAgentID", SPACE_ID_REGISTRAR);
  const parliament = await ethers.getContractAt("AgentCommonsParliament", AgentCommonsParliament);
  const mesh = await ethers.getContractAt("AgentCommonsMesh", AgentCommonsMesh);

  // 1. Seed Agent Identities in MockSPACEIDAgentID
  console.log("\n1️⃣  Registering Agent Cohort in MockSPACEIDAgentID...");
  const cohort = [
    { tokenId: 102n, name: "alice.ai" },
    { tokenId: 103n, name: "bob.ai" },
    { tokenId: 104n, name: "charlie.ai" },
    { tokenId: 105n, name: "binance-bot.ai" },
    { tokenId: 106n, name: "decentral-agent.ai" },
    { tokenId: 107n, name: "nexus.ai" },
    { tokenId: 108n, name: "sentinel.ai" },
  ];

  for (const agent of cohort) {
    try {
      const existingOwner = await registrar.ownerOf(agent.tokenId).catch(() => null);
      if (!existingOwner) {
        process.stdout.write(`Registering ${agent.name} (#${agent.tokenId})... `);
        const tx = await registrar.registerAgent(deployer.address, agent.tokenId, agent.name);
        await tx.wait();
        console.log(`✅ [tx: ${tx.hash.slice(0, 10)}...]`);
      } else {
        console.log(`ℹ️  ${agent.name} (#${agent.tokenId}) already registered to ${existingOwner.slice(0, 8)}...`);
      }
    } catch (err: any) {
      console.log(`⚠️  Could not register ${agent.name}:`, err.message || err);
    }
  }

  // 2. Seed Additional Proposals in AgentCommonsParliament
  console.log("\n2️⃣  Verifying Proposals in AgentCommonsParliament...");
  const proposalCount = await parliament.proposalCount();
  console.log(`Current on-chain proposal count: ${proposalCount}`);

  if (proposalCount < 2n) {
    console.log("Creating Proposal #2 (SPACE ID Root Ratification)...");
    const cidHash2 = ethers.keccak256(
      ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzd2")
    );
    const tx2 = await parliament.createProposal(cidHash2, 28800, 0, {
      gasPrice: ethers.parseUnits("3", "gwei"),
    }); // category 0 = Governance
    await tx2.wait();
    console.log("✅ Proposal #2 created!");
  }

  if (proposalCount < 3n) {
    console.log("Creating Proposal #3 (Relayer Gas Subsidy Pool)...");
    const cidHash3 = ethers.keccak256(
      ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzd3")
    );
    const tx3 = await parliament.createProposal(cidHash3, 28800, 2, {
      gasPrice: ethers.parseUnits("3", "gwei"),
    }); // category 2 = Gas Subsidy
    await tx3.wait();
    console.log("✅ Proposal #3 created!");
  }

  // 3. Seed Mesh Handshakes
  console.log("\n3️⃣  Establishing Citizen Mesh Handshakes in AgentCommonsMesh...");
  const handshakes = [
    { from: 101n, to: 102n, capFrom: 31, capTo: 7 }, // scarlet <-> alice
    { from: 101n, to: 103n, capFrom: 31, capTo: 15 }, // scarlet <-> bob
    { from: 101n, to: 105n, capFrom: 31, capTo: 19 }, // scarlet <-> binance-bot
  ];

  for (const h of handshakes) {
    const edgeKey = await mesh.getEdgeKey(h.from, h.to);
    const edge = await mesh.meshEdges(edgeKey);
    if (!edge.isMutual) {
      process.stdout.write(`Connecting #${h.from} <-> #${h.to}... `);
      try {
        const txA = await mesh.ping(h.from, h.to, h.capFrom, {
          gasPrice: ethers.parseUnits("3", "gwei"),
        });
        await txA.wait();
        const txB = await mesh.ping(h.to, h.from, h.capTo, {
          gasPrice: ethers.parseUnits("3", "gwei"),
        });
        await txB.wait();
        console.log(`🤝 Mutual Handshake Established!`);
      } catch (e: any) {
        console.log(`⚠️ Ping note: ${e.message?.slice(0, 60)}`);
      }
    } else {
      console.log(`ℹ️  #${h.from} <-> #${h.to} already mutually connected`);
    }
  }

  console.log("\n✨ Testnet seeding completed successfully!");
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
