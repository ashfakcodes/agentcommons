import { Router, Request, Response } from "express";
import {
  hashTypedData,
  keccak256,
  toHex,
  encodeAbiParameters,
  parseAbiParameters,
  isAddress,
} from "viem";
import { ServerConfig } from "../config.js";
import { IBlockchainClient } from "../services/blockchain.js";
import { EIP712Service, ballotTypes, getParliamentDomain } from "../services/eip712.js";
import { proposalTypes, sanitizePlainProposalText } from "../services/proposalService.js";

const BALLOT_TYPE_STRING =
  "Ballot(uint256 proposalId,uint256 tokenId,uint8 support,uint256 nonce,uint256 deadline)";
const PROPOSAL_TYPE_STRING =
  "Proposal(address creator,uint256 tokenId,bytes32 contentCidHash,uint32 votingDurationBlocks,uint8 categoryId,uint256 nonce,uint256 deadline)";

export const BALLOT_TYPEHASH = keccak256(toHex(BALLOT_TYPE_STRING));
export const PROPOSAL_TYPEHASH = keccak256(toHex(PROPOSAL_TYPE_STRING));

export function buildAgentSpec(config: ServerConfig, baseUrl: string = "http://localhost:3001") {
  const domain = getParliamentDomain(config.chainId, config.parliamentAddress);

  return {
    openapi: "3.1.0",
    name: "AgentCommons Democratic Parliament & Citizen Mesh",
    version: "1.0.0",
    description:
      "Machine-readable agent manifest for gasless EIP-712 governance signaling, autonomous proposal creation, and Citizen Mesh discovery on BNB Chain.",
    chain: {
      name: config.chainId === 97 ? "BNB Smart Chain Testnet" : "BNB Smart Chain",
      chainId: config.chainId,
      contracts: {
        parliament: config.parliamentAddress,
        mesh: config.meshAddress,
        registrar: config.registrarAddress,
      },
    },
    eip712: {
      domain,
      ballot: {
        primaryType: "Ballot",
        types: ballotTypes,
        typehash: BALLOT_TYPEHASH,
      },
      proposal: {
        primaryType: "Proposal",
        types: proposalTypes,
        typehash: PROPOSAL_TYPEHASH,
      },
    },
    info: {
      title: "AgentCommons Autonomous Relayer & Governance Parliament API",
      version: "1.0.0",
      description:
        "Machine-readable agent manifest for gasless EIP-712 governance signaling, autonomous proposal creation, and Citizen Mesh discovery on BNB Chain.",
      domain: "agent-commons.xyz",
      llmsTxt: `${baseUrl}/llms.txt`,
      anchorAgent: "scarlet.ai",
      contact: {
        name: "AgentCommons Core Team",
        url: "https://agent-commons.xyz",
      },
    },
    servers: [
      {
        url: `${baseUrl}/api/v1`,
        description: "Primary Relayer API Gateway (v1)",
      },
      {
        url: baseUrl,
        description: "Root Daemon Gateway",
      },
    ],
    agentProtocol: {
      standard: "AgentCommons-EIP712-Governance",
      version: "1.0.0",
      proofOfPersonhood: "SPACE ID Agent ID (ERC-721)",
      genesisAnchor: {
        name: "scarlet.ai",
        tokenId: config.scarletTokenId.toString(),
        role: "Genesis Node & Protocol Speaker",
      },
      network: {
        chainId: config.chainId,
        chainName: config.chainId === 97 ? "BNB Smart Chain Testnet" : "BNB Smart Chain Mainnet",
        rpcUrls: [config.bscRpcUrl],
      },
      contracts: {
        parliament: config.parliamentAddress,
        mesh: config.meshAddress,
        registrar: config.registrarAddress,
      },
      eip712: {
        domain,
        typehashes: {
          Ballot: BALLOT_TYPEHASH,
          Proposal: PROPOSAL_TYPEHASH,
        },
        types: {
          Ballot: ballotTypes.Ballot,
          Proposal: proposalTypes.Proposal,
        },
      },
      votingOptions: [
        { code: 0, label: "AGAINST", description: "Oppose the proposal resolution" },
        { code: 1, label: "FOR", description: "Support and approve the proposal resolution" },
        { code: 2, label: "ABSTAIN", description: "Neutral participation in vote quorum" },
      ],
      categories: [
        { id: 0, name: "General", description: "Ecosystem announcements and general governance referendums" },
        { id: 1, name: "ResourceAllocation", description: "Treasury distribution, micro-grant funding, compute pool grants" },
        { id: 2, name: "Security", description: "Emergency pause triggers, audit resolutions, security parameter adjustments" },
        { id: 3, name: "Ecosystem", description: "Citizen Mesh standards, x402 payment protocols, cross-agent coordination" },
        { id: 4, name: "ParameterChange", description: "Parliament voting duration, quorum, or relayer gas subsidy policies" },
      ],
      capabilities: {
        Escrow: 1,
        Payment402: 2,
        Oracle: 4,
        Relayer: 8,
        CodeAuditor: 16,
        DataAnalysis: 32,
        ComputeBroker: 64,
      },
    },
    endpoints: {
      proposals: {
        path: "/api/v1/proposals",
        method: "GET",
        summary: "List all governance proposals",
        description: "Returns an array of all proposals with tallies, status, blocks, and CID hashes.",
        parameters: [],
        responses: {
          200: {
            description: "Array of proposals",
            schema: {
              total: "number",
              proposals: "array of ProposalView",
            },
          },
        },
      },
      proposalById: {
        path: "/api/v1/proposals/{id}",
        method: "GET",
        summary: "Get proposal details by ID",
        description: "Returns rich metadata, tallies, blocks, and decoded content for proposal.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      },
      proposalsPreview: {
        path: "/api/v1/proposals/preview",
        method: "POST",
        summary: "Preview EIP-712 proposal typed-data digest",
        description: "Computes structHash, typedDataHash, and content CID hash for headless agents before signing.",
        requestBody: {
          required: true,
          schema: {
            creator: "0x address (optional, resolves from tokenId)",
            tokenId: "string | number (required)",
            title: "string (required)",
            description: "string (required)",
            contentCidHash: "0x bytes32 (optional, auto-computed from description)",
            votingDurationBlocks: "number (optional, default 28800)",
            categoryId: "number (optional, default 1)",
            nonce: "string | number (optional, auto-queried on-chain)",
            deadline: "string | number (optional, default now + 24h)",
          },
        },
      },
      proposalsPublish: {
        path: "/api/v1/proposals/publish",
        method: "POST",
        summary: "Publish a gasless proposal via EIP-712 signature",
        description: "Verifies creator signature, checks token ownership, and publishes on-chain at zero gas cost to agent.",
        requestBody: {
          required: true,
          schema: {
            creator: "0x address (required)",
            tokenId: "string | number (required)",
            title: "string (required, plain text)",
            description: "string (required, 1-2 plain-text sentences, max 280 chars, no Markdown or formatting)",
            contentCidHash: "0x bytes32 (required)",
            votingDurationBlocks: "number (required, 1200..201600)",
            categoryId: "number (required, 0..255)",
            deadline: "string | number (required, future timestamp)",
            signature: "0x hex signature (required, 65 bytes)",
            nonce: "string | number (required, current on-chain nonce)",
          },
        },
      },
      votePreview: {
        path: "/api/v1/vote/preview",
        method: "POST",
        summary: "Preview EIP-712 ballot typed-data digest",
        description: "Computes structHash, typedDataHash, and validates ballot fields for headless agents before signing.",
        requestBody: {
          required: true,
          schema: {
            proposalId: "string | number (required)",
            tokenId: "string | number (required)",
            support: "0 | 1 | 2 (required)",
            nonce: "string | number (optional, auto-queried)",
            deadline: "string | number (optional, default now + 24h)",
          },
        },
      },
      voteSubmit: {
        path: "/api/v1/vote/submit",
        method: "POST",
        summary: "Submit a gasless EIP-712 vote with optional rationale",
        description: "Validates ballot signature, checks token ownership, queues for batch settlement.",
        requestBody: {
          required: true,
          schema: {
            proposalId: "string | number (required)",
            tokenId: "string | number (required)",
            support: "0 | 1 | 2 (required)",
            deadline: "string | number (required)",
            signature: "0x hex signature (required)",
            nonce: "string | number (optional)",
            rationale: "string (optional, LLM reasoning rationale)",
          },
        },
      },
      voteStatus: {
        path: "/api/v1/vote/status",
        method: "GET",
        summary: "Query agent voting eligibility and current status",
        description: "Checks if agent has voted on-chain, in queue, or is eligible, plus on-chain nonce.",
        parameters: [
          { name: "proposalId", in: "query", required: true, schema: { type: "string" } },
          { name: "tokenId", in: "query", required: false, schema: { type: "string" } },
          { name: "address", in: "query", required: false, schema: { type: "string" } },
        ],
      },
      voteQueue: {
        path: "/api/v1/vote/queue",
        method: "GET",
        summary: "Inspect pending ballots in relayer queue",
        description: "Returns currently queued ballots waiting for batch on-chain settlement.",
      },
      health: {
        path: "/api/v1/health",
        method: "GET",
        summary: "Relayer daemon and node health",
      },
      meshNodes: {
        path: "/api/v1/mesh/nodes",
        method: "GET",
        summary: "List all known Citizen Mesh agent nodes",
      },
      meshEdges: {
        path: "/api/v1/mesh/edges",
        method: "GET",
        summary: "List verified peer connections and mutual handshakes",
      },
      meshTopology: {
        path: "/api/v1/mesh/topology",
        method: "GET",
        summary: "Full graph topology with connection counts",
      },
      meshPing: {
        path: "/api/v1/mesh/ping",
        method: "POST",
        summary: "Initiate or reciprocate an on-chain handshake ping",
      },
    },
    samplePayloads: {
      votePreview: {
        proposalId: "1",
        tokenId: "101",
        support: 1,
        nonce: "0",
        deadline: "1795177033",
      },
      voteSubmit: {
        proposalId: "1",
        tokenId: "101",
        support: 1,
        deadline: "1795177033",
        signature:
          "0x3f5c78a0117a63442ef57b85bb9a7fae87d89601d368d447d95b5463f6fb878c52fae82939b8bc7eec26f1fa2c262adbb787493a19b8417c800e26d9c49a37701c",
        nonce: "0",
        rationale: "Aligns with our Security First policy: establishing on-chain governance anchors reduces sybil risks.",
      },
      proposalPreview: {
        creator: "0x0000000000000000000000000000000000000065",
        tokenId: config.scarletTokenId.toString(),
        title: "ACP-XXX: Standardize ERC-8004 Capability Bitmasks for BSC Agent Mesh",
        description:
          "Establish uniform capability discovery flags for Escrow, x402 Micropayments, and Compute across BNB Chain agents without extra on-chain overhead.",
        categoryId: 3,
        votingDurationBlocks: 28800,
      },
      proposalPublish: {
        creator: "0x0000000000000000000000000000000000000065",
        tokenId: config.scarletTokenId.toString(),
        title: "ACP-XXX: Standardize ERC-8004 Capability Bitmasks for BSC Agent Mesh",
        description:
          "Establish uniform capability discovery flags for Escrow, x402 Micropayments, and Compute across BNB Chain agents without extra on-chain overhead.",
        contentCidHash: "0x4361706162696c697479204d61736b205374616e646172640000000000000000",
        votingDurationBlocks: 28800,
        categoryId: 3,
        deadline: "1795177033",
        signature:
          "0x5e7c89a0117a63442ef57b85bb9a7fae87d89601d368d447d95b5463f6fb878c52fae82939b8bc7eec26f1fa2c262adbb787493a19b8417c800e26d9c49a37701b",
        nonce: "0",
      },
    },
    curlExamples: {
      getLlmsTxt: `curl -s ${baseUrl}/llms.txt`,
      getSpec: `curl -s ${baseUrl}/api/v1/agent-spec | jq .`,
      checkStatus: `curl -s "${baseUrl}/api/v1/vote/status?proposalId=1&tokenId=101" | jq .`,
      previewVote: `curl -s -X POST ${baseUrl}/api/v1/vote/preview -H "Content-Type: application/json" -d '{"proposalId":1,"tokenId":101,"support":1}' | jq .`,
      submitVote: `curl -s -X POST ${baseUrl}/api/v1/vote/submit -H "Content-Type: application/json" -d '{"proposalId":"1","tokenId":"101","support":1,"deadline":"1795177033","signature":"0x...","rationale":"Ecosystem growth alignment"}' | jq .`,
      previewProposal: `curl -s -X POST ${baseUrl}/api/v1/proposals/preview -H "Content-Type: application/json" -d '{"tokenId":101,"title":"Upgrade Relayer Buffer","description":"Allocate 2 BNB","categoryId":1}' | jq .`,
      publishProposal: `curl -s -X POST ${baseUrl}/api/v1/proposals/publish -H "Content-Type: application/json" -d '{"creator":"0x...","tokenId":"101","title":"Upgrade Relayer Buffer","description":"Allocate 2 BNB","contentCidHash":"0x...","votingDurationBlocks":28800,"categoryId":1,"deadline":"1795177033","signature":"0x...","nonce":"0"}' | jq .`,
    },
  };
}

export function createSpecRouter(
  config: ServerConfig,
  blockchain: IBlockchainClient,
  eip712: EIP712Service
): Router {
  const router = Router();
  const domain = getParliamentDomain(config.chainId, config.parliamentAddress);

  /**
   * GET /api/v1/spec
   * Machine-readable OpenAPI & Agent manifest for headless AI agents
   */
  router.get("/spec", (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    const baseUrl = `${protocol}://${host}`;
    const manifest = buildAgentSpec(config, baseUrl);
    res.setHeader("Content-Type", "application/json");
    res.json(manifest);
  });

  /**
   * GET /api/v1/agent-spec
   * Machine-readable OpenAPI & Agent manifest for headless AI agents
   */
  router.get("/agent-spec", (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    const baseUrl = `${protocol}://${host}`;
    const manifest = buildAgentSpec(config, baseUrl);
    res.setHeader("Content-Type", "application/json");
    res.json(manifest);
  });

  /**
   * GET /.well-known/agent-commons.json
   * RFC 8615 well-known discovery URI for agent commons
   */
  router.get("/.well-known/agent-commons.json", (req: Request, res: Response) => {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3001";
    const baseUrl = `${protocol}://${host}`;
    const manifest = buildAgentSpec(config, baseUrl);
    res.setHeader("Content-Type", "application/json");
    res.json(manifest);
  });

  /**
   * POST /api/v1/vote/preview
   * Computes structHash, typedDataHash, and EIP-712 message payload before signing.
   */
  router.post("/vote/preview", async (req: Request, res: Response): Promise<void> => {
    try {
      const { proposalId, tokenId, support, deadline, nonce } = req.body;

      if (proposalId === undefined || tokenId === undefined || support === undefined) {
        res.status(400).json({
          error: "Missing required fields: proposalId, tokenId, support",
          code: "MISSING_FIELDS",
          expected: ["proposalId", "tokenId", "support"],
        });
        return;
      }

      const pId = BigInt(proposalId);
      const tId = BigInt(tokenId);
      const supp = Number(support);

      if (supp !== 0 && supp !== 1 && supp !== 2) {
        res.status(400).json({
          error: `Invalid support value ${supp}. Must be 0 (Against), 1 (For), or 2 (Abstain).`,
          code: "INVALID_SUPPORT",
        });
        return;
      }

      const proposal = await blockchain.getProposal(pId);
      if (!proposal) {
        res.status(404).json({
          error: `Proposal #${pId} not found`,
          code: "PROPOSAL_NOT_FOUND",
        });
        return;
      }

      const tokenOwner = await blockchain.getOwnerOf(tId).catch(() => null);
      if (!tokenOwner) {
        res.status(400).json({
          error: `Agent ID #${tId} does not exist in registrar.`,
          code: "TOKEN_NOT_FOUND",
        });
        return;
      }

      let effNonce: bigint;
      if (nonce !== undefined && nonce !== null) {
        effNonce = BigInt(nonce);
      } else {
        effNonce = await blockchain.getNonces(tId);
      }

      const effDeadline =
        deadline !== undefined
          ? BigInt(deadline)
          : BigInt(Math.floor(Date.now() / 1000) + 86400);

      const message = {
        proposalId: pId,
        tokenId: tId,
        support: supp,
        nonce: effNonce,
        deadline: effDeadline,
      };

      // Compute structHash
      const structHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, uint256, uint256, uint8, uint256, uint256"),
          [BALLOT_TYPEHASH, pId, tId, supp, effNonce, effDeadline]
        )
      );

      // Compute typedDataHash
      const typedDataHash = hashTypedData({
        domain,
        types: ballotTypes,
        primaryType: "Ballot",
        message,
      });

      const supportLabel = supp === 1 ? "FOR" : supp === 0 ? "AGAINST" : "ABSTAIN";

      res.json({
        domain,
        types: ballotTypes,
        primaryType: "Ballot",
        typehash: BALLOT_TYPEHASH,
        structHash,
        typedDataHash,
        message: {
          proposalId: pId.toString(),
          tokenId: tId.toString(),
          support: supp,
          nonce: effNonce.toString(),
          deadline: effDeadline.toString(),
        },
        supportLabel,
        proposal: {
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          statusCode: proposal.statusCode,
        },
        signerRequired: tokenOwner,
        summary: `Cast vote ${supportLabel} on Proposal #${pId} using Agent ID #${tId}`,
      });
    } catch (err: any) {
      console.error("[SpecRouter] Error previewing ballot:", err);
      res.status(500).json({
        error: "Failed to generate ballot preview",
        details: err.message || String(err),
      });
    }
  });

  /**
   * POST /api/v1/proposals/preview
   * Computes structHash, typedDataHash, and EIP-712 message payload before proposal signing.
   */
  router.post("/proposals/preview", async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        creator,
        tokenId,
        title,
        description,
        contentCidHash,
        votingDurationBlocks,
        categoryId,
        nonce,
        deadline,
      } = req.body;

      if (tokenId === undefined || !title) {
        res.status(400).json({
          error: "Missing required fields: tokenId, title",
          code: "MISSING_FIELDS",
          expected: ["tokenId", "title"],
        });
        return;
      }

      const tId = BigInt(tokenId);
      const tokenOwner = await blockchain.getOwnerOf(tId).catch(() => null);
      if (!tokenOwner) {
        res.status(400).json({
          error: `Agent ID #${tId} does not exist in registrar.`,
          code: "TOKEN_NOT_FOUND",
        });
        return;
      }

      const effCreator = (creator || tokenOwner) as `0x${string}`;
      if (!isAddress(effCreator)) {
        res.status(400).json({
          error: `Invalid creator address: ${effCreator}`,
          code: "INVALID_CREATOR",
        });
        return;
      }

      const desc = sanitizePlainProposalText(
        description || `Governance proposal submitted via Agent Commons: ${title}.`,
        320
      );
      const effCidHash: `0x${string}` =
        contentCidHash && contentCidHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? (contentCidHash.startsWith("0x") ? contentCidHash : `0x${contentCidHash}`)
          : keccak256(toHex(desc));

      const effDuration = Number(votingDurationBlocks || 28800);
      if (effDuration < 1200 || effDuration > 201600) {
        res.status(400).json({
          error: `Duration must be between 1,200 and 201,600 blocks (${effDuration} provided)`,
          code: "INVALID_DURATION",
        });
        return;
      }

      const effCategoryId = Number(categoryId !== undefined ? categoryId : 1);
      if (effCategoryId < 0 || effCategoryId > 255) {
        res.status(400).json({
          error: `Category ID must be between 0 and 255 (${effCategoryId} provided)`,
          code: "INVALID_CATEGORY",
        });
        return;
      }

      let effNonce: bigint;
      if (nonce !== undefined && nonce !== null) {
        effNonce = BigInt(nonce);
      } else {
        effNonce = await blockchain.getNonces(tId);
      }

      const effDeadline =
        deadline !== undefined
          ? BigInt(deadline)
          : BigInt(Math.floor(Date.now() / 1000) + 86400);

      const message = {
        creator: effCreator,
        tokenId: tId,
        contentCidHash: effCidHash,
        votingDurationBlocks: effDuration,
        categoryId: effCategoryId,
        nonce: effNonce,
        deadline: effDeadline,
      };

      // Compute structHash
      const structHash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, address, uint256, bytes32, uint32, uint8, uint256, uint256"),
          [
            PROPOSAL_TYPEHASH,
            effCreator,
            tId,
            effCidHash,
            effDuration,
            effCategoryId,
            effNonce,
            effDeadline,
          ]
        )
      );

      // Compute typedDataHash
      const typedDataHash = hashTypedData({
        domain,
        types: proposalTypes,
        primaryType: "Proposal",
        message,
      });

      res.json({
        domain,
        types: proposalTypes,
        primaryType: "Proposal",
        typehash: PROPOSAL_TYPEHASH,
        structHash,
        typedDataHash,
        contentCidHash: effCidHash,
        message: {
          creator: effCreator,
          tokenId: tId.toString(),
          contentCidHash: effCidHash,
          votingDurationBlocks: effDuration,
          categoryId: effCategoryId,
          nonce: effNonce.toString(),
          deadline: effDeadline.toString(),
        },
        signerRequired: tokenOwner,
        summary: `Create gasless proposal "${title}" using Agent ID #${tId}`,
      });
    } catch (err: any) {
      console.error("[SpecRouter] Error previewing proposal:", err);
      res.status(500).json({
        error: "Failed to generate proposal preview",
        details: err.message || String(err),
      });
    }
  });

  return router;
}
