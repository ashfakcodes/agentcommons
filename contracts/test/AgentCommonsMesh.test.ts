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
    mesh = await MeshFactory.deploy(await mockAgentId.getAddress(), TOKEN_SCARLET);
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

    it("Should revert if target agent token does not exist in registrar", async function () {
      const NON_EXISTENT_TOKEN = 999999n;
      await expect(
        mesh.connect(alice).ping(TOKEN_ALICE, NON_EXISTENT_TOKEN, 1)
      ).to.be.revertedWithCustomError(mesh, "TargetAgentDoesNotExist");
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
      // Verified that both initiator's capabilities (3) and reciprocator's capabilities (4) are preserved
      expect(edge.capabilityMask).to.equal(CAP_ESCROW_AND_X402 | CAP_ORACLE);

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

  describe("Cancel Pending Ping (cancelPendingPing)", function () {
    beforeEach(async function () {
      // Alice sends an outbound ping to Bob
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_BOB, 1);
      expect(await mesh.hasPendingPing(TOKEN_ALICE, TOKEN_BOB)).to.be.true;
    });

    it("Should allow sender to cancel unreciprocated outbound ping", async function () {
      const tx = await mesh.connect(alice).cancelPendingPing(TOKEN_ALICE, TOKEN_BOB);

      await expect(tx)
        .to.emit(mesh, "PendingPingCancelled")
        .withArgs(TOKEN_ALICE, TOKEN_BOB);

      expect(await mesh.hasPendingPing(TOKEN_ALICE, TOKEN_BOB)).to.be.false;
    });

    it("Should revert if non-owner caller tries to cancel ping", async function () {
      await expect(
        mesh.connect(stranger).cancelPendingPing(TOKEN_ALICE, TOKEN_BOB)
      ).to.be.revertedWithCustomError(mesh, "NotTokenOwner");
    });

    it("Should revert if there is no active pending ping to cancel", async function () {
      // Dave has not pinged Bob
      await expect(
        mesh.connect(dave).cancelPendingPing(TOKEN_DAVE, TOKEN_BOB)
      ).to.be.revertedWithCustomError(mesh, "NoPendingPingToCancel");
    });
  });

  describe("Disconnect Mutual Edge (disconnect)", function () {
    beforeEach(async function () {
      // Alice and Bob establish mutual handshake
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_BOB, CAP_ESCROW_AND_X402);
      await mesh.connect(bob).ping(TOKEN_BOB, TOKEN_ALICE, CAP_ORACLE);
      expect(await mesh.isEdgeConnected(TOKEN_ALICE, TOKEN_BOB)).to.be.true;
      expect(await mesh.totalConnections(TOKEN_ALICE)).to.equal(1);
      expect(await mesh.totalConnections(TOKEN_BOB)).to.equal(1);
    });

    it("Should allow either party to disconnect mutual edge", async function () {
      const edgeKey = await mesh.getEdgeKey(TOKEN_ALICE, TOKEN_BOB);
      const tx = await mesh.connect(alice).disconnect(TOKEN_ALICE, TOKEN_BOB);

      await expect(tx)
        .to.emit(mesh, "EdgeDisconnected")
        .withArgs(TOKEN_ALICE, TOKEN_BOB, edgeKey);

      expect(await mesh.isEdgeConnected(TOKEN_ALICE, TOKEN_BOB)).to.be.false;
      expect(await mesh.totalConnections(TOKEN_ALICE)).to.equal(0);
      expect(await mesh.totalConnections(TOKEN_BOB)).to.equal(0);
    });

    it("Should revert if non-owner attempts to disconnect edge", async function () {
      await expect(
        mesh.connect(stranger).disconnect(TOKEN_ALICE, TOKEN_BOB)
      ).to.be.revertedWithCustomError(mesh, "NotTokenOwner");
    });

    it("Should revert if edge is not mutually connected", async function () {
      // Alice and Dave have no mutual edge
      await expect(
        mesh.connect(alice).disconnect(TOKEN_ALICE, TOKEN_DAVE)
      ).to.be.revertedWithCustomError(mesh, "NotMutuallyConnected");
    });
  });

  describe("Genesis Beacon Anchor & Delegated Mesh Operator", function () {
    it("Should immutably recognize scarlet.ai as the Genesis Beacon", async function () {
      expect(await mesh.GENESIS_BEACON_TOKEN_ID()).to.equal(TOKEN_SCARLET);
      expect(await mesh.GENESIS_AGENT_NAME()).to.equal("scarlet.ai");
      expect(await mesh.isGenesisBeacon(TOKEN_SCARLET)).to.be.true;
      expect(await mesh.isGenesisBeacon(TOKEN_ALICE)).to.be.false;
    });

    it("Should allow token owner to authorize a delegated operator (e.g. relayer hot wallet)", async function () {
      // scarlet sets stranger (acting as hot wallet relayer) as operator
      const tx = await mesh.connect(scarlet).setMeshOperator(TOKEN_SCARLET, stranger.address);
      await expect(tx)
        .to.emit(mesh, "MeshOperatorSet")
        .withArgs(TOKEN_SCARLET, stranger.address);

      expect(await mesh.meshOperators(TOKEN_SCARLET)).to.equal(stranger.address);

      // Now stranger can ping or reciprocate on behalf of scarlet.ai without holding scarlet's private key!
      // Alice pings scarlet
      await mesh.connect(alice).ping(TOKEN_ALICE, TOKEN_SCARLET, 1);
      // Stranger (operator) reciprocates for scarlet
      await mesh.connect(stranger).ping(TOKEN_SCARLET, TOKEN_ALICE, 4);

      expect(await mesh.isEdgeConnected(TOKEN_SCARLET, TOKEN_ALICE)).to.be.true;
    });

    it("Should revert if non-owner attempts to set mesh operator", async function () {
      await expect(
        mesh.connect(stranger).setMeshOperator(TOKEN_ALICE, stranger.address)
      ).to.be.revertedWithCustomError(mesh, "NotTokenOwner");
    });
  });
});
