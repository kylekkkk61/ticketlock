import { authed } from "@/server/http";
import { ticketHistory } from "@/server/services";

export const GET = authed<{ params: Promise<{ tokenId: string }> }>(async (_user, _request, context) =>
  ticketHistory(Number((await context.params).tokenId)),
);
