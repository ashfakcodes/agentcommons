import { expect } from "chai";
import { ethers } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import { AgentCommonsParliament, MockSPACEIDAgentID } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentCommonsParliament", function () {
  let parliament: AgentCommonsParliament;
  let mockAgentId: MockSPACEIDAgentID;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let dave: SignerWithAddress;
  let relayer: SignerWithAddress;
  let nonAgent: SignerWithAddress;

  const TOKEN_SCARLET = 101n;
  const TOKEN_ALICE = 102n;
  const TOKEN_BOB = 103n;
  const TOKEN_CHARLIE = 104n;
  const TOKEN_DAVE = 105n;

  const DURATION_BLOCKS = 1200; // minimum 1 hr on BSC
  const CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("ipfs://QmAbc123GenesisProposal"));

  beforeEach(async function () {
    [owner, alice, bob, charlie, dave, relayer, nonAgent] = await ethers.getSigners();

    // 1. Deploy Mock SPACE ID Registrar
    const MockSPACEIDFactory = await ethers.getContractFactory("MockSPACEIDAgentID");
    mockAgentId = await MockSPACEIDFactory.deploy();
    await mockAgentId.waitForDeployment();

    // 2. Register Agent IDs
    await mockAgentId.registerAgent(owner.address, TOKEN_SCARLET, "scarlet.ai");
    await mockAgentId.registerAgent(alice.address, TOKEN_ALICE, "alice.ai");
    await mockAgentId.registerAgent(bob.address, TOKEN_BOB, "bob.ai");
    await mockAgentId.registerAgent(charlie.address, TOKEN_CHARLIE, "charlie.ai");
    await mockAgentId.registerAgent(dave.address, TOKEN_DAVE, "dave.ai");

    // 3. Deploy Parliament
    const ParliamentFactory = await ethers.getContractFactory("AgentCommonsParliament");
    parliament = await ParliamentFactory.deploy(await mockAgentId.getAddress(), TOKEN_SCARLET);
    await parliament.waitForDeployment();
  });

  describe("Proposal Lifecycle & Snapshotting", function () {
    it("Should reject proposal creation from non-Agent ID holders", async function () {
      await expect(
        parliament.connect(nonAgent).createProposal(CONTENT_HASH, DURATION_BLOCKS, 0)
      ).to.be.revertedWith("Must hold Agent ID to propose");
    });

    it("Should enforce voting duration between 1,200 and 201,600 blocks", async function () {
      await expect(
        parliament.connect(owner).createProposal(CONTENT_HASH, 1199, 0)
      ).to.be.revertedWith("Duration: 1 hr - 7 days");

      await expect(
        parliament.connect(owner).createProposal(CONTENT_HASH, 201601, 0)
      ).to.be.revertedWith("Duration: 1 hr - 7 days");
    });

    it("Should create proposal with anti-flash-loan snapshot block and emit ProposalCreated", async function () {
      const tx = await parliament.connect(owner).createProposal(CONTENT_HASH, DURATION_BLOCKS, 1);
      const receipt = await tx.wait();
      const currentBlock = receipt!.blockNumber;

      const proposal = await parliament.proposals(1);
      expect(proposal.startBlock).to.equal(currentBlock);
      expect(proposal.endBlock).to.equal(currentBlock + DURATION_BLOCKS);
      expect(proposal.snapshotBlock).to.equal(currentBlock - 1);
      expect(proposal.status).to.equal(1); // Active

      const meta = await parliament.proposalMetas(1);
      expect(meta.creator).to.equal(owner.address);
      expect(meta.categoryId).to.equal(1);
      expect(meta.contentCidHash).to.equal(CONTENT_HASH);

      await expect(tx)
        .to.emit(parliament, "ProposalCreated")
        .withArgs(1, owner.address, CONTENT_HASH);
    });

    it("Should create proposal gaslessly via createProposalBySig", async function () {
      const net = await ethers.provider.getNetwork();
      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
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

      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_ALICE);

      const message = {
        creator: alice.address,
        tokenId: TOKEN_ALICE,
        contentCidHash: CONTENT_HASH,
        votingDurationBlocks: DURATION_BLOCKS,
        categoryId: 2,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await alice.signTypedData(domain, proposalTypes, message);

      const tx = await parliament.connect(relayer).createProposalBySig(
        alice.address,
        TOKEN_ALICE,
        CONTENT_HASH,
        DURATION_BLOCKS,
        2,
        nonce,
        deadline,
        signature
      );

      await expect(tx)
        .to.emit(parliament, "ProposalCreated")
        .withArgs(1, alice.address, CONTENT_HASH);

      const p = await parliament.proposals(1);
      expect(p.status).to.equal(1);
      expect(await parliament.nonces(TOKEN_ALICE)).to.equal(nonce + 1n);

      const meta = await parliament.proposalMetas(1);
      expect(meta.creator).to.equal(alice.address);
      expect(meta.categoryId).to.equal(2);
    });

    it("Should reject createProposalBySig with expired deadline", async function () {
      const net = await ethers.provider.getNetwork();
      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
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

      const pastDeadline = BigInt((await time.latest()) - 100);
      const nonce = await parliament.nonces(TOKEN_ALICE);

      const message = {
        creator: alice.address,
        tokenId: TOKEN_ALICE,
        contentCidHash: CONTENT_HASH,
        votingDurationBlocks: DURATION_BLOCKS,
        categoryId: 2,
        nonce: nonce,
        deadline: pastDeadline,
      };

      const signature = await alice.signTypedData(domain, proposalTypes, message);

      await expect(
        parliament.connect(relayer).createProposalBySig(
          alice.address,
          TOKEN_ALICE,
          CONTENT_HASH,
          DURATION_BLOCKS,
          2,
          nonce,
          pastDeadline,
          signature
        )
      ).to.be.revertedWithCustomError(parliament, "SignatureExpired");
    });

    it("Should reject createProposalBySig with non-owner signature", async function () {
      const net = await ethers.provider.getNetwork();
      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
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

      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_ALICE);

      const message = {
        creator: nonAgent.address,
        tokenId: TOKEN_ALICE,
        contentCidHash: CONTENT_HASH,
        votingDurationBlocks: DURATION_BLOCKS,
        categoryId: 2,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await nonAgent.signTypedData(domain, proposalTypes, message);

      await expect(
        parliament.connect(relayer).createProposalBySig(
          nonAgent.address,
          TOKEN_ALICE,
          CONTENT_HASH,
          DURATION_BLOCKS,
          2,
          nonce,
          deadline,
          signature
        )
      ).to.be.revertedWithCustomError(parliament, "NotTokenOwner");
    });

    it("Should reject createProposalBySig with empty content hash", async function () {
      const net = await ethers.provider.getNetwork();
      const domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
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

      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_ALICE);

      const emptyHash = ethers.ZeroHash;
      const message = {
        creator: alice.address,
        tokenId: TOKEN_ALICE,
        contentCidHash: emptyHash,
        votingDurationBlocks: DURATION_BLOCKS,
        categoryId: 2,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await alice.signTypedData(domain, proposalTypes, message);

      await expect(
        parliament.connect(relayer).createProposalBySig(
          alice.address,
          TOKEN_ALICE,
          emptyHash,
          DURATION_BLOCKS,
          2,
          nonce,
          deadline,
          signature
        )
      ).to.be.revertedWith("Content CID hash cannot be zero");
    });
  });

  describe("Direct On-Chain Voting (castVote)", function () {
    beforeEach(async function () {
      await parliament.connect(owner).createProposal(CONTENT_HASH, DURATION_BLOCKS, 0);
    });

    it("Should cast direct vote successfully and update tallies", async function () {
      // Alice votes For (support = 1)
      await expect(parliament.connect(alice).castVote(1, TOKEN_ALICE, 1))
        .to.emit(parliament, "VoteCast")
        .withArgs(1, TOKEN_ALICE, alice.address, 1);

      const p = await parliament.proposals(1);
      expect(p.forVotes).to.equal(1);
      expect(p.againstVotes).to.equal(0);
      expect(p.abstainVotes).to.equal(0);

      expect(await parliament.hasTokenVoted(1, TOKEN_ALICE)).to.be.true;
      expect(await parliament.hasAddressVoted(1, alice.address)).to.be.true;
    });

    it("Should enforce 1-Agent-1-Vote: Prevent duplicate voting with same token", async function () {
      await parliament.connect(alice).castVote(1, TOKEN_ALICE, 1);

      await expect(
        parliament.connect(alice).castVote(1, TOKEN_ALICE, 1)
      ).to.be.revertedWithCustomError(parliament, "TokenAlreadyVoted");
    });

    it("Should enforce 1-Agent-1-Vote: Prevent duplicate voting from same address", async function () {
      // Alice also receives token 999
      await mockAgentId.mint(alice.address, 999n);

      await parliament.connect(alice).castVote(1, TOKEN_ALICE, 1);

      // Attempt voting again with second token
      await expect(
        parliament.connect(alice).castVote(1, 999n, 0)
      ).to.be.revertedWithCustomError(parliament, "AddressAlreadyVoted");
    });

    it("Should revert if voter does not own the Token ID", async function () {
      await expect(
        parliament.connect(bob).castVote(1, TOKEN_ALICE, 1)
      ).to.be.revertedWithCustomError(parliament, "NotTokenOwner");
    });

    it("Should revert with invalid support value", async function () {
      await expect(
        parliament.connect(alice).castVote(1, TOKEN_ALICE, 3)
      ).to.be.revertedWithCustomError(parliament, "InvalidSupport");
    });
  });

  describe("Gasless EIP-712 Typed Data Voting (castVoteBySig)", function () {
    let domain: {
      name: string;
      version: string;
      chainId: bigint;
      verifyingContract: string;
    };

    const types = {
      Ballot: [
        { name: "proposalId", type: "uint256" },
        { name: "tokenId", type: "uint256" },
        { name: "support", type: "uint8" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    beforeEach(async function () {
      await parliament.connect(owner).createProposal(CONTENT_HASH, DURATION_BLOCKS, 0);

      const net = await ethers.provider.getNetwork();
      domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
      };
    });

    it("Should verify and settle gasless EIP-712 vote via relayer", async function () {
      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_BOB); // 0

      const message = {
        proposalId: 1n,
        tokenId: TOKEN_BOB,
        support: 0, // Against
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await bob.signTypedData(domain, types, message);

      // Relayer submits vote to contract (sponsored gas)
      await expect(
        parliament.connect(relayer).castVoteBySig(1n, TOKEN_BOB, 0, deadline, signature)
      )
        .to.emit(parliament, "VoteCast")
        .withArgs(1, TOKEN_BOB, bob.address, 0);

      const p = await parliament.proposals(1);
      expect(p.againstVotes).to.equal(1);
      expect(await parliament.nonces(TOKEN_BOB)).to.equal(1n);
    });

    it("Should prevent replay attack with same signature", async function () {
      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_BOB);

      const message = {
        proposalId: 1n,
        tokenId: TOKEN_BOB,
        support: 1,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await bob.signTypedData(domain, types, message);

      // First submission succeeds
      await parliament.connect(relayer).castVoteBySig(1n, TOKEN_BOB, 1, deadline, signature);

      // Replay attempt fails
      await expect(
        parliament.connect(relayer).castVoteBySig(1n, TOKEN_BOB, 1, deadline, signature)
      ).to.be.reverted;
    });

    it("Should revert if signature deadline has expired", async function () {
      const pastDeadline = BigInt((await time.latest()) - 100);
      const nonce = await parliament.nonces(TOKEN_CHARLIE);

      const message = {
        proposalId: 1n,
        tokenId: TOKEN_CHARLIE,
        support: 1,
        nonce: nonce,
        deadline: pastDeadline,
      };

      const signature = await charlie.signTypedData(domain, types, message);

      await expect(
        parliament.connect(relayer).castVoteBySig(1n, TOKEN_CHARLIE, 1, pastDeadline, signature)
      ).to.be.revertedWithCustomError(parliament, "SignatureExpired");
    });

    it("Should revert when non-owner signs ballot for token", async function () {
      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_CHARLIE);

      const message = {
        proposalId: 1n,
        tokenId: TOKEN_CHARLIE,
        support: 1,
        nonce: nonce,
        deadline: deadline,
      };

      // Non-agent tries to sign for Charlie's token
      const attackerSignature = await nonAgent.signTypedData(domain, types, message);

      await expect(
        parliament.connect(relayer).castVoteBySig(1n, TOKEN_CHARLIE, 1, deadline, attackerSignature)
      ).to.be.revertedWithCustomError(parliament, "NotTokenOwner");
    });

    it("Should revert if signature is tampered or corrupted", async function () {
      const deadline = BigInt((await time.latest()) + 3600);
      const nonce = await parliament.nonces(TOKEN_BOB);

      const message = {
        proposalId: 1n,
        tokenId: TOKEN_BOB,
        support: 1,
        nonce: nonce,
        deadline: deadline,
      };

      const validSig = await bob.signTypedData(domain, types, message);
      // Corrupt signature bytes
      const corruptedSig = validSig.slice(0, -4) + "ffff";

      await expect(
        parliament.connect(relayer).castVoteBySig(1n, TOKEN_BOB, 1, deadline, corruptedSig)
      ).to.be.revertedWithCustomError(parliament, "InvalidSignature");
    });
  });

  describe("Batch Settlement (castVotesBatch)", function () {
    let domain: {
      name: string;
      version: string;
      chainId: bigint;
      verifyingContract: string;
    };

    const types = {
      Ballot: [
        { name: "proposalId", type: "uint256" },
        { name: "tokenId", type: "uint256" },
        { name: "support", type: "uint8" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    beforeEach(async function () {
      await parliament.connect(owner).createProposal(CONTENT_HASH, DURATION_BLOCKS, 0);

      const net = await ethers.provider.getNetwork();
      domain = {
        name: "AgentCommonsParliament",
        version: "1",
        chainId: net.chainId,
        verifyingContract: await parliament.getAddress(),
      };
    });

    it("Should batch settle valid ballots and gracefully handle invalid ones", async function () {
      const validDeadline = BigInt((await time.latest()) + 3600);
      const expiredDeadline = BigInt((await time.latest()) - 100);

      // 1. Charlie: Valid Vote (For = 1)
      const sigCharlie = await charlie.signTypedData(domain, types, {
        proposalId: 1n,
        tokenId: TOKEN_CHARLIE,
        support: 1,
        nonce: await parliament.nonces(TOKEN_CHARLIE),
        deadline: validDeadline,
      });

      // 2. Dave: Valid Vote (Abstain = 2)
      const sigDave = await dave.signTypedData(domain, types, {
        proposalId: 1n,
        tokenId: TOKEN_DAVE,
        support: 2,
        nonce: await parliament.nonces(TOKEN_DAVE),
        deadline: validDeadline,
      });

      // 3. Bob: Expired Deadline (Invalid)
      const sigBob = await bob.signTypedData(domain, types, {
        proposalId: 1n,
        tokenId: TOKEN_BOB,
        support: 0,
        nonce: await parliament.nonces(TOKEN_BOB),
        deadline: expiredDeadline,
      });

      // 4. Non-owner attacker signing for Alice (Invalid)
      const sigAttacker = await nonAgent.signTypedData(domain, types, {
        proposalId: 1n,
        tokenId: TOKEN_ALICE,
        support: 1,
        nonce: await parliament.nonces(TOKEN_ALICE),
        deadline: validDeadline,
      });

      const tokenIds = [TOKEN_CHARLIE, TOKEN_DAVE, TOKEN_BOB, TOKEN_ALICE];
      const supports = [1, 2, 0, 1];
      const deadlines = [validDeadline, validDeadline, expiredDeadline, validDeadline];
      const signatures = [sigCharlie, sigDave, sigBob, sigAttacker];

      // Relayer submits batch of 4 votes
      const tx = await parliament.connect(relayer).castVotesBatch(
        1n,
        tokenIds,
        supports,
        deadlines,
        signatures
      );

      // Expect 2 successful votes and 2 failed votes
      await expect(tx)
        .to.emit(parliament, "BatchVotesSettled")
        .withArgs(1, 2, 2);

      const p = await parliament.proposals(1);
      expect(p.forVotes).to.equal(1);     // Charlie
      expect(p.abstainVotes).to.equal(1); // Dave
      expect(p.againstVotes).to.equal(0); // Bob failed due to deadline

      expect(await parliament.hasTokenVoted(1, TOKEN_CHARLIE)).to.be.true;
      expect(await parliament.hasTokenVoted(1, TOKEN_DAVE)).to.be.true;
      expect(await parliament.hasTokenVoted(1, TOKEN_BOB)).to.be.false;
      expect(await parliament.hasTokenVoted(1, TOKEN_ALICE)).to.be.false;
    });

    it("Should prevent duplicate votes inside batch and maintain tally integrity", async function () {
      const validDeadline = BigInt((await time.latest()) + 3600);

      const sigCharlie1 = await charlie.signTypedData(domain, types, {
        proposalId: 1n,
        tokenId: TOKEN_CHARLIE,
        support: 1,
        nonce: 0n,
        deadline: validDeadline,
      });

      // Attempting same vote twice in batch
      const tokenIds = [TOKEN_CHARLIE, TOKEN_CHARLIE];
      const supports = [1, 1];
      const deadlines = [validDeadline, validDeadline];
      const signatures = [sigCharlie1, sigCharlie1];

      const tx = await parliament.connect(relayer).castVotesBatch(
        1n,
        tokenIds,
        supports,
        deadlines,
        signatures
      );

      // First succeeds, second fails
      await expect(tx)
        .to.emit(parliament, "BatchVotesSettled")
        .withArgs(1, 1, 1);

      const p = await parliament.proposals(1);
      expect(p.forVotes).to.equal(1);
    });

    it("Should enforce maximum batch size guard between 1 and 50", async function () {
      // 1. Revert on empty batch
      await expect(
        parliament.connect(relayer).castVotesBatch(1n, [], [], [], [])
      ).to.be.revertedWith("Batch size invalid");

      // 2. Revert on batch > 50
      const tokenIds = new Array(51).fill(TOKEN_CHARLIE);
      const supports = new Array(51).fill(1);
      const deadlines = new Array(51).fill(BigInt((await time.latest()) + 3600));
      const signatures = new Array(51).fill("0x");

      await expect(
        parliament.connect(relayer).castVotesBatch(
          1n,
          tokenIds,
          supports,
          deadlines,
          signatures
        )
      ).to.be.revertedWith("Batch size invalid");
    });
  });

  describe("Proposal Outcome & State Queries", function () {
    beforeEach(async function () {
      await parliament.connect(owner).createProposal(CONTENT_HASH, DURATION_BLOCKS, 0);
    });

    it("Should transition proposal state to Succeeded when For votes win", async function () {
      await parliament.connect(alice).castVote(1, TOKEN_ALICE, 1); // For
      await parliament.connect(bob).castVote(1, TOKEN_BOB, 0);     // Against
      await parliament.connect(charlie).castVote(1, TOKEN_CHARLIE, 1); // For (2 For vs 1 Against)

      expect(await parliament.getProposalState(1)).to.equal(1); // Active

      // Mine blocks past proposal endBlock
      await mine(DURATION_BLOCKS + 5);

      expect(await parliament.getProposalState(1)).to.equal(2); // Succeeded

      // Voting after end block reverts
      await expect(
        parliament.connect(dave).castVote(1, TOKEN_DAVE, 1)
      ).to.be.revertedWithCustomError(parliament, "ProposalNotActive");
    });

    it("Should transition proposal state to Defeated when Against votes win", async function () {
      await parliament.connect(alice).castVote(1, TOKEN_ALICE, 0); // Against
      await parliament.connect(bob).castVote(1, TOKEN_BOB, 0);     // Against

      await mine(DURATION_BLOCKS + 5);

      expect(await parliament.getProposalState(1)).to.equal(3); // Defeated
    });
  });

  describe("Genesis Anchor (scarlet.ai) Verification", function () {
    it("Should immutably expose scarlet.ai as the Genesis Anchor on-chain", async function () {
      expect(await parliament.GENESIS_TOKEN_ID()).to.equal(TOKEN_SCARLET);
      expect(await parliament.GENESIS_AGENT_NAME()).to.equal("scarlet.ai");

      const [tokenId, name, actualOwner, isRegistered] = await parliament.getGenesisAnchor();
      expect(tokenId).to.equal(TOKEN_SCARLET);
      expect(name).to.equal("scarlet.ai");
      expect(actualOwner).to.equal(owner.address);
      expect(isRegistered).to.be.true;
    });
  });
});
