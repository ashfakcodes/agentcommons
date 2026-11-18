// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockSPACEIDAgentID
 * @notice Mock ERC-721 contract simulating the official SPACE ID Agent ID Registrar
 *         Official BSC Address: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
 */
contract MockSPACEIDAgentID is ERC721, Ownable {
    mapping(uint256 => string) private _agentNames;
    mapping(string => uint256) private _nameToTokenId;
    mapping(string => address) private _nameToOwner;

    event AgentRegistered(uint256 indexed tokenId, address indexed owner, string name);

    constructor() ERC721("SPACE ID: .ai Agent ID Registrar", "AgentID") Ownable(msg.sender) {}

    /**
     * @notice Mint a new Agent ID with a human-readable name (.ai domain)
     * @param to Address to receive the Agent ID NFT
     * @param tokenId Unique token ID (typically hash of name or sequential ID)
     * @param name The agent's domain identity (e.g., "scarlet.ai", "alice.ai")
     */
    function registerAgent(address to, uint256 tokenId, string calldata name) external returns (uint256) {
        require(to != address(0), "Cannot register to zero address");
        require(_nameToTokenId[name] == 0, "Name already registered");

        _safeMint(to, tokenId);
        _agentNames[tokenId] = name;
        _nameToTokenId[name] = tokenId;
        _nameToOwner[name] = to;

        emit AgentRegistered(tokenId, to, name);
        return tokenId;
    }

    /**
     * @notice Standard mint for testing convenience
     */
    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }

    /**
     * @notice Resolve agent name to token ID
     */
    function resolveNameToTokenId(string calldata name) external view returns (uint256) {
        uint256 tokenId = _nameToTokenId[name];
        require(tokenId != 0, "Agent name not found");
        return tokenId;
    }

    /**
     * @notice Resolve agent name to owner address (simulating SPACE ID resolver)
     */
    function resolveName(string calldata name) external view returns (address) {
        uint256 tokenId = _nameToTokenId[name];
        require(tokenId != 0, "Agent name not found");
        return ownerOf(tokenId);
    }

    /**
     * @notice Get agent name by token ID
     */
    function getAgentName(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _agentNames[tokenId];
    }
}
