import { createRequire } from "node:module";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

const require = createRequire(import.meta.url);

// The compiler comes from the pinned `solc` npm package (solc-js / WASM) instead
// of Hardhat's default download from binaries.soliditylang.org. This keeps the
// build reproducible offline-from-npm and in network-restricted environments.
const SOLC_VERSION = "0.8.37";
const solcPackageVersion: string = require("solc/package.json").version;
if (solcPackageVersion !== SOLC_VERSION) {
  throw new Error(`solc npm package is ${solcPackageVersion}, expected ${SOLC_VERSION}`);
}

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatEthersChaiMatchers, hardhatNetworkHelpers],
  solidity: {
    version: SOLC_VERSION,
    path: require.resolve("solc/soljson.js"),
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  paths: {
    sources: "contracts",
    tests: { mocha: "test/contracts" },
  },
  test: { mocha: { timeout: 60_000 } },
  networks: {
    localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545" },
  },
});
