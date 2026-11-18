const fs = require("fs");
const path = require("path");

const artifactsDir = path.resolve(__dirname, "../artifacts/src");
const abiOutputDir = path.resolve(__dirname, "../abi");

fs.mkdirSync(abiOutputDir, { recursive: true });

const contracts = [
  { name: "AgentCommonsParliament", file: "AgentCommonsParliament.sol/AgentCommonsParliament.json" },
  { name: "AgentCommonsMesh", file: "AgentCommonsMesh.sol/AgentCommonsMesh.json" },
  { name: "MockSPACEIDAgentID", file: "MockSPACEIDAgentID.sol/MockSPACEIDAgentID.json" },
];

contracts.forEach((c) => {
  const artifactPath = path.join(artifactsDir, c.file);
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const outputPath = path.join(abiOutputDir, `${c.name}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`✅ Exported ABI for ${c.name} -> abi/${c.name}.json`);
  }
});
