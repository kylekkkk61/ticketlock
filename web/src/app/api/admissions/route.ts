import { authed, readBody } from "@/server/http";
import { submitAdmission } from "@/server/services";

export const POST = authed(async (user, request) => {
  const body = await readBody<{ permit: unknown; signature: string }>(request);
  return submitAdmission(user, body.permit, body.signature);
});
