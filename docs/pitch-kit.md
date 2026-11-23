# Pitch kit: the technical story, ready for slides

Material for whoever builds the deck and presents the design and implementation part. Everything
here is backed by the working demo. Take wording and figures freely.

## The technical story in three sentences

TicketLock issues each ticket as an NFT on a public blockchain, so who owns it and whether it has
been used can be checked by anyone and cannot be quietly changed by us or by a seller. Customers
sign in with email, never see a wallet and never pay a network fee, because the platform delivers
their signed requests for them. A ticket is admitted only when its holder and the venue both
approve, and it can be used exactly once.

## Slide-ready points

**Design choices**

- Public blockchain (Base, an Ethereum layer 2): verifiable by outsiders, low fees, about two seconds to confirm.
- Ticket = NFT (ERC-721). No TicketLock token, no crypto payments.
- One smart contract holds the events, the tickets and the rules.

**What makes it usable**

- Email sign-in with an automatically created wallet (Privy).
- The platform pays all network fees ("gasless" for users).
- The only extra step compared with a normal site is pressing confirm.

**What makes it trustworthy**

- A ticket moves only with its owner's digital signature.
- Entry needs two signatures, holder and organiser, in one transaction.
- Used once: the contract refuses a second entry and refuses to move a used ticket.
- Anyone can verify a ticket without asking TicketLock.

## Numbers you can quote

| Figure | Value | Source |
| --- | --- | --- |
| Time to issue a ticket | about 2.3 s | Rehearsal on Base Sepolia |
| Time to transfer | about 3.0 s | Rehearsal on Base Sepolia |
| Time to admit | about 3.9 s | Rehearsal on Base Sepolia |
| Network fee to issue | 0.0000015 ETH | Transaction receipt |
| Network fee to transfer | 0.0000006 ETH | Transaction receipt |
| Network fee to check in | 0.0000004 ETH | Transaction receipt |
| Contract size | about 380 lines of Solidity | Source |
| Automated contract tests | 24 | Test suite |
| Tickets issued and admitted in rehearsals | see the live count on the organiser dashboard | Contract |

Say "on the test network" when quoting fees. Main-network fees vary and we have not measured them.

## Images and where to use them

All diagrams are 16:9, black and white, at 3840×2160. SVG versions sit beside the PNGs.

| File | Use it for |
| --- | --- |
| [`diagrams/architecture.png`](diagrams/architecture.png) | The system architecture slide |
| [`diagrams/user-journey.png`](diagrams/user-journey.png) | Product walkthrough: buy, transfer, enter |
| [`diagrams/admission.png`](diagrams/admission.png) | The two-signature entry, our most distinctive mechanism |
| [`diagrams/contract-map.png`](diagrams/contract-map.png) | Smart contract logic |
| [`diagrams/ticket-lifecycle.png`](diagrams/ticket-lifecycle.png) | States of a ticket, with a real example and real fees |
| [`diagrams/data-split.png`](diagrams/data-split.png) | Privacy and what is on-chain versus off-chain |
| [`../brand/`](../brand) | Logo, wordmark, app icon and social card, in SVG and PNG |

The recorded demo video (about 85 seconds, with a separate 16-second sign-in clip) is kept by
Kyle and is not in this repository.

## Claims we can make, and claims to avoid

| Safe to say | Avoid saying |
| --- | --- |
| "A working demo on a public test network, with real transactions." | "Live on mainnet" or "in production". |
| "Ownership and use are publicly verifiable." | "Fraud is impossible." People can still be deceived outside the system. |
| "A ticket transfers only with the owner's signature." | "We enforce a resale price cap." Not built; private side payments are outside any contract's reach. |
| "The demo shows the ownership transfer that resale needs." | "The demo includes a resale marketplace." It does not. |
| "Users need no wallet app and pay no fees." | "Fully decentralised." The platform, Privy and our server still matter. |
| "Entry requires holder and organiser approval." | "We prove the person is physically present." The staff check is human. |
| "The product does not use AI; AI tools helped build it." | Any claim of an AI feature. |

## Questions you may be asked

**Why a blockchain and not a normal database?**
A database is controlled by whoever runs it, so outsiders must take its word. A public
blockchain lets a buyer, a venue or another platform check a ticket themselves, and stops anyone,
us included, from rewriting who owns it or whether it was used.

**Who pays the network fees?**
The platform. Each action costs a tiny amount on the test network. In a product this would be
part of the service fee charged to organisers.

**What if the relayer or your server goes down?**
Tickets and their status stay on the blockchain and remain readable. New purchases and relayed
actions pause. A signed request could also be delivered by another party.

**Can the platform steal or move a ticket?**
No. Moving a ticket needs the owner's signature and using one also needs the organiser's. The
platform can issue tickets, and can decline to deliver a request, which is where trust remains.

**The door QR code is fixed. Can't it be copied?**
Yes, and it does not matter. The code only names the event. Entry needs the holder's signature
and then the organiser's approval of that specific request.

**What stops a ticket being sold twice?**
There is exactly one owner on record. Once a transfer goes through, the old owner's signatures
no longer work.

**Where are users' keys?**
With Privy, a specialist provider, tied to the user's email sign-in. We never see them.

**Is personal data on the blockchain?**
No. Only wallet addresses and ticket facts. Emails stay in private systems.

**What would it take to go live?**
Publishing the contract on Base main network, real payments, the resale marketplace, an external
security audit, and production hosting.
