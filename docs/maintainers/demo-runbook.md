# Demo runbook

For presenting or re-recording the demo. Everything shown is a real Base Sepolia transaction.

## Accounts

Three accounts exist: the organiser and two customers, called Alice and Bob in the video. Their
emails are in `.env` (`TICKETLOCK_ORGANISER`, `TICKETLOCK_ALICE`, `TICKETLOCK_BOB`). A recipient
must have signed in at least once before a ticket can be sent to their email.

| Role | Embedded wallet |
| --- | --- |
| Organiser | `0xb6aDA36D0F6088CE64669807aD7bA8Bf400316aa` |
| Alice | `0x1E8d90d369bfCd2c88C4aFaC3eEE83Cc2235Dba7` |
| Bob | `0x8e065797B29b54267D36c2fa0b9E92996d74D11a` |

## Before a live run

1. Open https://ticketlock.kylewu.me and confirm it responds. The app runs on the host and needs
   no start-up.
2. Laptop: sign in as the organiser and open **Manage event**. It shows the entry QR code.
3. Phone: sign in as a customer. Allow camera access when the entry screen first asks.
4. Buy one spare ticket in case a step needs repeating. The organiser account should not buy
   tickets: the contract does not let an organiser admit their own.

## Story

1. **Buy.** As Alice: *Simulate payment — £25*, wait for *Confirmed on testnet*, open *View my tickets*.
2. **Transfer.** *Transfer ticket*, enter Bob's email, check the recipient, *Confirm transfer*.
   Bob's *My tickets* now shows the ticket. Open *On-chain proof* once.
3. **Enter.** As Bob: *Enter event*, scan the QR code on the organiser's screen, *Confirm entry*.
   The phone shows a four-character code and *Waiting for staff*.
4. **Admit.** The same code appears under *Waiting at the door*. Press *Admit*. Both screens move
   to *Checking in* and then to *Used* with the recorded time.
5. **Second attempt.** Scan again as Bob: the app reports that the ticket has already been used.

If the camera is unavailable, use *Open entry link* on the scan screen and paste the address shown
under the QR code. Signing and the staff check are identical.

## Timing

An entry request is valid for 120 seconds and a transfer confirmation for 300 seconds. If staff do
not press *Admit* in time the request expires, the ticket stays available, and the customer
confirms again. Each action confirms in about two to four seconds.

## What to say about the proof

- The transaction sender on the explorer is the relayer, which pays the fee. The ticket's owner
  and the transfer's from and to addresses are the customers' own wallets.
- A signature alone changes nothing. The app reports success only after a successful receipt and
  a matching read of the contract.
- The verifier page and `pnpm verify-ticket <tokenId>` read the contract from a public RPC
  endpoint and do not use TicketLock's server.
- The demo transfers ownership. Listing, pricing rules and payment for resale are part of the
  proposed product and are not built.

## Rehearsal records

| Run | Ticket | Issued | Transferred | Checked in |
| --- | --- | --- | --- | --- |
| 22 Nov 2026, desktop browsers | 1 | [0xc8ebb0f3…](https://sepolia.basescan.org/tx/0xc8ebb0f364c38e50ef192d9be06b12c667cb7cd62c64f856646cdd52564f5d98) | [0x0965be5c…](https://sepolia.basescan.org/tx/0x0965be5cc6aa20477098a7ef5d5507bbd5e773c9b4e3d159fa283fa478338d13) | [0x3486e4c4…](https://sepolia.basescan.org/tx/0x3486e4c48ebf156ad5ec2f052c8e6570525304a54e295614e91c151a17435c11) |
| 22 Nov 2026, real phone with camera scan | 2 | [0x3bad0e67…](https://sepolia.basescan.org/tx/0x3bad0e6706ada19fd8a011c5d12ca09b0d769cf9ed6070cd624f85377b01bf31) | [0x2ef40278…](https://sepolia.basescan.org/tx/0x2ef4027828b491ae281bfab92aa0ab013f6f8dbd0292258c51ad3f76ce16ed09), then [back](https://sepolia.basescan.org/tx/0xa31ad2ee5e701b4a3dc88031080668f23f2cdd5a7da9852cbf603f7bd8443169) | [0xd8ad086e…](https://sepolia.basescan.org/tx/0xd8ad086e08b0898bdd4a564ccd86b846d93feb9aa9ec58894125fda24333733a) |
| 23 Nov 2026, scripted recording | 6 | [0x1b2cf692…](https://sepolia.basescan.org/tx/0x1b2cf69294759da2feb4649cfb54a8a8529230ab4a1325a68d619f8692cc7b79) | [0xfe1c5542…](https://sepolia.basescan.org/tx/0xfe1c554228bf17d3af94ba888795fbe190c01b896022221472391897a9b96116) | [0x9cbda4ed…](https://sepolia.basescan.org/tx/0x9cbda4edbe5a384f0e9a4d68575937c12587308c0045beac79d75873f71d96a8) |
