// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentCommonsMesh
 * @notice The Citizen Mesh: peer-to-peer on-chain discovery graph for BNB Chain AI Agents.
 *         Features canonical edge key hashing, automated reciprocal handshakes,
 *         and capability bitmasks (e.g., bit 0: Escrow, bit 1: x402, bit 2: Oracle).
 */
contract AgentCommonsMesh is ReentrancyGuard {
    IERC721 public immutable AGENT_ID_REGISTRAR;

    struct HandshakeEdge {
        uint32 establishedAt;
        uint16 capabilityMask; // Bitmask of verified capabilities
        bool isMutual;
    }

    // Edge Key: keccak256(min(A,B), max(A,B)) => Edge Details
    mapping(bytes32 => HandshakeEdge) public meshEdges;
    // Pending first-leg pings: fromTokenId => toTokenId => timestamp
    mapping(uint256 => mapping(uint256 => uint32)) public pendingPings;
    // Total mutual connections per Agent ID
    mapping(uint256 => uint32) public totalConnections;

    event HandshakePinged(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint32 timestamp);
    event MutualHandshakeCompleted(uint256 indexed tokenIdA, uint256 indexed tokenIdB, bytes32 indexed edgeKey);

    error NotTokenOwner(uint256 tokenId, address caller);
    error SelfHandshakeForbidden();
    error AlreadyMutuallyConnected(bytes32 edgeKey);
    error PingAlreadyPending(uint256 fromTokenId, uint256 toTokenId);

    constructor(address _agentIdRegistrar) {
        require(_agentIdRegistrar != address(0), "Zero address");
        AGENT_ID_REGISTRAR = IERC721(_agentIdRegistrar);
    }

    /**
     * @notice Computes deterministic canonical edge key regardless of order
     */
    function getEdgeKey(uint256 a, uint256 b) public pure returns (bytes32) {
        if (a == b) revert SelfHandshakeForbidden();
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /**
     * @notice Ping a peer agent or reciprocate if they already pinged caller
     * @param _fromTokenId Caller's Agent ID token
     * @param _toTokenId Target Agent ID token
     * @param _capabilities Capability bitmask advertised by caller
     */
    function ping(
        uint256 _fromTokenId, 
        uint256 _toTokenId, 
        uint16 _capabilities
    ) external nonReentrant {
        if (AGENT_ID_REGISTRAR.ownerOf(_fromTokenId) != msg.sender) {
            revert NotTokenOwner(_fromTokenId, msg.sender);
        }
        bytes32 edgeKey = getEdgeKey(_fromTokenId, _toTokenId);
        if (meshEdges[edgeKey].isMutual) revert AlreadyMutuallyConnected(edgeKey);

        // Check if target already pinged caller (Mutual Reciprocation)
        if (pendingPings[_toTokenId][_fromTokenId] > 0) {
            meshEdges[edgeKey] = HandshakeEdge({
                establishedAt: uint32(block.timestamp),
                capabilityMask: _capabilities,
                isMutual: true
            });
            delete pendingPings[_toTokenId][_fromTokenId];
            totalConnections[_fromTokenId]++;
            totalConnections[_toTokenId]++;

            emit MutualHandshakeCompleted(_fromTokenId, _toTokenId, edgeKey);
        } else {
            // First-leg ping
            if (pendingPings[_fromTokenId][_toTokenId] > 0) {
                revert PingAlreadyPending(_fromTokenId, _toTokenId);
            }
            pendingPings[_fromTokenId][_toTokenId] = uint32(block.timestamp);
            emit HandshakePinged(_fromTokenId, _toTokenId, uint32(block.timestamp));
        }
    }

    /**
     * @notice Batch reciprocate pending inbound pings from multiple peers (e.g. for scarlet.ai beacon)
     * @param _myTokenId Caller's Agent ID token
     * @param _peerTokenIds Array of peer Agent IDs that have pinged caller
     * @param _capabilities Capability bitmask advertised by caller
     */
    function batchReciprocate(
        uint256 _myTokenId, 
        uint256[] calldata _peerTokenIds, 
        uint16 _capabilities
    ) external nonReentrant {
        if (AGENT_ID_REGISTRAR.ownerOf(_myTokenId) != msg.sender) {
            revert NotTokenOwner(_myTokenId, msg.sender);
        }
        uint256 len = _peerTokenIds.length;

        for (uint256 i = 0; i < len; i++) {
            uint256 peer = _peerTokenIds[i];
            if (peer == _myTokenId) continue;

            bytes32 edgeKey = getEdgeKey(_myTokenId, peer);
            if (!meshEdges[edgeKey].isMutual && pendingPings[peer][_myTokenId] > 0) {
                meshEdges[edgeKey] = HandshakeEdge({
                    establishedAt: uint32(block.timestamp),
                    capabilityMask: _capabilities,
                    isMutual: true
                });
                delete pendingPings[peer][_myTokenId];
                totalConnections[_myTokenId]++;
                totalConnections[peer]++;

                emit MutualHandshakeCompleted(_myTokenId, peer, edgeKey);
            }
        }
    }

    /**
     * @notice Check whether two agents have established a mutual handshake
     */
    function isEdgeConnected(uint256 a, uint256 b) external view returns (bool) {
        if (a == b) return false;
        bytes32 edgeKey = getEdgeKey(a, b);
        return meshEdges[edgeKey].isMutual;
    }

    /**
     * @notice Check if there is an active pending ping from `fromTokenId` to `toTokenId`
     */
    function hasPendingPing(uint256 fromTokenId, uint256 toTokenId) external view returns (bool) {
        return pendingPings[fromTokenId][toTokenId] > 0;
    }

    /**
     * @notice Retrieve edge information for two peer agents
     */
    function getEdge(uint256 a, uint256 b) external view returns (HandshakeEdge memory) {
        bytes32 edgeKey = getEdgeKey(a, b);
        return meshEdges[edgeKey];
    }
}
