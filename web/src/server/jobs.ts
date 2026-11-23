import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { readTicket } from "@/lib/chain-read";
import { ticketLockAbi } from "@/lib/contract/abi";
import {
  checkInPermitMessage,
  transferPermitMessage,
  type CheckInPermitJson,
  type TransferPermitJson,
} from "@/lib/permits";
import { getChain } from "./chain";
import { getDb, now, transaction } from "./db";
import { describeRevert } from "./errors";

// tx_jobs is the queue. One worker sends one relayer transaction at a time. Each transaction is
// signed and stored with its hash before it is broadcast, so a restart continues the same
// transaction instead of creating another one.

export type JobOperation = "issue" | "transfer" | "checkin";
export type IssueArgs = { eventId: number; recipient: Address; orderId: Hex };
export type TransferArgs = { permit: TransferPermitJson; signature: Hex; recipientEmail: string };
export type CheckInArgs = { permit: CheckInPermitJson; ownerSignature: Hex; gateSignature: Hex };

export type JobRow = {
  id: number;
  operation: JobOperation;
  ref_id: string;
  user_id: string;
  token_id: number | null;
  args: string;
  status: "queued" | "signed" | "broadcast" | "confirmed" | "failed";
  tx_nonce: number | null;
  tx_hash: Hex | null;
  raw_tx: Hex | null;
  block_number: number | null;
  block_time: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type JobView = {
  id: number;
  operation: JobOperation;
  status: "processing" | "confirmed" | "failed";
  tokenId: number | null;
  txHash: Hex | null;
  blockNumber: number | null;
  blockTime: number | null;
  error: string | null;
};

export const toJobView = (job: JobRow): JobView => ({
  id: job.id,
  operation: job.operation,
  status: job.status === "confirmed" || job.status === "failed" ? job.status : "processing",
  tokenId: job.token_id,
  txHash: job.tx_hash,
  blockNumber: job.block_number,
  blockTime: job.block_time,
  error: job.error,
});

export const getJob = (id: number) =>
  getDb().prepare("SELECT * FROM tx_jobs WHERE id = ?").get(id) as JobRow | undefined;

/** Insert a job. Call inside the transaction that records the business request. */
export function insertJob(
  operation: JobOperation,
  refId: string,
  userId: string,
  tokenId: number | null,
  args: IssueArgs | TransferArgs | CheckInArgs,
): number {
  const t = now();
  const result = getDb()
    .prepare(
      "INSERT INTO tx_jobs (operation, ref_id, user_id, token_id, args, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
    )
    .run(operation, refId, userId, tokenId, JSON.stringify(args), t, t);
  return Number(result.lastInsertRowid);
}

function buildCall(job: JobRow) {
  if (job.operation === "issue") {
    const args = JSON.parse(job.args) as IssueArgs;
    return { functionName: "issueTicket", args: [BigInt(args.eventId), args.recipient, args.orderId] } as const;
  }
  if (job.operation === "transfer") {
    const args = JSON.parse(job.args) as TransferArgs;
    return { functionName: "transferWithPermit", args: [transferPermitMessage(args.permit), args.signature] } as const;
  }
  const args = JSON.parse(job.args) as CheckInArgs;
  return {
    functionName: "checkIn",
    args: [checkInPermitMessage(args.permit), args.ownerSignature, args.gateSignature],
  } as const;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function update(id: number, fields: Partial<JobRow>) {
  const entries = Object.entries({ ...fields, updated_at: now() });
  getDb()
    .prepare("UPDATE tx_jobs SET " + entries.map(([key]) => key + " = ?").join(", ") + " WHERE id = ?")
    .run(...entries.map(([, value]) => value as string | number | null), id);
}

function settleAdmission(jobId: number, status: "confirmed" | "failed") {
  getDb()
    .prepare("UPDATE admission_requests SET status = ?, decided_at = ? WHERE job_id = ? AND status = 'processing'")
    .run(status, now(), jobId);
}

function fail(job: JobRow, reason: string) {
  transaction(() => {
    update(job.id, { status: "failed", error: reason });
    if (job.operation === "checkin") settleAdmission(job.id, "failed");
  });
}

async function findReceipt(hash: Hex): Promise<TransactionReceipt | null> {
  try {
    return await getChain().publicClient.getTransactionReceipt({ hash });
  } catch {
    return null;
  }
}

/** Simulate, sign and persist the transaction. Nothing is broadcast here. */
async function sign(job: JobRow): Promise<JobRow | null> {
  const { publicClient, walletClient, account, contract } = getChain();
  const call = buildCall(job);
  try {
    // Types: the three call shapes form a union viem cannot narrow; the ABI still checks each above.
    await publicClient.simulateContract({ address: contract, abi: ticketLockAbi, account, ...call } as never);
  } catch (error) {
    const reason = describeRevert(error);
    if (!reason) throw error; // Network trouble: leave the job queued and retry.
    fail(job, reason);
    return null;
  }
  const data = encodeFunctionData({ abi: ticketLockAbi, ...call } as never);
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const gas = ((await publicClient.estimateGas({ account, to: contract, data })) * 13n) / 10n;
  const request = await walletClient.prepareTransactionRequest({ to: contract, data, nonce, gas });
  const rawTx = await walletClient.signTransaction(request);
  update(job.id, { status: "signed", raw_tx: rawTx, tx_hash: keccak256(rawTx), tx_nonce: nonce });
  return getJob(job.id)!;
}

/** Broadcast the stored transaction (again if needed) and wait for its receipt. */
async function broadcast(job: JobRow): Promise<TransactionReceipt | null> {
  const { publicClient, account } = getChain();
  const hash = job.tx_hash!;
  const mined = await findReceipt(hash);
  if (mined) return mined;
  try {
    await publicClient.sendRawTransaction({ serializedTransaction: job.raw_tx! });
  } catch (error) {
    // The node may already hold this exact transaction, or it may have been mined meanwhile.
    for (let attempt = 0; attempt < 5; attempt++) {
      const receipt = await findReceipt(hash);
      if (receipt) return receipt;
      await sleep(1000);
    }
    const used = await publicClient.getTransactionCount({ address: account.address });
    if (used > job.tx_nonce!) {
      fail(job, "The relayer sent a different transaction with this nonce; this request was not executed.");
      return null;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("already known") && !message.includes("already imported")) throw error;
  }
  if (job.status !== "broadcast") update(job.id, { status: "broadcast" });
  try {
    return await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 1_000 });
  } catch {
    return null; // Still pending. The job stays 'broadcast' and is picked up again.
  }
}

/** Confirm the expected state at the receipt block before reporting success. */
async function readBack(job: JobRow, receipt: TransactionReceipt): Promise<number> {
  const { publicClient, contract } = getChain();
  let tokenId: number;
  let check: (ticket: Awaited<ReturnType<typeof readTicket>>) => boolean;
  if (job.operation === "issue") {
    const args = JSON.parse(job.args) as IssueArgs;
    const [issued] = parseEventLogs({ abi: ticketLockAbi, logs: receipt.logs, eventName: "TicketIssued" });
    if (!issued) throw new Error("Receipt " + receipt.transactionHash + " has no TicketIssued log.");
    tokenId = Number(issued.args.tokenId);
    check = (ticket) => ticket.owner === getAddress(args.recipient);
  } else if (job.operation === "transfer") {
    const args = JSON.parse(job.args) as TransferArgs;
    tokenId = Number(args.permit.tokenId);
    check = (ticket) => ticket.owner === getAddress(args.permit.to);
  } else {
    const args = JSON.parse(job.args) as CheckInArgs;
    tokenId = Number(args.permit.tokenId);
    check = (ticket) => ticket.used;
  }
  let lastError: unknown = new Error("Readback did not match the receipt.");
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // A lagging RPC node may not serve the receipt block yet; that is not a failure.
      if (check(await readTicket(publicClient, contract, tokenId, receipt.blockNumber))) return tokenId;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError;
}

async function processNext(): Promise<boolean> {
  // An unfinished signed or broadcast transaction always goes first.
  let job = getDb()
    .prepare(
      "SELECT * FROM tx_jobs WHERE status IN ('signed', 'broadcast', 'queued') ORDER BY (status = 'queued'), id LIMIT 1",
    )
    .get() as JobRow | undefined;
  if (!job) return false;

  if (job.status === "queued") {
    const signed = await sign(job);
    if (!signed) return true;
    job = signed;
  }
  const receipt = await broadcast(job);
  if (!receipt) return true;

  if (receipt.status !== "success") {
    fail(job, "The transaction was included but reverted, so nothing changed.");
    return true;
  }
  const tokenId = await readBack(job, receipt);
  const block = await getChain().publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const done = job;
  transaction(() => {
    update(done.id, {
      status: "confirmed",
      token_id: tokenId,
      block_number: Number(receipt.blockNumber),
      block_time: Number(block.timestamp),
    });
    if (done.operation === "issue") {
      getDb().prepare("UPDATE orders SET token_id = ? WHERE job_id = ?").run(tokenId, done.id);
    } else if (done.operation === "checkin") {
      settleAdmission(done.id, "confirmed");
    }
  });
  return true;
}

const globals = globalThis as { __ticketlockWorker?: boolean };

/** Start the single serial worker for this process. Safe to call more than once. */
export function startWorker() {
  if (globals.__ticketlockWorker) return;
  globals.__ticketlockWorker = true;
  // Let the process exit on shutdown; otherwise this loop outlives the HTTP server and a
  // restarted app would run two workers on one queue. Unfinished jobs resume from the database.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => (stopping = true));
  void (async () => {
    while (!stopping) {
      try {
        if (!(await processNext())) await sleep(400);
      } catch (error) {
        console.error("[worker] will retry:", error instanceof Error ? error.message : error);
        await sleep(2000);
      }
    }
  })();
}

/** Process queued work until the queue is empty. Used by tests instead of the background loop. */
export async function drainJobs() {
  while (await processNext()) {
    // keep going
  }
}
