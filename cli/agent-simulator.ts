import { runSimulation } from "./src/agent-simulator.js";

runSimulation().catch((err) => {
  console.error("Simulation Error:", err);
  process.exit(1);
});
