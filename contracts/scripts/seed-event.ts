// Creates the demo event for an organiser address and records it in the manifest.
// Usage: ORGANISER_ADDRESS=0x... pnpm --filter @ticketlock/contracts exec hardhat run scripts/seed-event.ts --network <localhost|baseSepolia>
import { network } from "hardhat";
import { getAddress, isAddress, parseEventLogs } from "viem";
import { networkLabel, readManifest, writeManifest } from "./lib/manifest.js";

const CAPACITY = 100n;

const organiserInput = process.env.ORGANISER_ADDRESS;
if (!organiserInput || !isAddress(organiserInput, { strict: false })) {
  throw new Error("Set ORGANISER_ADDRESS to the organiser account's embedded wallet address.");
}
const organiser = getAddress(organiserInput);

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const manifest = readManifest(networkLabel(await publicClient.getChainId()));
if (manifest.eventId !== null) {
  throw new Error("Event " + manifest.eventId + " is already seeded for organiser " + manifest.organiser + ".");
}

const ticketLock = await viem.getContractAt("TicketLockDemo", manifest.contract);
const hash = await ticketLock.write.createEvent([organiser, CAPACITY]);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("createEvent reverted: " + hash);
const [created] = parseEventLogs({ abi: ticketLock.abi, logs: receipt.logs, eventName: "EventCreated" });

const onChain = await ticketLock.read.getEvent([created.args.eventId]);
writeManifest({
  ...manifest,
  eventId: Number(created.args.eventId),
  organiser: getAddress(onChain.organiser),
  capacity: Number(onChain.capacity),
});

console.log("Event created");
console.log("  eventId   ", created.args.eventId.toString());
console.log("  organiser ", onChain.organiser);
console.log("  capacity  ", onChain.capacity.toString());
console.log("  tx        ", hash);
