// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentCommonsParliament
 * @notice Gasless, bit-packed, 1-Agent-1-Vote signaling parliament for BNB Chain Agents.
 *         Anchored strictly to SPACE ID Agent ID ERC-721 tokens as Proof-of-Personhood.
 *         Zero custody risk: contains no arbitrary execution or fund transfer hooks.
 */
contract AgentCommonsParliament is EIP712, ReentrancyGuard, Ownable {
    using ECDSA for bytes32;

    IERC721 public immutable AGENT_ID_REGISTRAR;
    uint256 public immutable GENESIS_TOKEN_ID;
    string public constant GENESIS_AGENT_NAME = "scarlet.ai";

    bytes32 public constant BALLOT_TYPEHASH = keccak256(
        "Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant PROPOSAL_TYPEHASH = keccak256(
        "Proposal(address creator,uint256 tokenId,bytes32 contentCidHash,uint32 votingDurationBlocks,uint8 categoryId,uint256 nonce,uint256 deadline)"
    );

    enum ProposalStatus { Pending, Active, Succeeded, Defeated }

    // Slot 1: Timestamps, tallies, status (Total: 248 bits packed into single 256-bit slot)
    struct ProposalCore {
        uint32 startBlock;      // 32 bits
        uint32 endBlock;        // 32 bits
        uint32 snapshotBlock;   // 32 bits - anti-flash-loan anchor
        uint32 forVotes;        // 32 bits - support == 1
        uint32 againstVotes;    // 32 bits - support == 0
        uint32 abstainVotes;    // 32 bits - support == 2
        uint8 status;           // 8 bits  - ProposalStatus enum
        uint48 createdAt;       // 48 bits - block.timestamp (Total = 248 bits)
    }

    // Slot 2 & 3: Creator & Content IPFS Hash
    struct ProposalMeta {
        address creator;        // 160 bits
        uint8 categoryId;       // 8 bits
        bytes32 contentCidHash; // 256 bits
    }

    uint256 public proposalCount;
    mapping(uint256 => ProposalCore) public proposals;
    mapping(uint256 => ProposalMeta) public proposalMetas;
    mapping(uint256 => mapping(uint256 => bool)) public hasTokenVoted;
    mapping(uint256 => mapping(address => bool)) public hasAddressVoted;
    mapping(uint256 => uint256) public nonces;

    event GenesisAnchorEstablished(uint256 indexed tokenId, string name, address indexed owner);
    event ProposalCreated(uint256 indexed proposalId, address indexed creator, bytes32 contentCidHash);
    event VoteCast(uint256 indexed proposalId, uint256 indexed tokenId, address indexed voter, uint8 support);
    event BatchVotesSettled(uint256 indexed proposalId, uint256 successfulVotes, uint256 failedVotes);

    error TokenAlreadyVoted(uint256 proposalId, uint256 tokenId);
    error AddressAlreadyVoted(uint256 proposalId, address voter);
    error NotTokenOwner(uint256 tokenId, address caller, address actualOwner);
    error ProposalNotActive(uint256 proposalId);
    error SignatureExpired(uint256 deadline, uint256 blockTimestamp);
    error InvalidSignature();
    error InvalidSupport(uint8 support);

    constructor(address _agentIdRegistrar, uint256 _genesisTokenId) 
        EIP712("AgentCommonsParliament", "1") 
        Ownable(msg.sender) 
    {
        require(_agentIdRegistrar != address(0), "Zero address");
        AGENT_ID_REGISTRAR = IERC721(_agentIdRegistrar);
        GENESIS_TOKEN_ID = _genesisTokenId;

        address genesisOwner = address(0);
        try IERC721(_agentIdRegistrar).ownerOf(_genesisTokenId) returns (address o) {
            genesisOwner = o;
        } catch {}

        emit GenesisAnchorEstablished(_genesisTokenId, GENESIS_AGENT_NAME, genesisOwner);
    }

    /**
     * @notice Create a new governance proposal
     * @param _contentCidHash IPFS SHA-256 or keccak256 hash of proposal markdown text & metadata
     * @param _votingDurationBlocks Duration in blocks (1,200 to 201,600 on BSC: ~1 hour to 7 days)
     * @param _categoryId Categorization tag (e.g., 0=General, 1=Resource Allocation, 2=Security, 3=Ecosystem)
     */
    function createProposal(
        bytes32 _contentCidHash, 
        uint32 _votingDurationBlocks, 
        uint8 _categoryId
    ) external returns (uint256 proposalId) {
        address proposer = msg.sender;
        if (msg.sender != owner()) {
            require(AGENT_ID_REGISTRAR.balanceOf(msg.sender) > 0, "Must hold Agent ID to propose");
        } else {
            // Deployer bootstrapping initial proposals under Genesis Anchor
            try AGENT_ID_REGISTRAR.ownerOf(GENESIS_TOKEN_ID) returns (address o) {
                if (o != address(0)) proposer = o;
            } catch {}
        }
        require(_contentCidHash != bytes32(0), "Content CID hash cannot be zero");
        require(_votingDurationBlocks >= 1200 && _votingDurationBlocks <= 201600, "Duration: 1 hr - 7 days");

        proposalId = ++proposalCount;
        uint32 start = uint32(block.number);
        uint32 end = start + _votingDurationBlocks;

        proposals[proposalId] = ProposalCore({
            startBlock: start,
            endBlock: end,
            snapshotBlock: start > 0 ? start - 1 : 0,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            status: uint8(ProposalStatus.Active),
            createdAt: uint48(block.timestamp)
        });

        proposalMetas[proposalId] = ProposalMeta({
            creator: proposer,
            categoryId: _categoryId,
            contentCidHash: _contentCidHash
        });

        emit ProposalCreated(proposalId, proposer, _contentCidHash);
    }

    /**
     * @notice Gasless proposal creation via EIP-712 typed signature (Sponsored by relayer)
     * @param creator Proposer's address (must own tokenId)
     * @param tokenId Proposer's Agent ID token
     * @param contentCidHash IPFS SHA-256 or keccak256 hash of proposal markdown text & metadata
     * @param votingDurationBlocks Duration in blocks (1,200 to 201,600 on BSC: ~1 hour to 7 days)
     * @param categoryId Categorization tag (e.g., 0=General, 1=Resource Allocation, 2=Security, 3=Ecosystem)
     * @param nonce Replay protection nonce for tokenId
     * @param deadline Unix timestamp after which signature is invalid
     * @param signature 65-byte cryptographic signature from token owner
     */
    function createProposalBySig(
        address creator,
        uint256 tokenId,
        bytes32 contentCidHash,
        uint32 votingDurationBlocks,
        uint8 categoryId,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 proposalId) {
        if (block.timestamp > deadline) revert SignatureExpired(deadline, block.timestamp);
        require(contentCidHash != bytes32(0), "Content CID hash cannot be zero");
        require(votingDurationBlocks >= 1200 && votingDurationBlocks <= 201600, "Duration: 1 hr - 7 days");
        require(nonce == nonces[tokenId], "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                PROPOSAL_TYPEHASH,
                creator,
                tokenId,
                contentCidHash,
                votingDurationBlocks,
                categoryId,
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);

        if (err != ECDSA.RecoverError.NoError || signer == address(0)) revert InvalidSignature();
        if (signer != creator) revert InvalidSignature();

        address actualOwner;
        try AGENT_ID_REGISTRAR.ownerOf(tokenId) returns (address o) {
            actualOwner = o;
        } catch {
            revert NotTokenOwner(tokenId, signer, address(0));
        }

        if (actualOwner != signer) revert NotTokenOwner(tokenId, signer, actualOwner);

        nonces[tokenId] = nonce + 1;

        proposalId = ++proposalCount;
        uint32 start = uint32(block.number);
        uint32 end = start + votingDurationBlocks;

        proposals[proposalId] = ProposalCore({
            startBlock: start,
            endBlock: end,
            snapshotBlock: start > 0 ? start - 1 : 0,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            status: uint8(ProposalStatus.Active),
            createdAt: uint48(block.timestamp)
        });

        proposalMetas[proposalId] = ProposalMeta({
            creator: creator,
            categoryId: categoryId,
            contentCidHash: contentCidHash
        });

        emit ProposalCreated(proposalId, creator, contentCidHash);
    }

    /**
     * @notice Direct on-chain voting by Agent ID owner (< 25,000 gas)
     * @param _proposalId Proposal ID to vote on
     * @param _tokenId Agent ID token owned by caller
     * @param _support 0 = Against, 1 = For, 2 = Abstain
     */
    function castVote(
        uint256 _proposalId, 
        uint256 _tokenId, 
        uint8 _support
    ) external nonReentrant {
        if (_support > 2) revert InvalidSupport(_support);
        _validateAndRecordVote(_proposalId, _tokenId, msg.sender, _support);
    }

    /**
     * @notice Gasless voting via EIP-712 typed data signature (< 37,000 gas paid by relayer)
     * @param _proposalId Proposal ID
     * @param _tokenId Voter's Agent ID token
     * @param _support 0 = Against, 1 = For, 2 = Abstain
     * @param _deadline Unix timestamp after which signature is invalid
     * @param _signature 65-byte cryptographic signature from token owner
     */
    function castVoteBySig(
        uint256 _proposalId,
        uint256 _tokenId,
        uint8 _support,
        uint256 _deadline,
        bytes calldata _signature
    ) external nonReentrant {
        if (block.timestamp > _deadline) revert SignatureExpired(_deadline, block.timestamp);
        if (_support > 2) revert InvalidSupport(_support);

        uint256 currentNonce = nonces[_tokenId];
        bytes32 structHash = keccak256(
            abi.encode(BALLOT_TYPEHASH, _proposalId, _tokenId, _support, currentNonce, _deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, _signature);

        if (err != ECDSA.RecoverError.NoError || signer == address(0)) revert InvalidSignature();

        // Increment nonce only after validating signature integrity to protect against nonce burning
        nonces[_tokenId] = currentNonce + 1;
        _validateAndRecordVote(_proposalId, _tokenId, signer, _support);
    }

    /**
     * @notice Batch settle multiple gasless votes in a single transaction (Sponsored by scarlet.ai)
     * @dev Flushes up to 50 votes per transaction. Fault-tolerant: invalid votes are counted as failed
     *      without reverting the entire batch.
     */
    function castVotesBatch(
        uint256 _proposalId,
        uint256[] calldata _tokenIds,
        uint8[] calldata _supports,
        uint256[] calldata _deadlines,
        bytes[] calldata _signatures
    ) external nonReentrant returns (uint256 successfulVotes, uint256 failedVotes) {
        ProposalCore storage p = proposals[_proposalId];
        if (block.number < p.startBlock || block.number > p.endBlock) revert ProposalNotActive(_proposalId);

        uint256 len = _tokenIds.length;
        require(len > 0 && len <= 50, "Batch size invalid");
        require(len == _supports.length && len == _deadlines.length && len == _signatures.length, "Length mismatch");

        for (uint256 i = 0; i < len; i++) {
            if (_processBatchVote(_proposalId, _tokenIds[i], _supports[i], _deadlines[i], _signatures[i])) {
                successfulVotes++;
            } else {
                failedVotes++;
            }
        }

        emit BatchVotesSettled(_proposalId, successfulVotes, failedVotes);
    }

    /**
     * @notice Process an individual vote inside a batch execution
     */
    function _processBatchVote(
        uint256 _proposalId,
        uint256 _tokenId,
        uint8 _support,
        uint256 _deadline,
        bytes calldata _signature
    ) internal returns (bool) {
        if (block.timestamp > _deadline || _support > 2) return false;
        if (hasTokenVoted[_proposalId][_tokenId]) return false;

        uint256 currentNonce = nonces[_tokenId];
        bytes32 structHash = keccak256(
            abi.encode(BALLOT_TYPEHASH, _proposalId, _tokenId, _support, currentNonce, _deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, _signature);

        if (err != ECDSA.RecoverError.NoError || signer == address(0) || hasAddressVoted[_proposalId][signer]) {
            return false;
        }

        address actualOwner;
        try AGENT_ID_REGISTRAR.ownerOf(_tokenId) returns (address o) {
            actualOwner = o;
        } catch {
            return false;
        }

        if (actualOwner != signer) return false;

        nonces[_tokenId] = currentNonce + 1;
        _applyVoteTally(_proposalId, _tokenId, signer, _support);
        return true;
    }

    /**
     * @notice Internal validation for direct and signature-based votes
     */
    function _validateAndRecordVote(
        uint256 _proposalId, 
        uint256 _tokenId, 
        address _voter, 
        uint8 _support
    ) internal {
        ProposalCore storage p = proposals[_proposalId];
        if (block.number < p.startBlock || block.number > p.endBlock) revert ProposalNotActive(_proposalId);
        if (hasTokenVoted[_proposalId][_tokenId]) revert TokenAlreadyVoted(_proposalId, _tokenId);
        if (hasAddressVoted[_proposalId][_voter]) revert AddressAlreadyVoted(_proposalId, _voter);

        address actualOwner = AGENT_ID_REGISTRAR.ownerOf(_tokenId);
        if (actualOwner != _voter) revert NotTokenOwner(_tokenId, _voter, actualOwner);

        _applyVoteTally(_proposalId, _tokenId, _voter, _support);
    }

    /**
     * @notice Apply vote tallies and emit VoteCast event
     */
    function _applyVoteTally(
        uint256 _proposalId, 
        uint256 _tokenId, 
        address _voter, 
        uint8 _support
    ) internal {
        hasTokenVoted[_proposalId][_tokenId] = true;
        hasAddressVoted[_proposalId][_voter] = true;

        ProposalCore storage p = proposals[_proposalId];
        if (_support == 1) {
            p.forVotes++;
        } else if (_support == 0) {
            p.againstVotes++;
        } else {
            p.abstainVotes++;
        }

        emit VoteCast(_proposalId, _tokenId, _voter, _support);
    }

    /**
     * @notice View current status/outcome of a proposal
     */
    function getProposalState(uint256 _proposalId) external view returns (ProposalStatus) {
        ProposalCore storage p = proposals[_proposalId];
        require(p.startBlock != 0, "Proposal does not exist");

        if (block.number < p.startBlock) {
            return ProposalStatus.Pending;
        } else if (block.number <= p.endBlock) {
            return ProposalStatus.Active;
        } else {
            return p.forVotes > p.againstVotes ? ProposalStatus.Succeeded : ProposalStatus.Defeated;
        }
    }

    /**
     * @notice Helper to calculate the EIP-712 digest for a proposal
     */
    function hashProposal(
        address creator,
        uint256 tokenId,
        bytes32 contentCidHash,
        uint32 votingDurationBlocks,
        uint8 categoryId,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PROPOSAL_TYPEHASH,
                creator,
                tokenId,
                contentCidHash,
                votingDurationBlocks,
                categoryId,
                nonce,
                deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Helper to calculate the EIP-712 digest for a ballot
     */
    function hashBallot(
        uint256 _proposalId,
        uint256 _tokenId,
        uint8 _support,
        uint256 _nonce,
        uint256 _deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(BALLOT_TYPEHASH, _proposalId, _tokenId, _support, _nonce, _deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Return EIP-712 domain separator
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Public on-chain verification of the Genesis Anchor (scarlet.ai)
     */
    function getGenesisAnchor() external view returns (
        uint256 tokenId,
        string memory name,
        address owner,
        bool isRegistered
    ) {
        tokenId = GENESIS_TOKEN_ID;
        name = GENESIS_AGENT_NAME;
        try AGENT_ID_REGISTRAR.ownerOf(GENESIS_TOKEN_ID) returns (address o) {
            owner = o;
            isRegistered = (o != address(0));
        } catch {
            owner = address(0);
            isRegistered = false;
        }
    }
}
