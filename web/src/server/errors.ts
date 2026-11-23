import { BaseError, ContractFunctionRevertedError } from "viem";

/** An expected failure with a message that is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const REVERT_MESSAGES: Record<string, string> = {
  EventSoldOut: "This event is sold out.",
  OrderAlreadyIssued: "This order already has a ticket.",
  UnknownEvent: "This event does not exist on the contract.",
  TicketAlreadyUsed: "This ticket has already been used.",
  NotTicketOwner: "The ticket changed hands before this request was processed.",
  StaleNonce: "The ticket changed after this request was signed. Please start again.",
  WrongEvent: "This ticket belongs to a different event.",
  InvalidRecipient: "The recipient is not valid for this transfer.",
  UnauthorisedGate: "Only this event's organiser can admit tickets.",
  HolderIsGate: "The organiser cannot admit their own ticket.",
  PermitExpired: "The confirmation expired before it could be processed. Please confirm again.",
  PermitNotYetValid: "The confirmation is not valid yet. Please try again.",
  InvalidValidityWindow: "The confirmation has an invalid validity period.",
  InvalidOwnerSignature: "The ticket holder's signature is not valid for this request.",
  InvalidGateSignature: "The organiser's signature is not valid for this request.",
  ERC721InvalidReceiver: "The recipient account cannot receive tickets.",
};

/** Returns a user-facing reason when the error is a contract revert, otherwise null. */
export function describeRevert(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return null;
  const name = revert.data?.errorName;
  if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name];
  return "The contract rejected this request" + (name ? " (" + name + ")." : ".");
}
