import { authed, readBody } from "@/server/http";
import { prepareTransfer } from "@/server/services";

export const POST = authed(async (user, request) => {
  const body = await readBody<{ tokenId: number; recipientEmail: string }>(request);
  return prepareTransfer(user, Number(body.tokenId), body.recipientEmail);
});
