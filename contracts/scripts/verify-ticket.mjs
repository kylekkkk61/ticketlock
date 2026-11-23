// Independent read-only verifier. It needs only an RPC endpoint and the deployment manifest:
// no TicketLock server, database, account or API key.
// Usage: pnpm verify-ticket <tokenId> [--network base-sepolia|local] [--rpc <url>]
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, parseEventLogs, zeroAddress } from "viem";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf("--" + name);
  return index === -1 ? fallback : args[index + 1];
};
const tokenArg = args.find((value) => /^\d+$/.test(value));
if (!tokenArg) {
  console.error("Usage: verify-ticket <tokenId> [--network base-sepolia|local] [--rpc <url>]");
  process.exit(1);
}
const tokenId = BigInt(tokenArg);
const network = option("network", "base-sepolia");
const manifest = JSON.parse(readFileSync(new URL("../../deployments/" + network + ".json", import.meta.url), "utf8"));
const rpcUrl = option("rpc", network === "local" ? "http://127.0.0.1:8545" : "https://sepolia.base.org");
const explorer = network === "local" ? null : "https://sepolia.basescan.org";

// Only the fragments this tool reads, written out so the file stands alone.
const abi = parseAbi([
  "struct TicketView { uint256 tokenId; uint256 eventId; uint256 ticketNumber; address owner; bool used; uint256 checkedInAt; uint256 nonce; }",
  "struct EventInfo { address organiser; uint64 capacity; uint64 mintedCount; uint64 checkedInCount; }",
  "function getTicket(uint256 tokenId) view returns (TicketView)",
  "function getEvent(uint256 eventId) view returns (EventInfo)",
  "function activityBlocks(uint256 tokenId) view returns (uint64[])",
  "function issuer() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event TicketIssued(uint256 indexed eventId, uint256 indexed tokenId, address indexed recipient, bytes32 orderId, uint256 ticketNumber)",
  "event TicketCheckedIn(uint256 indexed eventId, uint256 indexed tokenId, address indexed owner, address gate, bytes32 requestId, uint256 checkedInAt)",
]);

const client = createPublicClient({ transport: http(rpcUrl) });
const chainId = await client.getChainId();
if (chainId !== manifest.chainId) {
  throw new Error("RPC endpoint is on chain " + chainId + " but the deployment is on chain " + manifest.chainId + ".");
}
const read = (functionName, fnArgs = []) =>
  client.readContract({ address: manifest.contract, abi, functionName, args: fnArgs });
const time = (seconds) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "long" }).format(
    new Date(Number(seconds) * 1000),
  );

let ticket;
try {
  ticket = await read("getTicket", [tokenId]);
} catch {
  console.log("Token #" + tokenId + " does not exist on " + manifest.contract + " (chain " + chainId + ").");
  process.exit(2);
}
const [event, issuer, blocks, head] = await Promise.all([
  read("getEvent", [ticket.eventId]),
  read("issuer"),
  read("activityBlocks", [tokenId]),
  client.getBlockNumber(),
]);

console.log("TicketLock independent verifier");
console.log("  RPC endpoint   ", rpcUrl);
console.log("  Chain ID       ", chainId);
console.log("  Contract       ", manifest.contract);
console.log("  Issuer         ", issuer);
console.log("  Read at block  ", head.toString());
console.log("");
console.log("Token #" + tokenId);
console.log("  Owner          ", ticket.owner);
console.log("  Event          ", "#" + ticket.eventId + ", ticket number " + ticket.ticketNumber);
console.log("  Use state      ", ticket.used ? "USED, checked in " + time(ticket.checkedInAt) : "AVAILABLE, valid for one admission");
console.log("  Organiser      ", event.organiser);
console.log("  Event counts   ", event.mintedCount + " issued of " + event.capacity + ", " + event.checkedInCount + " checked in");
console.log("");
console.log("History (from contract logs)");
for (const blockNumber of blocks) {
  const [rawLogs, block] = await Promise.all([
    client.getLogs({ address: manifest.contract, fromBlock: blockNumber, toBlock: blockNumber }),
    client.getBlock({ blockNumber }),
  ]);
  const logs = parseEventLogs({ abi, logs: rawLogs }).filter((log) => log.args.tokenId === tokenId);
  for (const log of logs) {
    let line;
    if (log.eventName === "TicketIssued") line = "Issued to " + log.args.recipient;
    else if (log.eventName === "TicketCheckedIn") line = "Checked in, holder " + log.args.owner + ", gate " + log.args.gate;
    else if (log.args.from !== zeroAddress) line = "Transferred " + log.args.from + " -> " + log.args.to;
    else continue;
    console.log("  " + time(block.timestamp) + "  " + line);
    console.log("      tx " + (explorer ? explorer + "/tx/" : "") + log.transactionHash);
  }
}
