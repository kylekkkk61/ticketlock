# Design and implementation decisions

Why the system is built the way it is, what each choice costs, and where the demo stops short of
a product. Written to support the design section of the pitch.

## Which kind of blockchain

**Choice: a public, permissionless blockchain. Specifically Base, an Ethereum layer 2, on its
Sepolia test network.**

| Option | Why not, or why |
| --- | --- |
| Private or consortium chain | The value of TicketLock is that a buyer, a venue or a rival platform can check a ticket without trusting us. A chain we operate would bring that trust requirement back. |
| Ethereum main network directly | Secure and neutral, but fees of dollars per action are too high for a ticket. |
| A public layer 2 (chosen) | Inherits Ethereum's security, costs a small fraction per action, and confirms in about two seconds. Base uses the same tools and standards as Ethereum, so nothing is locked in. |

The demo runs on the test network because it is free and safe to experiment on. Moving to the
main network would mean publishing the same contract there and funding the relayer with real ETH.

## Which crypto assets

- **The ticket is an NFT** (standard ERC-721). One ticket, one recorded owner.
- **ETH is used only for network fees**, and only by the platform's relayer. Customers and
  organisers hold none.
- **There is no TicketLock token** and no cryptocurrency payment. The checkout in the demo is
  simulated; a product would take card payments as usual and issue the ticket afterwards.

## Making it feel like an ordinary ticketing site

The usual obstacles for newcomers are installing a wallet, safeguarding a recovery phrase and
buying cryptocurrency for fees. Each was removed:

| Obstacle | What we did |
| --- | --- |
| Installing a wallet | Email sign-in. Privy creates an embedded wallet for the account. |
| Approving in a wallet pop-up | The user presses TicketLock's own confirm button; the embedded wallet signs. |
| Paying network fees | Users only sign. The relayer delivers the transaction and pays. |
| Reading addresses and hashes | Hidden by default, available in an *On-chain proof* panel. |

This pattern is often called gasless or sponsored transactions. We implemented it directly in the
contract (signed permits checked on-chain) and did not use heavier account-abstraction infrastructure, which
keeps the moving parts few and the contract easy to explain.

## The smart contract

One contract, not upgradeable, built on OpenZeppelin's audited components. See
[smart-contract.md](smart-contract.md) for every function. The decisions that shaped it:

- **One contract for all events.** Simpler to verify and to explain than a factory that
  publishes a contract per event. A factory is a reasonable later step if events need separate
  collections or administration.
- **Signatures authorise, the relayer delivers.** The contract trusts the signature, never the
  sender of the transaction.
- **A counter on every ticket.** Any transfer or entry raises it, which cancels all earlier
  signatures in one stroke.
- **Used tickets are kept, not destroyed.** They remain as a record and as a keepsake, and are
  frozen.
- **Two signatures for entry.** The holder and the organiser, over the same permit, in one
  transaction.
- **History that any RPC can read.** Public RPC services limit how far back a search may look
  (200 blocks on Base's public endpoint, 10 on Alchemy's free tier, measured). The contract
  therefore records which blocks touched each ticket, so its history is fetched directly.

## Other technologies

| Part | Technology | Role |
| --- | --- | --- |
| Web app | Next.js, React, TypeScript, Tailwind CSS | Customer and organiser screens |
| Sign-in and wallets | Privy | Email codes, embedded wallets, signing |
| Blockchain access | viem, Alchemy | Reading the contract, sending transactions |
| Server data | SQLite | Account links, orders, entry requests, the transaction queue |
| Contract tooling | Solidity, Hardhat, OpenZeppelin | Writing, testing, publishing and verifying the contract |
| Hosting | Microsoft Azure VM, Cloudflare Tunnel | Always-on server with HTTPS on our domain |
| Door code | QR code in the browser | The customer's camera reads the organiser's code |

**Artificial intelligence.** The product itself does not use AI. AI coding tools were used
heavily to build it, which the team should disclose as the assignment requires. If the pitch
wants an AI angle, plausible directions are spotting bot-like buying patterns or forecasting
demand, but none of that is built and it should be presented as a proposal.

## What is still centralised

Being precise here makes the pitch more credible.

| Component | What it controls | What it cannot do |
| --- | --- | --- |
| The platform's issuer and relayer | When tickets are issued; whether signed requests get delivered | Move or use a ticket without the right signatures; alter history |
| Privy | Safekeeping of users' wallet keys; sign-in | Change the contract's rules |
| Our server and database | Convenience: who has which email, requests in progress | Change ownership or use state |
| The organiser | Who is admitted | Use a ticket without its holder's signature |

A signed permit can be delivered by anyone, not only our relayer, so a holder is not strictly
dependent on our server to act.

## What the demo does not include

- **Resale as a sale.** The demo transfers ownership. Listing, pricing and payment between buyer
  and seller are not built.
- **Price caps.** Nothing limits what two people agree privately. Enforcing a cap would need the
  payment to pass through the system.
- **Real payments and refunds.**
- **Proof that a person is physically at the door.** The staff check is a human step.
- **Scale and production security.** One server, one event, a test network, and no external audit.

## Measured performance

From the rehearsals on Base Sepolia: issuing confirmed in about 2.3 seconds, a transfer in about
3.0 and an admission in about 3.9, measured from the button press to the confirmed result on
screen. Fees per action are in [smart-contract.md](smart-contract.md#what-it-costs-to-run).
