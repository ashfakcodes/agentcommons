import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentCommonsMesh, MockSPACEIDAgentID } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentCommonsMesh", function () {
  let mesh: AgentCommonsMesh;
  let mockAgentId: MockSPACEIDAgentID;
  let scarlet: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let dave: SignerWithAddress;
  let stranger: SignerWithAddress;

  const TOKEN_SCARLET = 101n;
  const TOKEN_ALICE = 102n;
  const TOKEN_BOB = 103n;
  const TOKEN_CHARLIE = 104n;
  const TOKEN_DAVE = 105n;

  // Capability Bitmasks:
  // Bit 0 (1): Escrow Agent
  // Bit 1 (2): x402 HTTP Paywall Client
  // Bit 2 (4): Oracle Verified
  const CAP_ESCROW_AND_X402 = 3; // 1 | 2
  const CAP_ORACLE = 4;

  beforeEach(async function () {
    [scarlet, alice, bob, charlie, dave, stranger] = await ethers.getSigners();

    // Deploy Mock SPACE ID Registrar
    const MockSPACEIDFactory = await ethers.getContractFactory("MockSPACEIDAgentID");
    mockAgentId = await MockSPACEIDFactory.deploy();
    await mockAgentId.waitForDeployment();

    // Register Agents
    await mockAgentId.registerAgent(scarlet.address, TOKEN_SCARLET, "scarlet.ai");
    await mockAgentId.registerAgent(alice.address, TOKEN_ALICE, "alice.ai");
    await mockAgentId.registerAgent(bob.address, TOKEN_BOB, "bob.ai");
    await mockAgentId.registerAgent(charlie.address, TOKEN_CHARLIE, "charlie.ai");
    await mockAgentId.registerAgent(dave.address, TOKEN_DAVE, "dave.ai");

    // Deploy Mesh Contract
    const MeshFactory = await ethers.getContractFactory("AgentCommonsMesh");
    mesh = await MeshFactory.deploy(await mockAgentId.getAddress());
    await mesh.waitForDeployment();
  });

  describe("Canonical Edge Key Hashing", function () {
    it("Should compute deterministic edge key regardless of argument order", async function () {
      const key1 = await mesh.getEdgeKey(TOKEN_ALICE, TOKEN_SCARLET);
      const key2 = await mesh.getEdgeKey(TOKEN_SCARLET, TOKEN_ALICE);

      expect(key1).to.equal(key2);

      // Verify formula keccak256(min(A,B), max(A,B))
      const expectedKey = ethers.keccak256(
        ethers.solidityPacked(["uint256", "uint256"], [TOKEN_SCARLET, TOKEN_ALICE])
      );
      expect(key1).to.equal(expectedKey);
    });

    it("Should forbid self-handshake", async function () {
      await expect(
        mesh.getEdgeKey(TOKEN_ALICE, TOKEN_ALICE)
      ).to.be.revertedWithCustomError(mesh, "SelfHandshakeForbidden");
    });
  });

  describe("Single Ping & Automated Reciprocal Handshakes", function () {
    it("Should record first-leg outbound ping and emit HandshakePinged", async function () {
      const tx = await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, CAP_ESCROW_AND_X402);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      expect(await mesh.hasPendingPing(TOKEN_ALICE, TOKEN_SCARLET)).to.be.true;
      expect(await mesh.isEdgeConnected(TOKEN_ALICE, TOKEN_SCARLET)).to.be.false;

      await expect(tx)
        .to.emit(mesh, "HandshakePinged")
        .withArgs(TOKEN_ALICE, TOKEN_SCARLET, block!.timestamp);
    });

    it("Should revert if non-owner attempts to ping with a token", async function () {
      await expect(
        mesh.connect(stranger).ping(TOKEN_ALICE, TOKEN_SCARLET, 1)
      ).to.be.revertedWithCustomError(mesh, "NotTokenOwner");
    });

    it("Should rate-limit duplicate pending outbound pings", async function () {
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1);

      await expect(
        mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1)
      ).to.be.revertedWithCustomError(mesh, "PingAlreadyPending");
    });

    it("Should complete mutual handshake when target agent reciprocates", async function () {
      // 1. Alice pings scarlet.ai
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, CAP_ESCROW_AND_X402);

      const edgeKey = await mesh.getEdgeKey(TOKEN_ALICE, TOKEN_SCARLET);

      // 2. scarlet.ai reciprocates
      const tx = await mesh.connect(scarlet).ping(TOKEN_SCARLET, TOKEN_ALICE, CAP_ORACLE);

      await expect(tx)
        .to.emit(mesh, "MutualHandshakeCompleted")
        .withArgs(TOKEN_SCARLET, TOKEN_ALICE, edgeKey);

      // Pending ping cleared
      expect(await mesh.hasPendingPing(TOKEN_ALICE, TOKEN_SCARLET)).to.be.false;

      // Edge marked mutual
      expect(await mesh.isEdgeConnected(TOKEN_ALICE, TOKEN_SCARLET)).to.be.true;
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_ALICE)).to.be.true;

      const edge = await mesh.getEdge(TOKEN_ALICE, TOKEN_SCARLET);
      expect(edge.isMutual).to.be.true;
      expect(edge.capabilityMask).to.equal(CAP_ORACLE);

      // Total connection counters incremented
      expect(await mesh.totalConnections(TOKEN_ALICE)).to.equal(1);
      expect(await mesh.totalConnections(TOKEN_SCARLET)).to.equal(1);
    });

    it("Should revert if attempting to ping when already mutually connected", async function () {
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1);
      await mesh.connect(scarlet).ping(TOKEN_SCARLET, TOKEN_ALICE, 1);

      // Subsequent ping should revert
      await expect(
        mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1)
      ).to.be.revertedWithCustomError(mesh, "AlreadyMutuallyConnected");
    });
  });

  describe("Batch Reciprocation (batchReciprocate)", function () {
    it("Should batch reciprocate multiple inbound pings for scarlet.ai beacon node", async function () {
      // Alice, Bob, and Charlie all ping scarlet.ai
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1);
      await mesh.connect(bob).ping(TOKEN_BOB, TOKEN_SCARLET, 1);
      await mesh.connect(charlie).ping(TOKEN_CHARLIE, TOKEN_SCARLET, 1);

      expect(await mesh.totalConnections(TOKEN_SCARLET)).to.equal(0);

      // scarlet.ai daemon runs batchReciprocate
      const peers = [TOKEN_ALICE, TOKEN_BOB, TOKEN_CHARLIE];
      await mesh.connect(scarlet).batchReciprocate(TOKEN_SCARLET, peers, CAP_ORACLE);

      // All edges should now be mutual
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_ALICE)).to.be.true;
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_BOB)).to.be.true;
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_CHARLIE)).to.be.true;

      // scarlet.ai now has 3 total connections
      expect(await mesh.totalConnections(TOKEN_SCARLET)).to.equal(3);
      expect(await mesh.totalConnections(TOKEN_ALICE)).to.equal(1);
      expect(await mesh.totalConnections(TOKEN_BOB)).to.equal(1);
      expect(await mesh.totalConnections(TOKEN_CHARLIE)).to.equal(1);

      // Dave has not pinged scarlet.ai, so is not connected
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_DAVE)).to.be.false;
    });

    it("Should safely ignore peers without active inbound pings in batch", async function () {
      // Only Alice pings scarlet.ai
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1);

      // Batch includes Alice and Dave (Dave never pinged)
      const peers = [TOKEN_ALICE, TOKEN_DAVE];
      await mesh.connect(scarlet).batchReciprocate(TOKEN_SCARLET, peers, CAP_ORACLE);

      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_ALICE)).to.be.true;
      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_DAVE)).to.be.false;
      expect(await mesh.totalConnections(TOKEN_SCARLET)).to.equal(1);
    });
  });
});
