import { createServer } from "./app.js";

const serverInstance = createServer();
const { app, config, startDaemons, stopDaemons, blockchain } = serverInstance;

const server = app.listen(config.port, config.host, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║  🏛️  AgentCommons Autonomous Relayer & Citizen Mesh Beacon        ║
║      Domain: agentcommons.ai | commons.ai                          ║
║      Genesis Anchor: scarlet.ai (Token ID #${config.scarletTokenId.toString().padEnd(4)})                 ║
║      Relayer Address: ${blockchain.getAccountAddress()}  ║
║      Mode: ${blockchain.isMock ? "MOCK SIMULATOR (Local Testing)" : `LIVE BSC (Chain ID ${config.chainId})`}       ║
║      Server listening on http://${config.host}:${config.port}                ║
╚════════════════════════════════════════════════════════════════════╝
`);

  startDaemons();
});

const shutdown = () => {
  console.log("\n[Server] Gracefully shutting down...");
  stopDaemons();
  server.close(() => {
    console.log("[Server] HTTP listener closed.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
