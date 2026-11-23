import { authed } from "@/server/http";
import { getOrder } from "@/server/services";

export const GET = authed<{ params: Promise<{ id: string }> }>(async (user, _request, context) =>
  getOrder(user, (await context.params).id),
);
