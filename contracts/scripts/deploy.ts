import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Official SPACE ID Agent ID Registrar on BSC Mainnet
const OFFICIAL_SPACE_ID_REGISTRAR_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("=================================================");
  console.log("🏛️  AgentCommons Deployment Engine");
  console.log(`Network: ${network.name} (Chain ID: ${chainId})`);
  console.log(`Deployer Address: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  console.log("=================================================");

  let registrarAddress: string;

  if (chainId === 56) {
    // BSC Mainnet: Use official SPACE ID Registrar
    console.log(`Using official SPACE ID Registrar on BSC Mainnet: ${OFFICIAL_SPACE_ID_REGISTRAR_MAINNET}`);
    registrarAddress = OFFICIAL_SPACE_ID_REGISTRAR_MAINNET;
  } else {
    // BSC Testnet (97) or Local Hardhat (31337):
    if (process.env.SPACEID_REGISTRAR_TESTNET && ethers.isAddress(process.env.SPACEID_REGISTRAR_TESTNET)) {
      registrarAddress = process.env.SPACEID_REGISTRAR_TESTNET;
      console.log(`Using configured Testnet SPACE ID Registrar: ${registrarAddress}`);
    } else {
      console.log("Deploying MockSPACEIDAgentID Registrar for testing...");
      const MockFactory = await ethers.getContractFactory("MockSPACEIDAgentID");
      const mockRegistrar = await MockFactory.deploy();
      await mockRegistrar.waitForDeployment();
      registrarAddress = await mockRegistrar.getAddress();
      console.log(`✅ MockSPACEIDAgentID deployed at: ${registrarAddress}`);

      // Seed genesis agents
      console.log("Seeding Genesis Agent IDs: scarlet.ai (#101), alice.ai (#102)...");
      await mockRegistrar.registerAgent(deployer.address, 101n, "scarlet.ai");
      console.log("✅ scarlet.ai (#101) registered to deployer");
    }
  }

  const genesisTokenId = BigInt(process.env.SCARLET_TOKEN_ID || "101");
  console.log(`Genesis Anchor Token ID (scarlet.ai): #${genesisTokenId}`);

  // 1. Deploy AgentCommonsParliament
  console.log("\nDeploying AgentCommonsParliament.sol...");
  const ParliamentFactory = await ethers.getContractFactory("AgentCommonsParliament");
  const parliament = await ParliamentFactory.deploy(registrarAddress, genesisTokenId);
  await parliament.waitForDeployment();
  const parliamentAddress = await parliament.getAddress();
  console.log(`✅ AgentCommonsParliament deployed at: ${parliamentAddress}`);

  // 2. Deploy AgentCommonsMesh
  console.log("\nDeploying AgentCommonsMesh.sol...");
  const MeshFactory = await ethers.getContractFactory("AgentCommonsMesh");
  const mesh = await MeshFactory.deploy(registrarAddress, genesisTokenId);
  await mesh.waitForDeployment();
  const meshAddress = await mesh.getAddress();
  console.log(`✅ AgentCommonsMesh deployed at: ${meshAddress}`);

  // 3. Genesis Proposal Initialization (if deployer owns an Agent ID)
  try {
    const registrarContract = await ethers.getContractAt(
      ["function balanceOf(address owner) view returns (uint256)"],
      registrarAddress
    );
    const balance = await registrarContract.balanceOf(deployer.address);
    if (balance > 0n) {
      console.log("\nCreating Genesis Proposal #1...");
      const proposalCidHash = ethers.keccak256(
        ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
      );
      const tx = await parliament.createProposal(proposalCidHash, 28800, 0); // 24-hr duration (28,800 blocks @ 3s)
      await tx.wait();
      console.log("✅ Genesis Proposal #1 created!");
    }
  } catch (err) {
    console.log("Skipping proposal creation (deployer has no registered Agent ID).");
  }

  // 4. Save Deployment Manifest
  const deploymentManifest = {
    network: network.name,
    chainId: chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      SPACE_ID_REGISTRAR: registrarAddress,
      AgentCommonsParliament: parliamentAddress,
      AgentCommonsMesh: meshAddress,
    },
    genesisProposalId: 1,
    genesisAgent: {
      name: "scarlet.ai",
      tokenId: 101,
      owner: deployer.address,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const networkFileName = chainId === 56 ? "bsc-mainnet.json" : chainId === 97 ? "bsc-testnet.json" : "localhost.json";
  fs.writeFileSync(
    path.join(deploymentsDir, networkFileName),
    JSON.stringify(deploymentManifest, null, 2)
  );
  fs.writeFileSync(
    path.resolve(__dirname, "../deployments.json"),
    JSON.stringify(deploymentManifest, null, 2)
  );

  console.log(`\n🎉 Deployment manifest saved to deployments/${networkFileName} and deployments.json!`);
  console.log("=================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
