import { authed, readBody } from "@/server/http";
import { submitTransfer } from "@/server/services";

export const POST = authed(async (user, request) => {
  const body = await readBody<{ permit: unknown; signature: string }>(request);
  return submitTransfer(user, body.permit, body.signature);
});
