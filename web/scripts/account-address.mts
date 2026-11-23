// Prints the embedded wallet address of a registered account, looked up through Privy.
// The account must have signed in to the app once. Used to seed the event organiser.
// Usage: pnpm --filter @ticketlock/web account-address <email>
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrivyClient } from "@privy-io/server-auth";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const email = process.argv[2];
if (!email) throw new Error("Usage: account-address <email>");
const { NEXT_PUBLIC_PRIVY_APP_ID: appId, PRIVY_APP_SECRET: secret } = process.env;
if (!appId || !secret) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must be set in .env.");

const user = await new PrivyClient(appId, secret).getUserByEmail(email);
const wallet = user?.linkedAccounts.find(
  (account) => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
);
if (!wallet || wallet.type !== "wallet") {
  throw new Error("No embedded wallet found for " + email + ". Sign in to the app with this email first.");
}
console.log(wallet.address);
