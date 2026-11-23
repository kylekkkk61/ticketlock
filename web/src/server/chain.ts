import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { readEvent, type EventState } from "@/lib/chain-read";
import { getConfig } from "./config";

function build() {
  const config = getConfig();
  const account = privateKeyToAccount(config.relayerKey);
  if (account.address !== config.public.relayer) {
    throw new Error("RELAYER_PRIVATE_KEY does not match the deployment's issuer " + config.public.relayer + ".");
  }
  const transport = http(config.rpcUrl);
  // Cast: the OP-stack chain type narrows the client, but only standard reads are used here.
  const publicClient = createPublicClient({ chain: config.chain, transport }) as PublicClient;
  const walletClient = createWalletClient({ account, chain: config.chain, transport });
  return { account, publicClient, walletClient, contract: config.public.contract };
}

const globals = globalThis as {
  __ticketlockChain?: ReturnType<typeof build>;
  __ticketlockEvents?: Map<number, EventState["organiser"]>;
};
export const getChain = () => (globals.__ticketlockChain ??= build());

/** Timestamp of a recent block, used as the permit's issuedAt. */
export async function chainNow(): Promise<number> {
  const { publicClient } = getChain();
  let block = await publicClient.getBlock();
  if (getConfig().chain.id === hardhat.id && Date.now() / 1000 - Number(block.timestamp) > 2) {
    // The local chain only mines when a transaction arrives; refresh its clock.
    await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    block = await publicClient.getBlock();
  }
  return Number(block.timestamp);
}

/** The event's organiser is immutable on chain, so it is cached after the first read. */
export async function eventOrganiser(eventId: number) {
  const cache = (globals.__ticketlockEvents ??= new Map());
  const known = cache.get(eventId);
  if (known) return known;
  const { publicClient, contract } = getChain();
  const organiser = (await readEvent(publicClient, contract, eventId)).organiser;
  cache.set(eventId, organiser);
  return organiser;
}
