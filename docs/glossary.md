# Glossary

Plain meanings for the terms used in this project.

| Term | Meaning here |
| --- | --- |
| Blockchain | A record kept in identical copies by many independent computers. Entries are added by agreement and cannot be altered afterwards. |
| Base | A public blockchain built on top of Ethereum that is faster and cheaper to use. Called a "layer 2". |
| Base Sepolia | The free practice version of Base. It behaves the same way, and its currency has no value. This demo runs on it. |
| Testnet | Any practice blockchain such as Base Sepolia. The real one is called mainnet. |
| Smart contract | A program stored on a blockchain. It runs exactly as written and its rules cannot be changed after it is published. |
| NFT | A unique item recorded on a blockchain with exactly one owner. Each TicketLock ticket is one. |
| ERC-721 | The common technical standard for NFTs, so that wallets and explorers know how to read them. |
| Token ID | The serial number of an NFT. "Ticket 6" is token ID 6. |
| Wallet | A secret key that lets its holder sign messages and own blockchain items. It is closer to a signature stamp than to a purse. |
| Embedded wallet | A wallet created and kept inside an app on the user's behalf, so they never install or manage one. |
| Address | The public code that identifies a wallet, for example `0x8e06…D11a`. Safe to share. |
| Signature | Proof that a particular wallet approved a particular message. Anyone can check it; nobody can fake it. |
| Permit | Our word for a signed request: "transfer this ticket to that account" or "admit this ticket", with an expiry time. |
| Transaction | A request delivered to the blockchain that changes something. It costs a fee and gets a public reference number. |
| Transaction hash | That reference number. It can be looked up in a block explorer. |
| Gas | The fee paid to the network for a transaction. |
| Relayer | Our server account that delivers users' signed requests as transactions and pays the gas. It cannot change what users signed. |
| Issuer | The one account the contract allows to create events and tickets. In this demo it is the relayer. |
| Organiser | The account named in the contract as an event's gatekeeper. Only it can co-sign admissions for that event. |
| Counter (nonce) | A number on each ticket that goes up whenever the ticket moves or is used. A signature is tied to one value, so older signatures stop working. |
| On-chain / off-chain | Stored on the blockchain, or stored in ordinary private systems. |
| Block explorer | A public website for browsing a blockchain, such as Basescan. |
| RPC | The connection a program uses to read from or send to a blockchain. |
| Privy | The company whose service handles our email sign-in and embedded wallets. |
| OpenZeppelin | A widely used, audited library of smart contract building blocks. Our contract is built on it. |
