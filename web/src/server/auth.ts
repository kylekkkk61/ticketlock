import { PrivyClient } from "@privy-io/server-auth";
import { getAddress, type Address } from "viem";
import { getConfig } from "./config";
import { getDb, now } from "./db";
import { AppError } from "./errors";

export type SessionUser = { privyId: string; email: string; address: Address };

const globals = globalThis as { __ticketlockPrivy?: PrivyClient };
const privy = () =>
  (globals.__ticketlockPrivy ??= new PrivyClient(getConfig().public.privyAppId, getConfig().privyAppSecret));

type UserRow = { privy_id: string; email: string; address: string };
const toUser = (row: UserRow): SessionUser => ({
  privyId: row.privy_id,
  email: row.email,
  address: getAddress(row.address),
});

export function findUserByEmail(email: string): SessionUser | null {
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | UserRow
    | undefined;
  return row ? toUser(row) : null;
}

/**
 * Authenticates the request with the Privy access token. The email and embedded wallet address
 * come from Privy's verified server-side record, never from the request body.
 */
export async function requireUser(request: Request): Promise<SessionUser> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new AppError(401, "unauthenticated", "Please sign in.");
  let privyId: string;
  try {
    privyId = (await privy().verifyAuthToken(header.slice(7))).userId;
  } catch {
    throw new AppError(401, "unauthenticated", "Your session has expired. Please sign in again.");
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE privy_id = ?").get(privyId) as UserRow | undefined;
  if (existing) return toUser(existing);

  const profile = await privy().getUserById(privyId);
  const email = profile.email?.address?.toLowerCase();
  const wallet = profile.linkedAccounts.find(
    (account) => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
  );
  if (!email) throw new AppError(403, "email_required", "Sign in with an email address to use TicketLock.");
  if (!wallet || wallet.type !== "wallet") {
    throw new AppError(409, "wallet_not_ready", "Your account is still being prepared. Please wait a moment.");
  }
  const address = getAddress(wallet.address);
  db.prepare("INSERT OR IGNORE INTO users (privy_id, email, address, created_at) VALUES (?, ?, ?, ?)").run(
    privyId,
    email,
    address,
    now(),
  );
  return { privyId, email, address };
}
