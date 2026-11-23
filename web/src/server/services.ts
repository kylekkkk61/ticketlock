import { randomBytes } from "node:crypto";
import { getAddress, isAddress, isHex, toHex, verifyTypedData, type Address, type Hex } from "viem";
import { readEvent, readTicket, readTicketHistory, readTicketsOf, type TicketState } from "@/lib/chain-read";
import {
  CHECK_IN_PERMIT_TYPES,
  CHECK_IN_VALIDITY_SECONDS,
  TRANSFER_PERMIT_TYPES,
  TRANSFER_VALIDITY_SECONDS,
  checkInPermitMessage,
  permitDomain,
  transferPermitMessage,
  type CheckInPermitJson,
  type CheckInTypedData,
  type TransferPermitJson,
  type TransferTypedData,
} from "@/lib/permits";
import { findUserByEmail, type SessionUser } from "./auth";
import { chainNow, eventOrganiser, getChain } from "./chain";
import { getConfig } from "./config";
import { getDb, now, transaction } from "./db";
import { AppError } from "./errors";
import { getJob, insertJob, toJobView, type JobRow, type JobView } from "./jobs";

const ACTIVE_JOB = "('queued', 'signed', 'broadcast')";
const randomId = (): Hex => toHex(randomBytes(32));
const domain = () => permitDomain(getConfig().public.chainId, getConfig().public.contract);

const UINT = /^(0|[1-9]\d{0,30})$/;
function assertPermitShape(permit: unknown, actorFields: [string, string]): asserts permit is Record<string, string> {
  const p = permit as Record<string, unknown> | null;
  const ok =
    !!p &&
    typeof p === "object" &&
    ["eventId", "tokenId", "ticketNonce", "issuedAt", "deadline"].every((k) => typeof p[k] === "string" && UINT.test(p[k] as string)) &&
    actorFields.every((k) => typeof p[k] === "string" && isAddress(p[k] as string)) &&
    isHex(p.requestId) &&
    (p.requestId as string).length === 66;
  if (!ok) throw new AppError(400, "bad_request", "The signed request is malformed.");
}

function assertSignature(signature: unknown): asserts signature is Hex {
  if (!isHex(signature) || signature.length !== 132) {
    throw new AppError(400, "bad_request", "The signature is malformed.");
  }
}

// ───────────────────────────────── Account ──────────────────────────────────

export async function describeUser(user: SessionUser) {
  const organiser = await eventOrganiser(getConfig().public.eventId);
  return { email: user.email, address: user.address, isOrganiser: organiser === user.address };
}

// ───────────────────────────────── Purchase ─────────────────────────────────

type OrderRow = {
  id: string;
  checkout_key: string;
  user_id: string;
  event_id: number;
  job_id: number;
  token_id: number | null;
};
export type OrderView = { id: string; eventId: number; tokenId: number | null; job: JobView };

const toOrderView = (order: OrderRow): OrderView => ({
  id: order.id,
  eventId: order.event_id,
  tokenId: order.token_id,
  job: toJobView(getJob(order.job_id)!),
});

/** Create the mock order once per checkout key; repeats return the same order. */
export function createOrder(user: SessionUser, checkoutKey: unknown): OrderView {
  if (typeof checkoutKey !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(checkoutKey)) {
    throw new AppError(400, "bad_request", "The checkout key is missing or malformed.");
  }
  const db = getDb();
  return transaction(() => {
    const existing = db.prepare("SELECT * FROM orders WHERE checkout_key = ?").get(checkoutKey) as OrderRow | undefined;
    if (existing) {
      if (existing.user_id !== user.privyId) throw new AppError(409, "conflict", "This checkout belongs to another account.");
      return toOrderView(existing);
    }
    const orderId = randomId();
    const eventId = getConfig().public.eventId;
    const jobId = insertJob("issue", orderId, user.privyId, null, { eventId, recipient: user.address, orderId });
    db.prepare(
      "INSERT INTO orders (id, checkout_key, user_id, buyer_address, event_id, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(orderId, checkoutKey, user.privyId, user.address, eventId, jobId, now());
    return toOrderView(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow);
  });
}

export function getOrder(user: SessionUser, id: string): OrderView {
  const order = getDb().prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(id, user.privyId) as
    | OrderRow
    | undefined;
  if (!order) throw new AppError(404, "not_found", "Order not found.");
  return toOrderView(order);
}

// ───────────────────────────────── Tickets ──────────────────────────────────

export type TicketView = TicketState & {
  /** Workflow in progress for this ticket, if any. The chain state above stays authoritative. */
  pending: { kind: "transfer"; jobId: number } | { kind: "admission"; requestId: string } | null;
};

function pendingFor(tokenId: number): TicketView["pending"] {
  const db = getDb();
  const transfer = db
    .prepare("SELECT id FROM tx_jobs WHERE operation = 'transfer' AND token_id = ? AND status IN " + ACTIVE_JOB)
    .get(tokenId) as { id: number } | undefined;
  if (transfer) return { kind: "transfer", jobId: transfer.id };
  const admission = db
    .prepare(
      "SELECT id FROM admission_requests WHERE token_id = ? AND (status = 'processing' OR (status = 'waiting' AND deadline >= ?))",
    )
    .get(tokenId, now()) as { id: string } | undefined;
  return admission ? { kind: "admission", requestId: admission.id } : null;
}

export async function listTickets(user: SessionUser): Promise<TicketView[]> {
  const { publicClient, contract } = getChain();
  const tickets = await readTicketsOf(publicClient, contract, user.address);
  // Usable tickets come first, newest first, so a ticket just bought or received is on top.
  return tickets
    .sort((a, b) => Number(a.used) - Number(b.used) || b.tokenId - a.tokenId)
    .map((ticket) => ({ ...ticket, pending: ticket.used ? null : pendingFor(ticket.tokenId) }));
}

export async function ticketHistory(tokenId: number) {
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new AppError(400, "bad_request", "Unknown ticket.");
  const { publicClient, contract } = getChain();
  try {
    const [ticket, history] = await Promise.all([
      readTicket(publicClient, contract, tokenId),
      readTicketHistory(publicClient, contract, tokenId),
    ]);
    return { ticket, history };
  } catch {
    throw new AppError(404, "not_found", "This ticket does not exist on the contract.");
  }
}

/** A ticket the signed-in user holds, unused and with no other workflow in progress. */
async function requireFreeTicket(user: SessionUser, tokenId: number): Promise<TicketState> {
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new AppError(400, "bad_request", "Unknown ticket.");
  const { publicClient, contract } = getChain();
  let ticket: TicketState;
  try {
    ticket = await readTicket(publicClient, contract, tokenId);
  } catch {
    throw new AppError(404, "not_found", "This ticket does not exist.");
  }
  if (ticket.owner !== user.address) throw new AppError(403, "not_owner", "This ticket is not in your account.");
  if (ticket.used) throw new AppError(409, "ticket_used", "This ticket has already been used.");
  return ticket;
}

// ───────────────────────────────── Transfer ─────────────────────────────────

export async function prepareTransfer(user: SessionUser, tokenId: number, recipientEmail: unknown) {
  if (typeof recipientEmail !== "string" || !recipientEmail.includes("@")) {
    throw new AppError(400, "bad_request", "Enter the recipient's email address.");
  }
  const recipient = findUserByEmail(recipientEmail);
  if (!recipient) {
    throw new AppError(404, "recipient_not_found", "No TicketLock account uses that email. Ask them to sign in once first.");
  }
  if (recipient.address === user.address) throw new AppError(400, "self_transfer", "You already hold this ticket.");
  const ticket = await requireFreeTicket(user, tokenId);
  if (pendingFor(tokenId)) throw new AppError(409, "ticket_busy", "This ticket already has a request in progress.");

  const issuedAt = await chainNow();
  const message: TransferPermitJson = {
    eventId: String(ticket.eventId),
    tokenId: String(tokenId),
    from: user.address,
    to: recipient.address,
    ticketNonce: String(ticket.nonce),
    requestId: randomId(),
    issuedAt: String(issuedAt),
    deadline: String(issuedAt + TRANSFER_VALIDITY_SECONDS),
  };
  const typedData: TransferTypedData = {
    domain: domain(),
    types: TRANSFER_PERMIT_TYPES,
    primaryType: "TransferPermit",
    message,
  };
  return { typedData, recipient: { email: recipient.email, address: recipient.address } };
}

/** Verify the holder's signature over the exact intent, then queue the relayed transfer. */
export async function submitTransfer(user: SessionUser, permit: unknown, signature: unknown): Promise<JobView> {
  assertPermitShape(permit, ["from", "to"]);
  assertSignature(signature);
  const p = permit as TransferPermitJson;
  const db = getDb();
  const queued = db.prepare("SELECT * FROM tx_jobs WHERE operation = 'transfer' AND ref_id = ?").get(p.requestId) as
    | JobRow
    | undefined;
  if (queued) {
    if (queued.user_id !== user.privyId) throw new AppError(409, "conflict", "This request belongs to another account.");
    return toJobView(queued);
  }

  if (getAddress(p.from) !== user.address) throw new AppError(403, "not_owner", "You can only transfer your own ticket.");
  const recipient = db.prepare("SELECT email FROM users WHERE address = ?").get(getAddress(p.to)) as
    | { email: string }
    | undefined;
  if (!recipient) throw new AppError(404, "recipient_not_found", "The recipient is not a registered TicketLock account.");
  const tokenId = Number(p.tokenId);
  const ticket = await requireFreeTicket(user, tokenId);
  if (pendingFor(tokenId)) throw new AppError(409, "ticket_busy", "This ticket already has a request in progress.");
  const span = Number(p.deadline) - Number(p.issuedAt);
  if (
    Number(p.eventId) !== ticket.eventId ||
    Number(p.ticketNonce) !== ticket.nonce ||
    span <= 0 ||
    span > TRANSFER_VALIDITY_SECONDS
  ) {
    throw new AppError(409, "stale_request", "The ticket changed since this request was prepared. Please start again.");
  }
  if (Number(p.deadline) <= (await chainNow())) {
    throw new AppError(409, "expired", "This confirmation has expired. Please start again.");
  }
  const valid = await verifyTypedData({
    address: user.address,
    domain: domain(),
    types: TRANSFER_PERMIT_TYPES,
    primaryType: "TransferPermit",
    message: transferPermitMessage(p),
    signature,
  });
  if (!valid) throw new AppError(400, "bad_signature", "The signature does not match this transfer.");

  const jobId = insertJob("transfer", p.requestId, user.privyId, tokenId, {
    permit: p,
    signature,
    recipientEmail: recipient.email,
  });
  return toJobView(getJob(jobId)!);
}

export function getJobForUser(user: SessionUser, id: number): JobView {
  const job = Number.isSafeInteger(id) ? getJob(id) : undefined;
  if (!job || job.user_id !== user.privyId) throw new AppError(404, "not_found", "Request not found.");
  return toJobView(job);
}

// ───────────────────────────────── Admission ────────────────────────────────

type AdmissionRow = {
  id: string;
  user_id: string;
  event_id: number;
  token_id: number;
  ticket_number: number;
  payload: string;
  owner_signature: Hex;
  short_code: string;
  deadline: number;
  status: "waiting" | "rejected" | "expired" | "superseded" | "processing" | "confirmed" | "failed";
  job_id: number | null;
  created_at: number;
  decided_at: number | null;
};

export type AdmissionView = {
  id: string;
  eventId: number;
  tokenId: number;
  ticketNumber: number;
  shortCode: string;
  deadline: number;
  status: AdmissionRow["status"];
  holder: Address;
  createdAt: number;
  decidedAt: number | null;
  job: JobView | null;
};

const toAdmissionView = (row: AdmissionRow): AdmissionView => ({
  id: row.id,
  eventId: row.event_id,
  tokenId: row.token_id,
  ticketNumber: row.ticket_number,
  shortCode: row.short_code,
  deadline: row.deadline,
  status: row.status,
  holder: (JSON.parse(row.payload) as CheckInPermitJson).owner,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  job: row.job_id ? toJobView(getJob(row.job_id)!) : null,
});

/** Requests nobody approved in time simply lapse; the ticket stays available. */
function expireStale() {
  const t = now();
  getDb()
    .prepare("UPDATE admission_requests SET status = 'expired', decided_at = ? WHERE status = 'waiting' AND deadline < ?")
    .run(t, t);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newShortCode(eventId: number): string {
  const db = getDb();
  for (;;) {
    const code = Array.from(randomBytes(4), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
    const clash = db
      .prepare("SELECT 1 FROM admission_requests WHERE event_id = ? AND short_code = ? AND status IN ('waiting', 'processing')")
      .get(eventId, code);
    if (!clash) return code;
  }
}

export async function prepareAdmission(user: SessionUser, eventId: number, tokenId: number) {
  if (eventId !== getConfig().public.eventId) throw new AppError(404, "unknown_event", "This entry code is not for a TicketLock event.");
  const ticket = await requireFreeTicket(user, tokenId);
  if (ticket.eventId !== eventId) throw new AppError(409, "wrong_event", "This ticket is for a different event.");
  const gate = await eventOrganiser(eventId);
  if (gate === user.address) throw new AppError(409, "holder_is_gate", "The organiser account cannot admit its own ticket.");
  if (pendingFor(tokenId)?.kind === "transfer") {
    throw new AppError(409, "ticket_busy", "This ticket is being transferred.");
  }
  const issuedAt = await chainNow();
  const message: CheckInPermitJson = {
    eventId: String(eventId),
    tokenId: String(tokenId),
    owner: user.address,
    gate,
    ticketNonce: String(ticket.nonce),
    requestId: randomId(),
    issuedAt: String(issuedAt),
    deadline: String(issuedAt + CHECK_IN_VALIDITY_SECONDS),
  };
  const typedData: CheckInTypedData = {
    domain: domain(),
    types: CHECK_IN_PERMIT_TYPES,
    primaryType: "CheckInPermit",
    message,
  };
  return { typedData };
}

/** Store the holder-signed intent for the organiser. Nothing is consumed at this point. */
export async function submitAdmission(user: SessionUser, permit: unknown, signature: unknown): Promise<AdmissionView> {
  assertPermitShape(permit, ["owner", "gate"]);
  assertSignature(signature);
  const p = permit as CheckInPermitJson;
  const db = getDb();
  const stored = db.prepare("SELECT * FROM admission_requests WHERE id = ?").get(p.requestId) as AdmissionRow | undefined;
  if (stored) {
    if (stored.user_id !== user.privyId) throw new AppError(409, "conflict", "This request belongs to another account.");
    return toAdmissionView(stored);
  }

  if (getAddress(p.owner) !== user.address) throw new AppError(403, "not_owner", "You can only use your own ticket.");
  const eventId = Number(p.eventId);
  const tokenId = Number(p.tokenId);
  if (eventId !== getConfig().public.eventId) throw new AppError(404, "unknown_event", "Unknown event.");
  const ticket = await requireFreeTicket(user, tokenId);
  const span = Number(p.deadline) - Number(p.issuedAt);
  if (
    ticket.eventId !== eventId ||
    Number(p.ticketNonce) !== ticket.nonce ||
    getAddress(p.gate) !== (await eventOrganiser(eventId)) ||
    span <= 0 ||
    span > CHECK_IN_VALIDITY_SECONDS
  ) {
    throw new AppError(409, "stale_request", "The ticket changed since this request was prepared. Please start again.");
  }
  if (Number(p.deadline) <= (await chainNow())) throw new AppError(409, "expired", "This confirmation has expired. Please confirm again.");
  const valid = await verifyTypedData({
    address: user.address,
    domain: domain(),
    types: CHECK_IN_PERMIT_TYPES,
    primaryType: "CheckInPermit",
    message: checkInPermitMessage(p),
    signature,
  });
  if (!valid) throw new AppError(400, "bad_signature", "The signature does not match this entry request.");

  return transaction(() => {
    if (pendingFor(tokenId)?.kind === "transfer") throw new AppError(409, "ticket_busy", "This ticket is being transferred.");
    const t = now();
    // A fresh confirmation replaces an earlier one the organiser has not acted on.
    db.prepare("UPDATE admission_requests SET status = 'superseded', decided_at = ? WHERE token_id = ? AND status = 'waiting'").run(t, tokenId);
    const busy = db.prepare("SELECT 1 FROM admission_requests WHERE token_id = ? AND status = 'processing'").get(tokenId);
    if (busy) throw new AppError(409, "ticket_busy", "This ticket is already being checked in.");
    db.prepare(
      "INSERT INTO admission_requests (id, user_id, event_id, token_id, ticket_number, payload, owner_signature, short_code, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    ).run(p.requestId, user.privyId, eventId, tokenId, ticket.ticketNumber, JSON.stringify(p), signature, newShortCode(eventId), Number(p.deadline), t);
    return toAdmissionView(db.prepare("SELECT * FROM admission_requests WHERE id = ?").get(p.requestId) as AdmissionRow);
  });
}

export function getAdmission(user: SessionUser, id: string): AdmissionView {
  expireStale();
  const row = getDb().prepare("SELECT * FROM admission_requests WHERE id = ? AND user_id = ?").get(id, user.privyId) as
    | AdmissionRow
    | undefined;
  if (!row) throw new AppError(404, "not_found", "Entry request not found.");
  return toAdmissionView(row);
}

// ───────────────────────────────── Organiser ────────────────────────────────

async function requireOrganiser(user: SessionUser, eventId: number) {
  if ((await eventOrganiser(eventId)) !== user.address) {
    throw new AppError(403, "not_organiser", "Only the event organiser can manage this event.");
  }
}

export async function organiserOverview(user: SessionUser) {
  const eventId = getConfig().public.eventId;
  await requireOrganiser(user, eventId);
  expireStale();
  const { publicClient, contract } = getChain();
  const db = getDb();
  const pendingRows = db
    .prepare("SELECT * FROM admission_requests WHERE event_id = ? AND status IN ('waiting', 'processing') ORDER BY created_at")
    .all(eventId) as AdmissionRow[];
  const recentRows = db
    .prepare(
      "SELECT * FROM admission_requests WHERE event_id = ? AND status IN ('confirmed', 'failed', 'rejected', 'expired') ORDER BY decided_at DESC LIMIT 12",
    )
    .all(eventId) as AdmissionRow[];
  return {
    event: await readEvent(publicClient, contract, eventId),
    pending: pendingRows.map((row) => ({
      ...toAdmissionView(row),
      // The organiser signs this exact payload; the server never rebuilds it.
      typedData: {
        domain: domain(),
        types: CHECK_IN_PERMIT_TYPES,
        primaryType: "CheckInPermit",
        message: JSON.parse(row.payload) as CheckInPermitJson,
      } satisfies CheckInTypedData,
    })),
    recent: recentRows.map(toAdmissionView),
  };
}

function requireWaiting(id: string, eventId: number): AdmissionRow {
  expireStale();
  const row = getDb().prepare("SELECT * FROM admission_requests WHERE id = ? AND event_id = ?").get(id, eventId) as
    | AdmissionRow
    | undefined;
  if (!row) throw new AppError(404, "not_found", "Entry request not found.");
  if (row.status === "expired") throw new AppError(409, "expired", "This request expired. Ask the customer to confirm entry again.");
  if (row.status !== "waiting") throw new AppError(409, "already_decided", "This request has already been handled.");
  return row;
}

/** The organiser signs the unchanged permit; both signatures go to the chain in one transaction. */
export async function approveAdmission(user: SessionUser, id: string, gateSignature: unknown): Promise<AdmissionView> {
  const eventId = getConfig().public.eventId;
  await requireOrganiser(user, eventId);
  assertSignature(gateSignature);
  const permit = JSON.parse(requireWaiting(id, eventId).payload) as CheckInPermitJson;
  const valid = await verifyTypedData({
    address: user.address,
    domain: domain(),
    types: CHECK_IN_PERMIT_TYPES,
    primaryType: "CheckInPermit",
    message: checkInPermitMessage(permit),
    signature: gateSignature,
  });
  if (!valid) throw new AppError(400, "bad_signature", "The organiser signature does not match this request.");

  const db = getDb();
  return transaction(() => {
    const row = requireWaiting(id, eventId);
    const jobId = insertJob("checkin", row.id, row.user_id, row.token_id, {
      permit,
      ownerSignature: row.owner_signature,
      gateSignature,
    });
    db.prepare("UPDATE admission_requests SET status = 'processing', gate_signature = ?, job_id = ? WHERE id = ?").run(gateSignature, jobId, id);
    return toAdmissionView(db.prepare("SELECT * FROM admission_requests WHERE id = ?").get(id) as AdmissionRow);
  });
}

export async function rejectAdmission(user: SessionUser, id: string): Promise<AdmissionView> {
  const eventId = getConfig().public.eventId;
  await requireOrganiser(user, eventId);
  const db = getDb();
  return transaction(() => {
    requireWaiting(id, eventId);
    db.prepare("UPDATE admission_requests SET status = 'rejected', decided_at = ? WHERE id = ?").run(now(), id);
    return toAdmissionView(db.prepare("SELECT * FROM admission_requests WHERE id = ?").get(id) as AdmissionRow);
  });
}

export async function eventSummary() {
  const { publicClient, contract } = getChain();
  return readEvent(publicClient, contract, getConfig().public.eventId);
}
