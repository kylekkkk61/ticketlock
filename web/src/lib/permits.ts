import type { Address, Hex } from "viem";

// EIP-712 definitions shared by the browser (signing) and the server (verification).
// Field order and types must match TicketLockDemo.sol exactly.

export const TRANSFER_PERMIT_TYPES = {
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

export const CHECK_IN_PERMIT_TYPES = {
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

export const TRANSFER_VALIDITY_SECONDS = 300;
export const CHECK_IN_VALIDITY_SECONDS = 120;

// Integers travel as decimal strings so the payload survives JSON unchanged.
export type TransferPermitJson = {
  eventId: string;
  tokenId: string;
  from: Address;
  to: Address;
  ticketNonce: string;
  requestId: Hex;
  issuedAt: string;
  deadline: string;
};

export type CheckInPermitJson = {
  eventId: string;
  tokenId: string;
  owner: Address;
  gate: Address;
  ticketNonce: string;
  requestId: Hex;
  issuedAt: string;
  deadline: string;
};

export type PermitDomain = {
  name: "TicketLock Demo";
  version: "2";
  chainId: number;
  verifyingContract: Address;
};

export const permitDomain = (chainId: number, contract: Address): PermitDomain => ({
  name: "TicketLock Demo",
  version: "2",
  chainId,
  verifyingContract: contract,
});

export const transferPermitMessage = (p: TransferPermitJson) => ({
  eventId: BigInt(p.eventId),
  tokenId: BigInt(p.tokenId),
  from: p.from,
  to: p.to,
  ticketNonce: BigInt(p.ticketNonce),
  requestId: p.requestId,
  issuedAt: BigInt(p.issuedAt),
  deadline: BigInt(p.deadline),
});

export const checkInPermitMessage = (p: CheckInPermitJson) => ({
  eventId: BigInt(p.eventId),
  tokenId: BigInt(p.tokenId),
  owner: p.owner,
  gate: p.gate,
  ticketNonce: BigInt(p.ticketNonce),
  requestId: p.requestId,
  issuedAt: BigInt(p.issuedAt),
  deadline: BigInt(p.deadline),
});

export type TransferTypedData = {
  domain: PermitDomain;
  types: typeof TRANSFER_PERMIT_TYPES;
  primaryType: "TransferPermit";
  message: TransferPermitJson;
};

export type CheckInTypedData = {
  domain: PermitDomain;
  types: typeof CHECK_IN_PERMIT_TYPES;
  primaryType: "CheckInPermit";
  message: CheckInPermitJson;
};
