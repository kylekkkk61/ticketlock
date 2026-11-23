import { authed, readBody } from "@/server/http";
import { prepareAdmission } from "@/server/services";

export const POST = authed(async (user, request) => {
  const body = await readBody<{ eventId: number; tokenId: number }>(request);
  return prepareAdmission(user, Number(body.eventId), Number(body.tokenId));
});
