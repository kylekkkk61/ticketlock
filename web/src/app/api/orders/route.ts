import { authed, readBody } from "@/server/http";
import { createOrder } from "@/server/services";

export const POST = authed(async (user, request) => {
  const body = await readBody<{ checkoutKey: string }>(request);
  return createOrder(user, body.checkoutKey);
});
