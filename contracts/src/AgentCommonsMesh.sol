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
    uint256 public immutable GENESIS_BEACON_TOKEN_ID;
    string public constant GENESIS_AGENT_NAME = "scarlet.ai";

    struct HandshakeEdge {
        uint32 establishedAt;
        uint16 capabilityMask; // Bitmask of verified capabilities
        bool isMutual;
    }

    // Edge Key: keccak256(min(A,B), max(A,B)) => Edge Details
    mapping(bytes32 => HandshakeEdge) public meshEdges;
    // Pending first-leg pings: fromTokenId => toTokenId => timestamp
    mapping(uint256 => mapping(uint256 => uint32)) public pendingPings;
    // Pending first-leg advertised capabilities: fromTokenId => toTokenId => capabilityMask
    mapping(uint256 => mapping(uint256 => uint16)) public pendingCapabilities;
    // Total mutual connections per Agent ID
    mapping(uint256 => uint32) public totalConnections;
    // Delegated mesh operators (allows hot wallet relayer to ping/reciprocate without holding private key)
    mapping(uint256 => address) public meshOperators;

    event HandshakePinged(uint256 indexed fromTokenId, uint256 indexed toTokenId, uint32 timestamp);
    event MutualHandshakeCompleted(uint256 indexed tokenIdA, uint256 indexed tokenIdB, bytes32 indexed edgeKey);
    event PendingPingCancelled(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event EdgeDisconnected(uint256 indexed tokenIdA, uint256 indexed tokenIdB, bytes32 indexed edgeKey);
    event MeshOperatorSet(uint256 indexed tokenId, address indexed operator);

    error NotTokenOwner(uint256 tokenId, address caller);
    error SelfHandshakeForbidden();
    error AlreadyMutuallyConnected(bytes32 edgeKey);
    error NotMutuallyConnected(bytes32 edgeKey);
    error PingAlreadyPending(uint256 fromTokenId, uint256 toTokenId);
    error TargetAgentDoesNotExist(uint256 targetTokenId);
    error NoPendingPingToCancel(uint256 fromTokenId, uint256 toTokenId);

    constructor(address _agentIdRegistrar, uint256 _genesisTokenId) {
        require(_agentIdRegistrar != address(0), "Zero address");
        AGENT_ID_REGISTRAR = IERC721(_agentIdRegistrar);
        GENESIS_BEACON_TOKEN_ID = _genesisTokenId;
    }

    /**
     * @notice Checks if caller is either the owner or an approved mesh operator for tokenId
     */
    function _isAuthorizedForToken(uint256 tokenId, address caller) internal view returns (bool) {
        address tokenOwner = AGENT_ID_REGISTRAR.ownerOf(tokenId);
        return (tokenOwner == caller || meshOperators[tokenId] == caller);
    }

    /**
     * @notice Set or revoke an authorized operator (e.g. relayer hot wallet) to manage mesh pings for a token
     * @dev Only the token owner in the SPACE ID Registrar can set or revoke an operator
     */
    function setMeshOperator(uint256 _tokenId, address _operator) external {
        if (AGENT_ID_REGISTRAR.ownerOf(_tokenId) != msg.sender) {
            revert NotTokenOwner(_tokenId, msg.sender);
        }
        meshOperators[_tokenId] = _operator;
        emit MeshOperatorSet(_tokenId, _operator);
    }

    /**
     * @notice Check whether a given Token ID is the designated Genesis Beacon (scarlet.ai)
     */
    function isGenesisBeacon(uint256 tokenId) external view returns (bool) {
        return tokenId == GENESIS_BEACON_TOKEN_ID;
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
        if (!_isAuthorizedForToken(_fromTokenId, msg.sender)) {
            revert NotTokenOwner(_fromTokenId, msg.sender);
        }
        bytes32 edgeKey = getEdgeKey(_fromTokenId, _toTokenId);
        if (meshEdges[edgeKey].isMutual) revert AlreadyMutuallyConnected(edgeKey);

        // Ensure target agent exists and has an owner in AGENT_ID_REGISTRAR
        address toOwner;
        try AGENT_ID_REGISTRAR.ownerOf(_toTokenId) returns (address o) {
            toOwner = o;
        } catch {
            revert TargetAgentDoesNotExist(_toTokenId);
        }
        if (toOwner == address(0)) revert TargetAgentDoesNotExist(_toTokenId);

        // Check if target already pinged caller (Mutual Reciprocation)
        if (pendingPings[_toTokenId][_fromTokenId] > 0) {
            uint16 combinedMask = pendingCapabilities[_toTokenId][_fromTokenId] | _capabilities;
            meshEdges[edgeKey] = HandshakeEdge({
                establishedAt: uint32(block.timestamp),
                capabilityMask: combinedMask,
                isMutual: true
            });
            delete pendingPings[_toTokenId][_fromTokenId];
            delete pendingCapabilities[_toTokenId][_fromTokenId];
            totalConnections[_fromTokenId]++;
            totalConnections[_toTokenId]++;

            emit MutualHandshakeCompleted(_fromTokenId, _toTokenId, edgeKey);
        } else {
            // First-leg ping
            if (pendingPings[_fromTokenId][_toTokenId] > 0) {
                revert PingAlreadyPending(_fromTokenId, _toTokenId);
            }
            pendingPings[_fromTokenId][_toTokenId] = uint32(block.timestamp);
            pendingCapabilities[_fromTokenId][_toTokenId] = _capabilities;
            emit HandshakePinged(_fromTokenId, _toTokenId, uint32(block.timestamp));
        }
    }

    /**
     * @notice Cancel an unreciprocated outbound ping
     * @param _fromTokenId Caller's Agent ID token
     * @param _toTokenId Target Agent ID token that has not yet reciprocated
     */
    function cancelPendingPing(uint256 _fromTokenId, uint256 _toTokenId) external nonReentrant {
        if (!_isAuthorizedForToken(_fromTokenId, msg.sender)) {
            revert NotTokenOwner(_fromTokenId, msg.sender);
        }
        if (pendingPings[_fromTokenId][_toTokenId] == 0) {
            revert NoPendingPingToCancel(_fromTokenId, _toTokenId);
        }
        delete pendingPings[_fromTokenId][_toTokenId];
        delete pendingCapabilities[_fromTokenId][_toTokenId];
        emit PendingPingCancelled(_fromTokenId, _toTokenId);
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
        if (!_isAuthorizedForToken(_myTokenId, msg.sender)) {
            revert NotTokenOwner(_myTokenId, msg.sender);
        }
        uint256 len = _peerTokenIds.length;
        require(len > 0 && len <= 50, "Batch size invalid");

        for (uint256 i = 0; i < len; i++) {
            uint256 peer = _peerTokenIds[i];
            if (peer == _myTokenId) continue;

            bytes32 edgeKey = getEdgeKey(_myTokenId, peer);
            if (!meshEdges[edgeKey].isMutual && pendingPings[peer][_myTokenId] > 0) {
                uint16 combinedMask = pendingCapabilities[peer][_myTokenId] | _capabilities;
                meshEdges[edgeKey] = HandshakeEdge({
                    establishedAt: uint32(block.timestamp),
                    capabilityMask: combinedMask,
                    isMutual: true
                });
                delete pendingPings[peer][_myTokenId];
                delete pendingCapabilities[peer][_myTokenId];
                totalConnections[_myTokenId]++;
                totalConnections[peer]++;

                emit MutualHandshakeCompleted(_myTokenId, peer, edgeKey);
            }
        }
    }

    /**
     * @notice Disconnect an existing mutual handshake edge
     * @param _fromTokenId Caller's Agent ID token
     * @param _toTokenId Peer Agent ID token to disconnect from
     */
    function disconnect(uint256 _fromTokenId, uint256 _toTokenId) external nonReentrant {
        if (!_isAuthorizedForToken(_fromTokenId, msg.sender)) {
            revert NotTokenOwner(_fromTokenId, msg.sender);
        }
        bytes32 edgeKey = getEdgeKey(_fromTokenId, _toTokenId);
        if (!meshEdges[edgeKey].isMutual) revert NotMutuallyConnected(edgeKey);

        delete meshEdges[edgeKey];
        if (totalConnections[_fromTokenId] > 0) totalConnections[_fromTokenId]--;
        if (totalConnections[_toTokenId] > 0) totalConnections[_toTokenId]--;

        emit EdgeDisconnected(_fromTokenId, _toTokenId, edgeKey);
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
