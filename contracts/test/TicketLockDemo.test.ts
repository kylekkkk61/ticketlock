import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();

const TRANSFER_TYPES = {
  TransferPermit: [
    { name: "eventId", type: "uint256" },
    { name: "tokenId", type: "uint256" },
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "ticketNonce", type: "uint256" },
    { name: "requestId", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const CHECK_IN_TYPES = {
  CheckInPermit: [
    { name: "eventId", type: "uint256" },
    { name: "tokenId", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "gate", type: "address" },
    { name: "ticketNonce", type: "uint256" },
    { name: "requestId", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

type Wallet = Awaited<ReturnType<typeof viem.getWalletClients>>[number];
let requestCounter = 0;
const randomId = (label = "req"): Hex => keccak256(toHex(label + "-" + ++requestCounter));
const orderId = (label: string): Hex => keccak256(toHex("order-" + label));

async function deployFixture() {
  const [issuer, organiser, alice, bob, carol, otherOrganiser] = await viem.getWalletClients();
  const ticketLock = await viem.deployContract("TicketLockDemo", [issuer.account.address]);
  await ticketLock.write.createEvent([organiser.account.address, 3n]);
  await ticketLock.write.createEvent([otherOrganiser.account.address, 1n]);
  // Token 1: event 1, held by Alice.
  await ticketLock.write.issueTicket([1n, alice.account.address, orderId("alice-1")]);
  const domain = {
    name: "TicketLock Demo",
    version: "2",
    chainId: await publicClient.getChainId(),
    verifyingContract: ticketLock.address,
  } as const;
  return { ticketLock, domain, issuer, organiser, alice, bob, carol, otherOrganiser };
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;
type Domain = { name: string; version: string; chainId: number; verifyingContract: Address };

async function transferPermit(
  fx: Fixture,
  from: Wallet,
  to: Address,
  overrides: Partial<Record<"eventId" | "tokenId" | "ticketNonce" | "issuedAt" | "deadline", bigint>> = {},
) {
  const now = BigInt(await networkHelpers.time.latest());
  const tokenId = overrides.tokenId ?? 1n;
  return {
    eventId: overrides.eventId ?? 1n,
    tokenId,
    from: from.account.address,
    to,
    ticketNonce: overrides.ticketNonce ?? (await fx.ticketLock.read.ticketNonce([tokenId])),
    requestId: randomId(),
    issuedAt: overrides.issuedAt ?? now,
    deadline: overrides.deadline ?? now + 300n,
  };
}

async function checkInPermit(
  fx: Fixture,
  owner: Wallet,
  gate: Address,
  overrides: Partial<Record<"eventId" | "tokenId" | "ticketNonce" | "issuedAt" | "deadline", bigint>> = {},
) {
  const now = BigInt(await networkHelpers.time.latest());
  const tokenId = overrides.tokenId ?? 1n;
  return {
    eventId: overrides.eventId ?? 1n,
    tokenId,
    owner: owner.account.address,
    gate,
    ticketNonce: overrides.ticketNonce ?? (await fx.ticketLock.read.ticketNonce([tokenId])),
    requestId: randomId(),
    issuedAt: overrides.issuedAt ?? now,
    deadline: overrides.deadline ?? now + 120n,
  };
}

const signTransfer = (signer: Wallet, domain: Domain, message: Awaited<ReturnType<typeof transferPermit>>) =>
  signer.signTypedData({ domain, types: TRANSFER_TYPES, primaryType: "TransferPermit", message });

const signCheckIn = (signer: Wallet, domain: Domain, message: Awaited<ReturnType<typeof checkInPermit>>) =>
  signer.signTypedData({ domain, types: CHECK_IN_TYPES, primaryType: "CheckInPermit", message });

const sameAddress = (a: string, b: string) => assert.equal(getAddress(a), getAddress(b));

describe("TicketLockDemo", () => {
  describe("events and issuance", () => {
    it("records the issuer, events and the first ticket", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      sameAddress(await fx.ticketLock.read.issuer(), fx.issuer.account.address);
      assert.equal(await fx.ticketLock.read.eventCount(), 2n);
      const ev = await fx.ticketLock.read.getEvent([1n]);
      sameAddress(ev.organiser, fx.organiser.account.address);
      assert.deepEqual([ev.capacity, ev.mintedCount, ev.checkedInCount], [3n, 1n, 0n]);

      const ticket = await fx.ticketLock.read.getTicket([1n]);
      sameAddress(ticket.owner, fx.alice.account.address);
      assert.deepEqual([ticket.eventId, ticket.ticketNumber, ticket.used, ticket.nonce], [1n, 1n, false, 0n]);
      assert.equal(await fx.ticketLock.read.orderToken([orderId("alice-1")]), 1n);
      assert.equal((await fx.ticketLock.read.ticketsOf([fx.alice.account.address])).length, 1);
      assert.equal((await fx.ticketLock.read.activityBlocks([1n])).length, 1);
    });

    it("only lets the issuer create events and issue tickets", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const asAlice = { account: fx.alice.account };
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.createEvent([fx.alice.account.address, 5n], asAlice), fx.ticketLock, "NotIssuer");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.issueTicket([1n, fx.alice.account.address, orderId("x")], asAlice), fx.ticketLock, "NotIssuer");
      // Even the organiser cannot mint for their own event.
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.issueTicket([1n, fx.bob.account.address, orderId("y")], { account: fx.organiser.account }),
        fx.ticketLock, "NotIssuer");
    });

    it("rejects invalid event settings and unknown events", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(fx.ticketLock.write.createEvent([zeroAddress, 5n]), fx.ticketLock, "ZeroAddress");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.createEvent([fx.organiser.account.address, 0n]), fx.ticketLock, "ZeroCapacity");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.issueTicket([99n, fx.bob.account.address, orderId("z")]), fx.ticketLock, "UnknownEvent");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.issueTicket([1n, zeroAddress, orderId("z")]), fx.ticketLock, "ZeroAddress");
    });

    it("mints an order ID once, even when retried for another recipient", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        fx.ticketLock.write.issueTicket([1n, fx.bob.account.address, orderId("alice-1")]),
        fx.ticketLock, "OrderAlreadyIssued", [orderId("alice-1"), 1n]);
      // Order IDs are global: the same order cannot mint under another event either.
      await viem.assertions.revertWithCustomErrorWithArgs(
        fx.ticketLock.write.issueTicket([2n, fx.bob.account.address, orderId("alice-1")]),
        fx.ticketLock, "OrderAlreadyIssued", [orderId("alice-1"), 1n]);
      assert.equal(await fx.ticketLock.read.totalSupply(), 1n);
    });

    it("stops issuing at capacity", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await fx.ticketLock.write.issueTicket([1n, fx.bob.account.address, orderId("b")]);
      await fx.ticketLock.write.issueTicket([1n, fx.carol.account.address, orderId("c")]);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.issueTicket([1n, fx.carol.account.address, orderId("d")]), fx.ticketLock, "EventSoldOut");
      assert.equal((await fx.ticketLock.read.getEvent([1n])).mintedCount, 3n);
    });

    it("serves on-chain metadata naming the event and ticket number", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const uri = await fx.ticketLock.read.tokenURI([1n]);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
      assert.match(json.name, /Event #1 Ticket #1/);
      const svg = Buffer.from(json.image.split(",")[1], "base64").toString("utf8");
      assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
    });
  });

  describe("signed transfer", () => {
    it("moves the ticket for a valid owner permit submitted by a third party", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const permit = await transferPermit(fx, fx.alice, fx.bob.account.address);
      const signature = await signTransfer(fx.alice, fx.domain, permit);
      // Carol relays; she is neither owner nor recipient.
      const hash = fx.ticketLock.write.transferWithPermit([permit, signature], { account: fx.carol.account });
      await viem.assertions.emitWithArgs(hash, fx.ticketLock, "Transfer", [
        getAddress(fx.alice.account.address), getAddress(fx.bob.account.address), 1n]);
      const ticket = await fx.ticketLock.read.getTicket([1n]);
      sameAddress(ticket.owner, fx.bob.account.address);
      assert.equal(ticket.nonce, 1n);
      assert.equal((await fx.ticketLock.read.ticketsOf([fx.alice.account.address])).length, 0);
      assert.equal((await fx.ticketLock.read.activityBlocks([1n])).length, 2);
    });

    it("binds event and token IDs separately and accepts a permit at its deadline", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      // Token 2 belongs to event 1, so swapped fields could not pass.
      await fx.ticketLock.write.issueTicket([1n, fx.alice.account.address, orderId("alice-2")]);
      const permit = await transferPermit(fx, fx.alice, fx.bob.account.address, { tokenId: 2n });
      const signature = await signTransfer(fx.alice, fx.domain, permit);
      await networkHelpers.time.setNextBlockTimestamp(permit.deadline);
      await fx.ticketLock.write.transferWithPermit([permit, signature]);
      sameAddress(await fx.ticketLock.read.ownerOf([2n]), fx.bob.account.address);
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), fx.alice.account.address);
    });

    it("refuses a recipient contract that cannot receive tickets", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const permit = await transferPermit(fx, fx.alice, fx.ticketLock.address);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([permit, await signTransfer(fx.alice, fx.domain, permit)]),
        fx.ticketLock, "ERC721InvalidReceiver");
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), fx.alice.account.address);
      assert.equal(await fx.ticketLock.read.ticketNonce([1n]), 0n);
    });

    it("rejects a tampered recipient, a wrong signer and a wrong domain", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const permit = await transferPermit(fx, fx.alice, fx.bob.account.address);
      const signature = await signTransfer(fx.alice, fx.domain, permit);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([{ ...permit, to: fx.carol.account.address }, signature]),
        fx.ticketLock, "InvalidOwnerSignature");

      const byBob = await signTransfer(fx.bob, fx.domain, permit);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([permit, byBob]), fx.ticketLock, "InvalidOwnerSignature");

      for (const wrongDomain of [
        { ...fx.domain, chainId: 84532 },
        { ...fx.domain, version: "1" },
        { ...fx.domain, verifyingContract: fx.bob.account.address },
      ]) {
        const wrong = await signTransfer(fx.alice, wrongDomain, permit);
        await viem.assertions.revertWithCustomError(
          fx.ticketLock.write.transferWithPermit([permit, wrong]), fx.ticketLock, "InvalidOwnerSignature");
      }
      // A check-in signature over the same fields is a different typed message.
      const asCheckIn = await signCheckIn(fx.alice, fx.domain, {
        eventId: permit.eventId, tokenId: permit.tokenId, owner: permit.from, gate: permit.to,
        ticketNonce: permit.ticketNonce, requestId: permit.requestId, issuedAt: permit.issuedAt, deadline: permit.deadline,
      });
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([permit, asCheckIn]), fx.ticketLock, "InvalidOwnerSignature");
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), fx.alice.account.address);
    });

    it("enforces the validity window", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const now = BigInt(await networkHelpers.time.latest());
      const send = async (overrides: { issuedAt?: bigint; deadline?: bigint }) => {
        const permit = await transferPermit(fx, fx.alice, fx.bob.account.address, overrides);
        return fx.ticketLock.write.transferWithPermit([permit, await signTransfer(fx.alice, fx.domain, permit)]);
      };
      await viem.assertions.revertWithCustomError(send({ deadline: now + 301n }), fx.ticketLock, "InvalidValidityWindow");
      await viem.assertions.revertWithCustomError(send({ deadline: now }), fx.ticketLock, "InvalidValidityWindow");
      await viem.assertions.revertWithCustomError(
        send({ issuedAt: now + 100n, deadline: now + 200n }), fx.ticketLock, "PermitNotYetValid");

      const permit = await transferPermit(fx, fx.alice, fx.bob.account.address);
      const signature = await signTransfer(fx.alice, fx.domain, permit);
      await networkHelpers.time.increase(301);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([permit, signature]), fx.ticketLock, "PermitExpired");
    });

    it("rejects wrong owner, wrong event and invalid recipients", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const send = async (signer: Wallet, to: Address, overrides: { eventId?: bigint } = {}) => {
        const permit = await transferPermit(fx, signer, to, overrides);
        return fx.ticketLock.write.transferWithPermit([permit, await signTransfer(signer, fx.domain, permit)]);
      };
      await viem.assertions.revertWithCustomError(send(fx.bob, fx.carol.account.address), fx.ticketLock, "NotTicketOwner");
      await viem.assertions.revertWithCustomError(
        send(fx.alice, fx.bob.account.address, { eventId: 2n }), fx.ticketLock, "WrongEvent");
      await viem.assertions.revertWithCustomError(send(fx.alice, zeroAddress), fx.ticketLock, "InvalidRecipient");
      await viem.assertions.revertWithCustomError(send(fx.alice, fx.alice.account.address), fx.ticketLock, "InvalidRecipient");
    });

    it("cannot replay a permit, including after the ticket returns to the signer", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const aToB = await transferPermit(fx, fx.alice, fx.bob.account.address);
      const aToBSig = await signTransfer(fx.alice, fx.domain, aToB);
      // A second permit signed while Alice still holds the ticket at nonce 0.
      const aToCarol = await transferPermit(fx, fx.alice, fx.carol.account.address);
      const aToCarolSig = await signTransfer(fx.alice, fx.domain, aToCarol);

      await fx.ticketLock.write.transferWithPermit([aToB, aToBSig]);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([aToB, aToBSig]), fx.ticketLock, "NotTicketOwner");

      const bToA = await transferPermit(fx, fx.bob, fx.alice.account.address);
      await fx.ticketLock.write.transferWithPermit([bToA, await signTransfer(fx.bob, fx.domain, bToA)]);
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), fx.alice.account.address);
      assert.equal(await fx.ticketLock.read.ticketNonce([1n]), 2n);

      // Alice owns it again and both old permits are still inside their deadline.
      for (const [permit, sig] of [[aToB, aToBSig], [aToCarol, aToCarolSig]] as const) {
        await viem.assertions.revertWithCustomErrorWithArgs(
          fx.ticketLock.write.transferWithPermit([permit, sig]), fx.ticketLock, "StaleNonce", [1n, 2n]);
      }
    });
  });

  describe("admission", () => {
    it("consumes the ticket once with owner and organiser signatures", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const permit = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const ownerSig = await signCheckIn(fx.alice, fx.domain, permit);
      const gateSig = await signCheckIn(fx.organiser, fx.domain, permit);
      const hash = await fx.ticketLock.write.checkIn([permit, ownerSig, gateSig], { account: fx.carol.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      const ticket = await fx.ticketLock.read.getTicket([1n]);
      assert.equal(ticket.used, true);
      assert.equal(ticket.checkedInAt, block.timestamp);
      assert.equal(ticket.nonce, 1n);
      sameAddress(ticket.owner, fx.alice.account.address);
      assert.equal((await fx.ticketLock.read.getEvent([1n])).checkedInCount, 1n);
      const events = await fx.ticketLock.getEvents.TicketCheckedIn();
      assert.equal(events.length, 1);
      assert.equal(events[0].args.requestId, permit.requestId);

      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([permit, ownerSig, gateSig]), fx.ticketLock, "TicketAlreadyUsed");
      assert.equal((await fx.ticketLock.read.getEvent([1n])).checkedInCount, 1n);
    });

    it("binds event and token IDs separately and accepts a check-in at its deadline", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await fx.ticketLock.write.issueTicket([1n, fx.bob.account.address, orderId("bob-2")]);
      const permit = await checkInPermit(fx, fx.bob, fx.organiser.account.address, { tokenId: 2n });
      const ownerSig = await signCheckIn(fx.bob, fx.domain, permit);
      const gateSig = await signCheckIn(fx.organiser, fx.domain, permit);
      await networkHelpers.time.setNextBlockTimestamp(permit.deadline);
      await fx.ticketLock.write.checkIn([permit, ownerSig, gateSig]);
      assert.equal((await fx.ticketLock.read.getTicket([2n])).used, true);
      assert.equal((await fx.ticketLock.read.getTicket([1n])).used, false);
    });

    it("does not let an organiser admit their own ticket with one signature", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await fx.ticketLock.write.issueTicket([1n, fx.organiser.account.address, orderId("organiser-own")]);
      const permit = await checkInPermit(fx, fx.organiser, fx.organiser.account.address, { tokenId: 2n });
      const signature = await signCheckIn(fx.organiser, fx.domain, permit);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([permit, signature, signature]), fx.ticketLock, "HolderIsGate");
    });

    it("needs the organiser: holder approval alone cannot consume", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const permit = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const ownerSig = await signCheckIn(fx.alice, fx.domain, permit);
      for (const fakeGateSig of [ownerSig, await signCheckIn(fx.bob, fx.domain, permit), "0x" as Hex]) {
        await viem.assertions.revertWithCustomError(
          fx.ticketLock.write.checkIn([permit, ownerSig, fakeGateSig]), fx.ticketLock, "InvalidGateSignature");
      }
      // The organiser alone cannot consume either.
      const gateSig = await signCheckIn(fx.organiser, fx.domain, permit);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([permit, gateSig, gateSig]), fx.ticketLock, "InvalidOwnerSignature");
      assert.equal((await fx.ticketLock.read.getTicket([1n])).used, false);
    });

    it("rejects a gate that is not this event's organiser", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      // Self-appointed gate.
      const selfGate = await checkInPermit(fx, fx.alice, fx.bob.account.address);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([
          selfGate, await signCheckIn(fx.alice, fx.domain, selfGate), await signCheckIn(fx.bob, fx.domain, selfGate)]),
        fx.ticketLock, "UnauthorisedGate");
      // The organiser of a different event.
      const otherGate = await checkInPermit(fx, fx.alice, fx.otherOrganiser.account.address);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([
          otherGate, await signCheckIn(fx.alice, fx.domain, otherGate),
          await signCheckIn(fx.otherOrganiser, fx.domain, otherGate)]),
        fx.ticketLock, "UnauthorisedGate");
      // Presenting the ticket under the other organiser's event.
      const wrongEvent = await checkInPermit(fx, fx.alice, fx.otherOrganiser.account.address, { eventId: 2n });
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([
          wrongEvent, await signCheckIn(fx.alice, fx.domain, wrongEvent),
          await signCheckIn(fx.otherOrganiser, fx.domain, wrongEvent)]),
        fx.ticketLock, "WrongEvent");
    });

    it("rejects an altered payload and signatures over different permits", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      await fx.ticketLock.write.issueTicket([1n, fx.alice.account.address, orderId("alice-2")]);
      const permit = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const ownerSig = await signCheckIn(fx.alice, fx.domain, permit);
      const gateSig = await signCheckIn(fx.organiser, fx.domain, permit);
      // Staff cannot retarget the holder's approval to another ticket or extend its deadline.
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([{ ...permit, tokenId: 2n }, ownerSig, gateSig]), fx.ticketLock, "InvalidOwnerSignature");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([{ ...permit, deadline: permit.deadline - 1n }, ownerSig, gateSig]),
        fx.ticketLock, "InvalidOwnerSignature");
      const other = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([permit, ownerSig, await signCheckIn(fx.organiser, fx.domain, other)]),
        fx.ticketLock, "InvalidGateSignature");
    });

    it("enforces the 120 second window", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const now = BigInt(await networkHelpers.time.latest());
      const tooLong = await checkInPermit(fx, fx.alice, fx.organiser.account.address, { deadline: now + 121n });
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([
          tooLong, await signCheckIn(fx.alice, fx.domain, tooLong), await signCheckIn(fx.organiser, fx.domain, tooLong)]),
        fx.ticketLock, "InvalidValidityWindow");

      const permit = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const ownerSig = await signCheckIn(fx.alice, fx.domain, permit);
      const gateSig = await signCheckIn(fx.organiser, fx.domain, permit);
      await networkHelpers.time.increase(121);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([permit, ownerSig, gateSig]), fx.ticketLock, "PermitExpired");
      assert.equal((await fx.ticketLock.read.getTicket([1n])).used, false);
    });
  });

  describe("state consistency", () => {
    it("a transfer executed first invalidates a pending admission", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const admission = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const ownerSig = await signCheckIn(fx.alice, fx.domain, admission);
      const gateSig = await signCheckIn(fx.organiser, fx.domain, admission);

      const aToB = await transferPermit(fx, fx.alice, fx.bob.account.address);
      await fx.ticketLock.write.transferWithPermit([aToB, await signTransfer(fx.alice, fx.domain, aToB)]);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([admission, ownerSig, gateSig]), fx.ticketLock, "NotTicketOwner");

      // Still stale once the ticket is back with the original signer.
      const bToA = await transferPermit(fx, fx.bob, fx.alice.account.address);
      await fx.ticketLock.write.transferWithPermit([bToA, await signTransfer(fx.bob, fx.domain, bToA)]);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.checkIn([admission, ownerSig, gateSig]), fx.ticketLock, "StaleNonce");
    });

    it("a check-in executed first blocks every transfer path", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const aToB = await transferPermit(fx, fx.alice, fx.bob.account.address);
      const aToBSig = await signTransfer(fx.alice, fx.domain, aToB);
      await fx.ticketLock.write.approve([fx.carol.account.address, 1n], { account: fx.alice.account });

      const admission = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      await fx.ticketLock.write.checkIn([
        admission, await signCheckIn(fx.alice, fx.domain, admission), await signCheckIn(fx.organiser, fx.domain, admission)]);

      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([aToB, aToBSig]), fx.ticketLock, "TicketAlreadyUsed");
      const alice = fx.alice.account.address;
      const bob = fx.bob.account.address;
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferFrom([alice, bob, 1n], { account: fx.alice.account }), fx.ticketLock, "TicketAlreadyUsed");
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.safeTransferFrom([alice, bob, 1n], { account: fx.alice.account }), fx.ticketLock, "TicketAlreadyUsed");
      // The operator approved before admission cannot move it either.
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferFrom([alice, bob, 1n], { account: fx.carol.account }), fx.ticketLock, "TicketAlreadyUsed");
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), alice);
    });

    it("lets at most one of two competing check-ins succeed", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const first = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      const second = await checkInPermit(fx, fx.alice, fx.organiser.account.address);
      assert.notEqual(first.requestId, second.requestId);
      const sign = async (p: typeof first) =>
        [p, await signCheckIn(fx.alice, fx.domain, p), await signCheckIn(fx.organiser, fx.domain, p)] as const;
      await fx.ticketLock.write.checkIn(await sign(second));
      await viem.assertions.revertWithCustomError(fx.ticketLock.write.checkIn(await sign(first)), fx.ticketLock, "TicketAlreadyUsed");
      assert.equal((await fx.ticketLock.read.getEvent([1n])).checkedInCount, 1n);
    });

    it("standard ERC-721 transfers keep their authorisation and bump the nonce once", async () => {
      const fx = await networkHelpers.loadFixture(deployFixture);
      const alice = fx.alice.account.address;
      const bob = fx.bob.account.address;
      const stalePermit = await transferPermit(fx, fx.alice, fx.carol.account.address);
      const staleSig = await signTransfer(fx.alice, fx.domain, stalePermit);

      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferFrom([alice, bob, 1n], { account: fx.bob.account }),
        fx.ticketLock, "ERC721InsufficientApproval");
      // Self-transfer still counts as a transfer.
      await fx.ticketLock.write.transferFrom([alice, alice, 1n], { account: fx.alice.account });
      assert.equal(await fx.ticketLock.read.ticketNonce([1n]), 1n);
      await viem.assertions.revertWithCustomError(
        fx.ticketLock.write.transferWithPermit([stalePermit, staleSig]), fx.ticketLock, "StaleNonce");

      await fx.ticketLock.write.safeTransferFrom([alice, bob, 1n], { account: fx.alice.account });
      assert.equal(await fx.ticketLock.read.ticketNonce([1n]), 2n);
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), bob);
      const held = await fx.ticketLock.read.ticketsOf([bob]);
      assert.deepEqual(held.map((t) => t.tokenId), [1n]);

      // An approved operator can move an unused ticket, and that also bumps the nonce once.
      await fx.ticketLock.write.approve([fx.carol.account.address, 1n], { account: fx.bob.account });
      await fx.ticketLock.write.transferFrom([bob, alice, 1n], { account: fx.carol.account });
      assert.equal(await fx.ticketLock.read.ticketNonce([1n]), 3n);
      sameAddress(await fx.ticketLock.read.ownerOf([1n]), alice);
    });
  });
});
