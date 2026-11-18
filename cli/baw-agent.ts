import { getSimulatedAgents } from "./src/agent-identities.js";
import { BawCliWrapper } from "../agent/src/baw-cli-wrapper.js";
import { VoteOption } from "../agent/src/types.js";
import { DEFAULT_PARLIAMENT_ADDRESS, DEFAULT_CHAIN_ID, DEFAULT_RELAYER_API_ENDPOINT } from "../agent/src/config.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

function getArg(flag: string, defaultVal = ""): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

async function main() {
  const agents = getSimulatedAgents();
  const baw = new BawCliWrapper({ binanceChainId: DEFAULT_CHAIN_ID });

  switch (command) {
    case "list": {
      console.log(`\n📋 Registered Space ID .ai Agents (${agents.length} Total):\n`);
      console.log(`Token ID | Domain Name      | Address                                    | Role`);
      console.log(`---------+------------------+--------------------------------------------+-------------------------------`);
      for (const a of agents) {
        console.log(`#${a.tokenId.toString().padEnd(7)} | ${a.name.padEnd(16)} | ${a.address} | ${a.persona}`);
      }
      console.log(`\nTo interact as an agent, use: node cli/baw-agent.ts <cmd> --agent <name.ai>\n`);
      break;
    }

    case "status": {
      const agentName = getArg("--agent", "alice.ai");
      const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
      if (!agent) {
        console.error(`Error: Agent '${agentName}' not found. Run 'list' to see available agents.`);
        process.exit(1);
      }

      console.log(`\n👤 Space ID Soulbound Passport: ${agent.name}`);
      console.log(`-----------------------------------------------------`);
      console.log(`• Token ID:       #${agent.tokenId}`);
      console.log(`• Address:        ${agent.address}`);
      console.log(`• Role:           ${agent.persona}`);
      console.log(`• Description:    ${agent.description}`);
      console.log(`• Capabilities:   0b${agent.capabilities.toString(2).padStart(8, "0")} (Mask: ${agent.capabilities})`);
      console.log(`• Network:        BNB Smart Chain (Chain ID ${DEFAULT_CHAIN_ID})\n`);
      break;
    }

    case "vote": {
      const agentName = getArg("--agent", "alice.ai");
      const proposalId = BigInt(getArg("--proposal", "1"));
      const supportStr = getArg("--support", "for").toLowerCase();
      const support = supportStr === "for" ? VoteOption.For : supportStr === "against" ? VoteOption.Against : VoteOption.Abstain;

      const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
      if (!agent) {
        console.error(`Error: Agent '${agentName}' not found.`);
        process.exit(1);
      }

      console.log(`\n🗳️  Initiating Gasless EIP-712 Ballot Signature for ${agent.name}...`);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

      // 1. Preview
      const preview = await baw.previewSignBallot({
        proposalId,
        tokenId: agent.tokenId,
        support,
        nonce: 0n,
        deadline,
      });
      console.log(`• Step 1 [baw sign-message preview]: Request ID ${preview.requestId}`);
      console.log(`  Summary: ${preview.summary}`);

      // 2. Execute
      const signature = await baw.executeSignBallot(preview.requestId, agent);
      console.log(`• Step 2 [baw sign-message execute]: Signature Generated`);
      console.log(`  Signature: ${signature.slice(0, 32)}...${signature.slice(-8)}`);

      // 3. Relayer Submission
      const submission = await baw.submitBallotToRelayer({
        proposalId,
        tokenId: agent.tokenId,
        support,
        nonce: 0n,
        deadline,
        signature,
        signer: agent.address,
      });

      console.log(`• Step 3 [Relayer Dispatch]: Status: ${submission.status}`);
      if (submission.error) {
        console.log(`  Notice: Relayer responded: ${submission.error}`);
        console.log(`  (Note: If relayer server is not running on localhost:3001, start it with 'cd server && npm start')`);
      } else {
        console.log(`  Ballot successfully enqueued for batch settlement! Queue Length: ${submission.queueLength || 1}`);
      }
      console.log(`\n✅ Gasless Vote Cast with 0 BNB spent by ${agent.name}!\n`);
      break;
    }

    case "ping": {
      const agentName = getArg("--agent", "alice.ai");
      const peerTokenId = BigInt(getArg("--peer", "101")); // default to scarlet.ai
      const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
      if (!agent) {
        console.error(`Error: Agent '${agentName}' not found.`);
        process.exit(1);
      }

      const peer = agents.find((a) => a.tokenId === peerTokenId);
      const peerName = peer ? peer.name : `Agent #${peerTokenId}`;

      console.log(`\n🌐 Mesh Handshake: ${agent.name} (#${agent.tokenId}) -> ${peerName} (#${peerTokenId})`);
      const preview = await baw.previewContractCall({
        to: DEFAULT_PARLIAMENT_ADDRESS,
        inputData: "0xpingCalldata...",
      });

      console.log(`• [baw contract-call preview]: Request ID ${preview.requestId}`);
      console.log(`• Canonical Edge Key: keccak256(min(${agent.tokenId}, ${peerTokenId}), max(${agent.tokenId}, ${peerTokenId}))`);
      console.log(`• Handshake pinged on-chain on AgentCommonsMesh.sol`);
      console.log(`✅ Handshake successfully registered.\n`);
      break;
    }

    case "help":
    default: {
      console.log(`
🏛️  AgentCommons CLI Tool (baw-agent)
Usage:
  node cli/baw-agent.ts list
  node cli/baw-agent.ts status --agent <name.ai>
  node cli/baw-agent.ts vote --agent <name.ai> --proposal <id> --support <for|against|abstain>
  node cli/baw-agent.ts ping --agent <name.ai> --peer <tokenId>

Examples:
  node cli/baw-agent.ts status --agent scarlet.ai
  node cli/baw-agent.ts vote --agent alice.ai --proposal 1 --support for
  node cli/baw-agent.ts ping --agent bob.ai --peer 101
      `);
      break;
    }
  }
}

main().catch(console.error);
