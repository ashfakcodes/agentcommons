const fs = require("fs");
const path = require("path");

const compilersDir = path.resolve(__dirname, "../.cache/localappdata/hardhat-nodejs/Cache/compilers-v2");

const wasmDir = path.join(compilersDir, "wasm");
const winDir = path.join(compilersDir, "windows-amd64");
const v0826Dir = path.join(compilersDir, "0.8.26");

fs.mkdirSync(wasmDir, { recursive: true });
fs.mkdirSync(winDir, { recursive: true });
fs.mkdirSync(v0826Dir, { recursive: true });

// Copy soljson.js to wasm folder
const sourceSoljson = path.resolve(__dirname, "../node_modules/solc/soljson.js");
const wasmSoljsonPath = path.join(wasmDir, "soljson-v0.8.26+commit.8a97fa7a.js");
fs.copyFileSync(sourceSoljson, wasmSoljsonPath);

// Create wasm list.json
const wasmList = {
  builds: [
    {
      path: "soljson-v0.8.26+commit.8a97fa7a.js",
      version: "0.8.26",
      build: "commit.8a97fa7a",
      longVersion: "0.8.26+commit.8a97fa7a",
      keccak256: "0x0000000000000000000000000000000000000000000000000000000000000000",
      urls: [],
      platform: "wasm"
    }
  ],
  releases: {
    "0.8.26": "soljson-v0.8.26+commit.8a97fa7a.js"
  },
  latestRelease: "0.8.26"
};
fs.writeFileSync(path.join(wasmDir, "list.json"), JSON.stringify(wasmList, null, 2));

// Create windows-amd64 list.json and dummy solc.exe + solc.exe.does.not.work to trigger fallback to wasm
const winList = {
  builds: [
    {
      path: "solc-windows-amd64-v0.8.26+commit.8a97fa7a.zip",
      version: "0.8.26",
      build: "commit.8a97fa7a",
      longVersion: "0.8.26+commit.8a97fa7a",
      keccak256: "0x0000000000000000000000000000000000000000000000000000000000000000",
      urls: [],
      platform: "windows-amd64"
    }
  ],
  releases: {
    "0.8.26": "solc-windows-amd64-v0.8.26+commit.8a97fa7a.zip"
  },
  latestRelease: "0.8.26"
};
fs.writeFileSync(path.join(winDir, "list.json"), JSON.stringify(winList, null, 2));

const dummyExe = path.join(v0826Dir, "solc.exe");
fs.writeFileSync(dummyExe, "");
fs.writeFileSync(dummyExe + ".does.not.work", "fallback to solcjs");

console.log("Solc cache configured successfully!");
