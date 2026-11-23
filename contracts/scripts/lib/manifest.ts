import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type DeploymentManifest = {
  network: "local" | "base-sepolia";
  chainId: number;
  contract: `0x${string}`;
  deploymentBlock: number;
  deploymentTx: `0x${string}`;
  issuer: `0x${string}`;
  eventId: number | null;
  organiser: `0x${string}` | null;
  capacity: number | null;
};

const dir = fileURLToPath(new URL("../../../deployments/", import.meta.url));

export const networkLabel = (chainId: number): DeploymentManifest["network"] => {
  if (chainId === 31337) return "local";
  if (chainId === 84532) return "base-sepolia";
  throw new Error("Unsupported chain " + chainId + ". Use Hardhat local (31337) or Base Sepolia (84532).");
};

export const manifestPath = (network: DeploymentManifest["network"]) => dir + network + ".json";

export function readManifest(network: DeploymentManifest["network"]): DeploymentManifest {
  const file = manifestPath(network);
  if (!existsSync(file)) throw new Error("No deployment manifest at " + file + ". Run the deploy script first.");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeManifest(manifest: DeploymentManifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath(manifest.network), JSON.stringify(manifest, null, 2) + "\n");
}
