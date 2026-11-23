import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAddress, type Address, type Chain, type Hex } from "viem";
import { baseSepolia, hardhat } from "viem/chains";

export type DeploymentManifest = {
  network: "local" | "base-sepolia";
  chainId: number;
  contract: Address;
  deploymentBlock: number;
  deploymentTx: Hex;
  issuer: Address;
  eventId: number | null;
  organiser: Address | null;
  capacity: number | null;
};

/** Values the browser may know. No secrets. */
export type PublicConfig = {
  network: "local" | "base-sepolia";
  networkName: string;
  /** Wording for a result that has a successful receipt and a matching readback. */
  confirmedLabel: string;
  chainId: number;
  contract: Address;
  deploymentBlock: number;
  eventId: number;
  relayer: Address;
  explorerUrl: string | null;
  /** Keyless RPC endpoint the read-only verifier calls from the browser. */
  publicRpcUrl: string;
  appUrl: string | null;
  privyAppId: string;
};

export type ServerConfig = {
  public: PublicConfig;
  chain: Chain;
  rpcUrl: string;
  relayerKey: Hex;
  privyAppSecret: string;
  dbFile: string;
};

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("Missing environment variable " + name + ". See .env.example.");
  return value;
};

function load(): ServerConfig {
  const network = (process.env.TICKETLOCK_NETWORK ?? "local") as DeploymentManifest["network"];
  if (network !== "local" && network !== "base-sepolia") {
    throw new Error("TICKETLOCK_NETWORK must be 'local' or 'base-sepolia'.");
  }
  const repoRoot = path.resolve(process.cwd(), "..");
  const manifestFile = process.env.TICKETLOCK_MANIFEST ?? path.join(repoRoot, "deployments", network + ".json");
  // The manifest is read at run time from the repository, outside the build output.
  if (!existsSync(/* turbopackIgnore: true */ manifestFile)) {
    throw new Error("No deployment manifest at " + manifestFile + ". Deploy the contract first (see README).");
  }
  const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ manifestFile, "utf8")) as DeploymentManifest;
  if (manifest.eventId === null) {
    throw new Error("The deployment has no seeded event yet. Run the seed-event script (see README).");
  }

  const local = manifest.chainId === hardhat.id;
  const chain = local ? hardhat : baseSepolia;
  if (!local && manifest.chainId !== baseSepolia.id) throw new Error("Unsupported chain " + manifest.chainId);
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const publicRpcUrl = local ? "http://127.0.0.1:8545" : "https://sepolia.base.org";
  const rpcUrl =
    process.env.RPC_URL ??
    (local || !alchemyKey ? publicRpcUrl : "https://base-sepolia.g.alchemy.com/v2/" + alchemyKey);

  const contract = getAddress(manifest.contract);
  const dbFile =
    process.env.TICKETLOCK_DB ??
    path.join(repoRoot, "data", "ticketlock-" + manifest.chainId + "-" + contract.slice(2, 10).toLowerCase() + ".sqlite");

  return {
    public: {
      network: manifest.network,
      networkName: local ? "Hardhat local chain" : "Base Sepolia testnet",
      confirmedLabel: local ? "Confirmed on local chain" : "Confirmed on testnet",
      chainId: manifest.chainId,
      contract,
      deploymentBlock: manifest.deploymentBlock,
      eventId: manifest.eventId,
      relayer: getAddress(manifest.issuer),
      explorerUrl: local ? null : "https://sepolia.basescan.org",
      publicRpcUrl,
      appUrl: process.env.APP_URL?.replace(/\/$/, "") || null,
      privyAppId: required("NEXT_PUBLIC_PRIVY_APP_ID"),
    },
    chain,
    rpcUrl,
    relayerKey: required("RELAYER_PRIVATE_KEY") as Hex,
    privyAppSecret: required("PRIVY_APP_SECRET"),
    dbFile,
  };
}

const globals = globalThis as { __ticketlockConfig?: ServerConfig };
export const getConfig = (): ServerConfig => (globals.__ticketlockConfig ??= load());
