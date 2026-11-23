import { getAddress, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { ticketLockAbi } from "./contract/abi";

// Read helpers that only need an RPC endpoint and the contract address. The app server and the
// independent verifier share them, so the verifier shows exactly what the chain holds.

export type TicketState = {
  tokenId: number;
  eventId: number;
  ticketNumber: number;
  owner: Address;
  used: boolean;
  checkedInAt: number;
  nonce: number;
};

export type EventState = {
  eventId: number;
  organiser: Address;
  capacity: number;
  mintedCount: number;
  checkedInCount: number;
};

export type HistoryEntry = {
  kind: "issued" | "transferred" | "checkedIn";
  txHash: Hex;
  blockNumber: number;
  timestamp: number;
  /** Account that sent the transaction and paid gas. */
  relayer: Address;
  from: Address | null;
  to: Address | null;
  /** Accounts whose authority the contract checked for this action. */
  authorisedBy: Address[];
  gate: Address | null;
};

type RawTicket = {
  tokenId: bigint;
  eventId: bigint;
  ticketNumber: bigint;
  owner: Address;
  used: boolean;
  checkedInAt: bigint;
  nonce: bigint;
};

const toTicket = (t: RawTicket): TicketState => ({
  tokenId: Number(t.tokenId),
  eventId: Number(t.eventId),
  ticketNumber: Number(t.ticketNumber),
  owner: getAddress(t.owner),
  used: t.used,
  checkedInAt: Number(t.checkedInAt),
  nonce: Number(t.nonce),
});

export async function readEvent(client: PublicClient, contract: Address, eventId: number): Promise<EventState> {
  const ev = await client.readContract({
    address: contract,
    abi: ticketLockAbi,
    functionName: "getEvent",
    args: [BigInt(eventId)],
  });
  return {
    eventId,
    organiser: getAddress(ev.organiser),
    capacity: Number(ev.capacity),
    mintedCount: Number(ev.mintedCount),
    checkedInCount: Number(ev.checkedInCount),
  };
}

export async function readTicket(
  client: PublicClient,
  contract: Address,
  tokenId: number,
  blockNumber?: bigint,
): Promise<TicketState> {
  const t = await client.readContract({
    address: contract,
    abi: ticketLockAbi,
    functionName: "getTicket",
    args: [BigInt(tokenId)],
    blockNumber,
  });
  return toTicket(t);
}

export async function readTicketsOf(client: PublicClient, contract: Address, owner: Address): Promise<TicketState[]> {
  const tickets = await client.readContract({
    address: contract,
    abi: ticketLockAbi,
    functionName: "ticketsOf",
    args: [owner],
  });
  return tickets.map(toTicket).sort((a, b) => a.tokenId - b.tokenId);
}

/**
 * Ticket history from the chain alone. The contract records which blocks touched the ticket,
 * so each block is fetched with a single-block log query that every RPC provider accepts.
 */
export async function readTicketHistory(
  client: PublicClient,
  contract: Address,
  tokenId: number,
): Promise<HistoryEntry[]> {
  const blocks = await client.readContract({
    address: contract,
    abi: ticketLockAbi,
    functionName: "activityBlocks",
    args: [BigInt(tokenId)],
  });
  const id = BigInt(tokenId);
  const perBlock = await Promise.all(
    blocks.map(async (blockNumber) => {
      const [rawLogs, block] = await Promise.all([
        client.getLogs({ address: contract, fromBlock: blockNumber, toBlock: blockNumber }),
        client.getBlock({ blockNumber }),
      ]);
      const logs = parseEventLogs({ abi: ticketLockAbi, logs: rawLogs }).filter(
        (log) => "tokenId" in log.args && log.args.tokenId === id,
      );
      const hashes = [...new Set(logs.map((log) => log.transactionHash))];
      const entries: HistoryEntry[] = [];
      for (const txHash of hashes) {
        const tx = await client.getTransaction({ hash: txHash });
        const base = {
          txHash,
          blockNumber: Number(blockNumber),
          timestamp: Number(block.timestamp),
          relayer: getAddress(tx.from),
        };
        for (const log of logs.filter((l) => l.transactionHash === txHash)) {
          if (log.eventName === "TicketIssued") {
            entries.push({
              ...base,
              kind: "issued",
              from: null,
              to: getAddress(log.args.recipient),
              authorisedBy: [getAddress(tx.from)],
              gate: null,
            });
          } else if (log.eventName === "Transfer" && log.args.from !== zeroAddress) {
            entries.push({
              ...base,
              kind: "transferred",
              from: getAddress(log.args.from),
              to: getAddress(log.args.to),
              authorisedBy: [getAddress(log.args.from)],
              gate: null,
            });
          } else if (log.eventName === "TicketCheckedIn") {
            entries.push({
              ...base,
              kind: "checkedIn",
              from: null,
              to: null,
              authorisedBy: [getAddress(log.args.owner), getAddress(log.args.gate)],
              gate: getAddress(log.args.gate),
            });
          }
        }
      }
      return entries;
    }),
  );
  return perBlock.flat();
}
