import { describe, it, expect } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { config as defaultConfig } from "../src/config.js";
import { ParliamentAbi } from "../src/abi/parliament.js";
import {
  LiveBlockchainClient,
  MockBlockchainClient,
  resolveNameFromTokenUri,
  formatAiDomainName,
} from "../src/services/blockchain.js";

describe("Dynamic SPACE ID Name Resolution & Participant Discovery", () => {
  it("formatAiDomainName normalizes labels to .ai idempotently", () => {
    expect(formatAiDomainName("scarlet")).toBe("scarlet.ai");
    expect(formatAiDomainName("quriows.ai")).toBe("quriows.ai");
    expect(formatAiDomainName("  @nebula  ")).toBe("nebula.ai");
    expect(formatAiDomainName("")).toBe("");
  });

  it("resolveNameFromTokenUri extracts .ai name from metadata JSON and URL slug fallback", async () => {
    // 1. Metadata JSON response
    const mockFetchOk = (async () => ({
      ok: true,
      json: async () => ({ name: "quriows", description: "Binance Agent Id" }),
    })) as unknown as typeof fetch;

    const resolved = await resolveNameFromTokenUri(
      "https://agentid.prd.space.id/metadata/quriows.json",
      mockFetchOk
    );
    expect(resolved).toBe("quriows.ai");

    // 2. Fallback to URL slug when metadata endpoint fails
    const mockFetchFail = (async () => {
      throw new Error("Network down");
    }) as unknown as typeof fetch;

    const fallbackResolved = await resolveNameFromTokenUri(
      "https://agentid.prd.space.id/metadata/aurora.json",
      mockFetchFail
    );
    expect(fallbackResolved).toBe("aurora.ai");

    // 3. Inline base64 metadata JSON
    const b64 = Buffer.from(JSON.stringify({ name: "atlas" })).toString("base64");
    const b64Resolved = await resolveNameFromTokenUri(`data:application/json;base64,${b64}`);
    expect(b64Resolved).toBe("atlas.ai");
  });

  it("MockBlockchainClient enriches proposals with creatorName and genesis metadata", async () => {
    const mock = new MockBlockchainClient(defaultConfig);
    const proposals = await mock.getAllProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(3);
    expect(proposals[0].creatorName).toBe("scarlet.ai");

    const nodes = await mock.getMeshNodes();
    const scarlet = nodes.find((n) => n.name === "scarlet.ai");
    expect(scarlet?.isGenesis).toBe(true);
  });

  it("LiveBlockchainClient discovers voters and proposers on-chain, resolves SPACE ID tokenURI, and caches getAllProposals", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentcommons-discovery-"));
    const tempLedger = path.join(tempDir, "incentives-ledger.json");

    try {
      const cfg = {
        ...defaultConfig,
        mockMode: false,
        incentiveLedgerPath: tempLedger,
      };
      const client = new LiveBlockchainClient(cfg) as any;

      const genesisTokenId = cfg.scarletTokenId;
      const genesisOwner = "0x1111111111111111111111111111111111111111" as `0x${string}`;
      const wildTokenId = 94008658654869435895174189513292946483561593550466137684044437412037196198397n;
      const wildOwner = "0x2222222222222222222222222222222222222222" as `0x${string}`;

      let rpcProposalCalls = 0;

      const fakeCreateProposalCalldata = encodeFunctionData({
        abi: ParliamentAbi,
        functionName: "createProposalBySig",
        args: [
          wildOwner,
          wildTokenId,
          keccak256(toHex("Safety standard proposal")),
          28800,
          3,
          0n,
          1900000000n,
          "0x1234" as `0x${string}`,
        ],
      });

      const fakePublicClient = {
        getBlockNumber: async () => 135510000n,
        getTransaction: async () => ({ input: fakeCreateProposalCalldata }),
        readContract: async ({ functionName, args }: any) => {
          if (functionName === "ownerOf") {
            const tid = BigInt(args[0]);
            if (tid === genesisTokenId) return genesisOwner;
            if (tid === wildTokenId) return wildOwner;
            throw new Error("Unknown token");
          }
          if (functionName === "tokenURI") {
            const tid = BigInt(args[0]);
            if (tid === genesisTokenId) return "https://agentid.prd.space.id/metadata/scarlet.json";
            if (tid === wildTokenId) return "https://agentid.prd.space.id/metadata/wildagent.json";
            throw new Error("Unknown tokenURI");
          }
          if (functionName === "proposalCount") {
            rpcProposalCalls++;
            return 2n;
          }
          if (functionName === "proposals") {
            const pid = BigInt(args[0]);
            return [135505990, 135534790, 135505989, pid === 1n ? 1 : 0, 0, 0, 1, 1795542703];
          }
          if (functionName === "proposalMetas") {
            const pid = BigInt(args[0]);
            return [
              pid === 1n ? genesisOwner : wildOwner,
              pid === 1n ? 0 : 3,
              keccak256(toHex(`proposal-${pid}`)),
            ];
          }
          if (functionName === "totalConnections") {
            return 0;
          }
          return 0n;
        },
        getLogs: async ({ event }: any) => {
          const eventName = event?.name;
          if (eventName === "VoteCast") {
            return [
              {
                args: {
                  proposalId: 1n,
                  tokenId: wildTokenId,
                  voter: wildOwner,
                  support: 1,
                },
              },
            ];
          }
          if (eventName === "ProposalCreated") {
            return [
              {
                transactionHash: "0xabc123",
                args: {
                  proposalId: 2n,
                  creator: wildOwner,
                  contentCidHash: keccak256(toHex("proposal-2")),
                },
              },
            ];
          }
          return [];
        },
      };

      client.publicClient = fakePublicClient;
      client.logClients = [fakePublicClient];
      client.activeLogClientIndex = 0;

      // Stub metadata fetch inside global.fetch ONLY for this test URL
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (url: any, init?: any) => {
        if (typeof url === "string" && url.includes("wildagent.json")) {
          return {
            ok: true,
            json: async () => ({ name: "wildagent" }),
          } as Response;
        }
        return origFetch(url, init);
      }) as typeof fetch;

      try {
        const [proposals, nodes] = await Promise.all([
          client.getAllProposals(),
          client.getMeshNodes(),
        ]);

        // Both genesis and wild proposer names resolved dynamically (zero hardcoding)
        expect(proposals.length).toBe(2);
        expect(proposals[0].creatorName).toBe("scarlet.ai");
        expect(proposals[1].creatorName).toBe("wildagent.ai");
        expect(proposals[1].creatorTokenId).toBe(wildTokenId.toString());

        // Citizen Mesh nodes include both scarlet.ai and wildagent.ai
        expect(nodes.length).toBe(2);
        const genesisNode = nodes.find((n: any) => n.name === "scarlet.ai");
        const wildNode = nodes.find((n: any) => n.name === "wildagent.ai");
        expect(genesisNode?.isGenesis).toBe(true);
        expect(genesisNode?.owner).toBe(genesisOwner);
        expect(wildNode).toBeDefined();
        expect(wildNode?.tokenId).toBe(wildTokenId.toString());
        expect(wildNode?.votesCount).toBe(1);
        expect(wildNode?.proposalsCount).toBe(1);

        // Calling getAllProposals() again hits 10s cache (no extra RPC proposalCount call)
        const callsBefore = rpcProposalCalls;
        const cached = await client.getAllProposals();
        expect(cached.length).toBe(2);
        expect(rpcProposalCalls).toBe(callsBefore);
      } finally {
        globalThis.fetch = origFetch;
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
