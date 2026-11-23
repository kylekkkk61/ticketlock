// Deploys TicketLockDemo with the relayer as immutable issuer and writes the manifest.
// Usage: pnpm --filter @ticketlock/contracts exec hardhat run scripts/deploy.ts --network <localhost|baseSepolia>
import { network } from "hardhat";
import { parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { networkLabel, writeManifest } from "./lib/manifest.js";

const relayerKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY is missing from the root .env file.");
const relayer = privateKeyToAccount(relayerKey);

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const label = networkLabel(chainId);

if (label === "local") {
  // The local chain only funds its built-in accounts; give the relayer a balance.
  await publicClient.request({
    method: "hardhat_setBalance" as never,
    params: [relayer.address, toHex(parseEther("100"))] as never,
  });
}

const balance = await publicClient.getBalance({ address: relayer.address });
if (balance === 0n) throw new Error("Relayer " + relayer.address + " has no ETH on chain " + chainId + ".");

const [deployer] = await viem.getWalletClients();
if (deployer.account.address.toLowerCase() !== relayer.address.toLowerCase()) {
  throw new Error("The network's first account must be the relayer " + relayer.address + ".");
}

const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction("TicketLockDemo", [relayer.address]);
const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
if (receipt.status !== "success") throw new Error("Deployment transaction reverted: " + deploymentTransaction.hash);

writeManifest({
  network: label,
  chainId,
  contract: contract.address,
  deploymentBlock: Number(receipt.blockNumber),
  deploymentTx: deploymentTransaction.hash,
  issuer: relayer.address,
  eventId: null,
  organiser: null,
  capacity: null,
});

console.log("TicketLockDemo deployed");
console.log("  network   ", label, "(" + chainId + ")");
console.log("  contract  ", contract.address);
console.log("  issuer    ", relayer.address);
console.log("  block     ", receipt.blockNumber.toString());
console.log("  tx        ", deploymentTransaction.hash);
