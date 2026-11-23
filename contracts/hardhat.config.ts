import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

// Secrets live in the repository root .env (never committed).
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const relayerKey = process.env.RELAYER_PRIVATE_KEY;
const alchemyKey = process.env.ALCHEMY_API_KEY;

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      // tokenURI builds a long string; the IR pipeline avoids stack-depth limits.
      viaIR: true,
    },
  },
  networks: {
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      accounts: relayerKey ? [relayerKey] : "remote",
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: alchemyKey ? "https://base-sepolia.g.alchemy.com/v2/" + alchemyKey : "https://sepolia.base.org",
      accounts: relayerKey ? [relayerKey] : [],
    },
  },
  verify: {
    etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  },
};

export default config;
