// Backend lifecycle against a running local chain (pnpm chain). Each run deploys its own
// contract and uses a throwaway database, so it never touches the demo deployment.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { createPublicClient, createWalletClient, http, parseEther, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const RPC = "http://127.0.0.1:8545";
const relayerKey = generatePrivateKey();
const relayer = privateKeyToAccount(relayerKey);
const accounts = {
  alice: privateKeyToAccount(generatePrivateKey()),
  bob: privateKeyToAccount(generatePrivateKey()),
  organiser: privateKeyToAccount(generatePrivateKey()),
};
type Name = keyof typeof accounts;
const user = (name: Name) => ({ privyId: "did:test:" + name, email: name + "@example.test", address: accounts[name].address });

const publicClient = createPublicClient({ chain: hardhat, transport: http(RPC) });
const artifact = JSON.parse(
  readFileSync(path.resolve("../contracts/artifacts/contracts/TicketLockDemo.sol/TicketLockDemo.json"), "utf8"),
);

let services: typeof import("../src/server/services");
let jobs: typeof import("../src/server/jobs");
let db: typeof import("../src/server/db");
let contract: Hex;

const expectAppError = (code: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, code, String(error));
  return true;
};

async function buyTicket(name: Name, key: string) {
  const order = services.createOrder(user(name), key);
  await jobs.drainJobs();
  return services.getOrder(user(name), order.id);
}

before(async () => {
  try {
    await publicClient.getChainId();
  } catch {
    throw new Error("Start the local chain first: pnpm chain");
  }
  await publicClient.request({
    method: "hardhat_setBalance" as never,
    params: [relayer.address, toHex(parseEther("10"))] as never,
  });
  const wallet = createWalletClient({ account: relayer, chain: hardhat, transport: http(RPC) });
  const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [relayer.address] });
  const deployed = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  contract = deployed.contractAddress!;
  const eventHash = await wallet.writeContract({
    address: contract,
    abi: artifact.abi,
    functionName: "createEvent",
    args: [accounts.organiser.address, 3n],
  });
  await publicClient.waitForTransactionReceipt({ hash: eventHash });

  const dir = mkdtempSync(path.join(tmpdir(), "ticketlock-test-"));
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      network: "local", chainId: 31337, contract, deploymentBlock: Number(deployed.blockNumber), deploymentTx: deployHash,
      issuer: relayer.address, eventId: 1, organiser: accounts.organiser.address, capacity: 3,
    }),
  );
  Object.assign(process.env, {
    TICKETLOCK_NETWORK: "local",
    TICKETLOCK_MANIFEST: manifest,
    TICKETLOCK_DB: path.join(dir, "test.sqlite"),
    RELAYER_PRIVATE_KEY: relayerKey,
    PRIVY_APP_SECRET: "unused-in-tests",
    NEXT_PUBLIC_PRIVY_APP_ID: "unused-in-tests",
  });
  services = await import("../src/server/services");
  jobs = await import("../src/server/jobs");
  db = await import("../src/server/db");
  const insert = db.getDb().prepare("INSERT INTO users (privy_id, email, address, created_at) VALUES (?, ?, ?, 0)");
  for (const name of Object.keys(accounts) as Name[]) insert.run(user(name).privyId, user(name).email, user(name).address);
});

describe("backend lifecycle", () => {
  let tokenId: number;

  it("issues one ticket per checkout, however often it is retried", async () => {
    const first = services.createOrder(user("alice"), "checkout-alice-0001");
    const retry = services.createOrder(user("alice"), "checkout-alice-0001");
    assert.equal(retry.id, first.id);
    assert.equal(first.job.status, "processing");
    assert.throws(() => services.createOrder(user("bob"), "checkout-alice-0001"), expectAppError("conflict"));

    await jobs.drainJobs();
    const order = services.getOrder(user("alice"), first.id);
    assert.equal(order.job.status, "confirmed");
    assert.match(order.job.txHash!, /^0x[0-9a-f]{64}$/);
    tokenId = order.tokenId!;
    const held = await services.listTickets(user("alice"));
    assert.deepEqual(held.map((t) => [t.tokenId, t.used, t.pending]), [[tokenId, false, null]]);
    const receipt = await publicClient.getTransactionReceipt({ hash: order.job.txHash! });
    assert.equal(receipt.from.toLowerCase(), relayer.address.toLowerCase());
  });

  it("continues the same transaction after a restart instead of minting again", async () => {
    const order = services.createOrder(user("alice"), "checkout-alice-0001");
    const supplyBefore = await publicClient.readContract({ address: contract, abi: artifact.abi, functionName: "totalSupply" });
    // Simulate a crash after broadcasting but before the result was recorded.
    db.getDb().prepare("UPDATE tx_jobs SET status = 'signed', block_number = NULL WHERE id = ?").run(order.job.id);
    await jobs.drainJobs();
    const after = services.getOrder(user("alice"), order.id);
    assert.equal(after.job.status, "confirmed");
    assert.equal(after.job.txHash, order.job.txHash);
    assert.equal(await publicClient.readContract({ address: contract, abi: artifact.abi, functionName: "totalSupply" }), supplyBefore);
  });

  it("transfers only for the holder's signature over the exact intent", async () => {
    await assert.rejects(services.prepareTransfer(user("alice"), tokenId, "nobody@example.test"), expectAppError("recipient_not_found"));
    await assert.rejects(services.prepareTransfer(user("bob"), tokenId, "alice@example.test"), expectAppError("not_owner"));
    const { typedData, recipient } = await services.prepareTransfer(user("alice"), tokenId, " Bob@Example.test ");
    assert.equal(recipient.address, accounts.bob.address);
    const sign = (signer: Name, message = typedData.message) =>
      accounts[signer].signTypedData({
        domain: typedData.domain, types: typedData.types, primaryType: "TransferPermit",
        message: {
          ...message, eventId: BigInt(message.eventId), tokenId: BigInt(message.tokenId), ticketNonce: BigInt(message.ticketNonce),
          issuedAt: BigInt(message.issuedAt), deadline: BigInt(message.deadline),
        },
      });
    const signature = await sign("alice");

    // The relayer cannot redirect a signed transfer, and nobody else can sign for the holder.
    const redirected = { ...typedData.message, to: accounts.organiser.address };
    await assert.rejects(services.submitTransfer(user("alice"), redirected, signature), expectAppError("bad_signature"));
    await assert.rejects(services.submitTransfer(user("alice"), typedData.message, await sign("bob")), expectAppError("bad_signature"));
    await assert.rejects(services.submitTransfer(user("bob"), typedData.message, signature), expectAppError("not_owner"));

    const job = await services.submitTransfer(user("alice"), typedData.message, signature);
    assert.equal((await services.submitTransfer(user("alice"), typedData.message, signature)).id, job.id);
    assert.deepEqual((await services.listTickets(user("alice")))[0].pending, { kind: "transfer", jobId: job.id });
    await jobs.drainJobs();
    assert.equal(services.getJobForUser(user("alice"), job.id).status, "confirmed");
    assert.equal((await services.listTickets(user("alice"))).length, 0);
    assert.deepEqual((await services.listTickets(user("bob"))).map((t) => t.tokenId), [tokenId]);
  });

  const signCheckIn = (signer: Name, typedData: Awaited<ReturnType<typeof services.prepareAdmission>>["typedData"]) =>
    accounts[signer].signTypedData({
      domain: typedData.domain, types: typedData.types, primaryType: "CheckInPermit",
      message: {
        ...typedData.message, eventId: BigInt(typedData.message.eventId), tokenId: BigInt(typedData.message.tokenId),
        ticketNonce: BigInt(typedData.message.ticketNonce), issuedAt: BigInt(typedData.message.issuedAt),
        deadline: BigInt(typedData.message.deadline),
      },
    });

  async function requestEntry(name: Name, token: number) {
    const { typedData } = await services.prepareAdmission(user(name), 1, token);
    return services.submitAdmission(user(name), typedData.message, await signCheckIn(name, typedData));
  }

  it("leaves the ticket available when a request is rejected or expires", async () => {
    const rejected = await requestEntry("bob", tokenId);
    assert.equal(rejected.status, "waiting");
    assert.match(rejected.shortCode, /^[A-Z2-9]{4}$/);
    await assert.rejects(services.rejectAdmission(user("alice"), rejected.id), expectAppError("not_organiser"));
    assert.equal((await services.rejectAdmission(user("organiser"), rejected.id)).status, "rejected");

    const lapsed = await requestEntry("bob", tokenId);
    db.getDb().prepare("UPDATE admission_requests SET deadline = 1 WHERE id = ?").run(lapsed.id);
    assert.equal(services.getAdmission(user("bob"), lapsed.id).status, "expired");
    const overview = await services.organiserOverview(user("organiser"));
    assert.equal(overview.pending.length, 0);
    await assert.rejects(services.approveAdmission(user("organiser"), lapsed.id, "0x" + "11".repeat(65)), expectAppError("expired"));

    await jobs.drainJobs();
    const [ticket] = await services.listTickets(user("bob"));
    assert.deepEqual([ticket.used, ticket.pending], [false, null]);
  });

  it("admits once, only with the organiser's signature over the holder's request", async () => {
    const request = await requestEntry("bob", tokenId);
    // The holder's confirmation alone changes nothing on chain.
    await jobs.drainJobs();
    assert.equal((await services.listTickets(user("bob")))[0].used, false);

    const overview = await services.organiserOverview(user("organiser"));
    assert.deepEqual(overview.pending.map((p) => [p.id, p.shortCode]), [[request.id, request.shortCode]]);
    await assert.rejects(services.organiserOverview(user("bob")), expectAppError("not_organiser"));
    const typedData = overview.pending[0].typedData;

    await assert.rejects(services.approveAdmission(user("bob"), request.id, await signCheckIn("bob", typedData)), expectAppError("not_organiser"));
    await assert.rejects(services.approveAdmission(user("organiser"), request.id, await signCheckIn("bob", typedData)), expectAppError("bad_signature"));

    const approved = await services.approveAdmission(user("organiser"), request.id, await signCheckIn("organiser", typedData));
    assert.equal(approved.status, "processing");
    await assert.rejects(services.approveAdmission(user("organiser"), request.id, await signCheckIn("organiser", typedData)), expectAppError("already_decided"));
    assert.equal((await services.listTickets(user("bob")))[0].used, false, "not used until the transaction confirms");

    await jobs.drainJobs();
    const done = services.getAdmission(user("bob"), request.id);
    assert.equal(done.status, "confirmed");
    const [ticket] = await services.listTickets(user("bob"));
    assert.equal(ticket.used, true);
    assert.equal(ticket.checkedInAt, done.job!.blockTime);
    assert.equal((await services.organiserOverview(user("organiser"))).event.checkedInCount, 1);

    await assert.rejects(requestEntry("bob", tokenId), expectAppError("ticket_used"));
    await assert.rejects(services.prepareTransfer(user("bob"), tokenId, "alice@example.test"), expectAppError("ticket_used"));
  });

  it("reads the full history from the chain", async () => {
    const { ticket, history } = await services.ticketHistory(tokenId);
    assert.equal(ticket.owner, accounts.bob.address);
    assert.deepEqual(history.map((h) => h.kind), ["issued", "transferred", "checkedIn"]);
    assert.ok(history.every((h) => h.relayer === relayer.address));
    assert.deepEqual(history[1].authorisedBy, [accounts.alice.address]);
    assert.deepEqual(history[2].authorisedBy, [accounts.bob.address, accounts.organiser.address]);
  });

  it("reports a failed order honestly when the event is sold out", async () => {
    assert.equal((await buyTicket("alice", "checkout-alice-0002")).job.status, "confirmed");
    assert.equal((await buyTicket("alice", "checkout-alice-0003")).job.status, "confirmed");
    const failed = await buyTicket("bob", "checkout-bob-00000004");
    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.txHash, null);
    assert.match(failed.job.error!, /sold out/i);
    assert.equal(failed.tokenId, null);
  });
});
