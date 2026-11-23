import { authed } from "@/server/http";
import { getJobForUser } from "@/server/services";

export const GET = authed<{ params: Promise<{ id: string }> }>(async (user, _request, context) =>
  getJobForUser(user, Number((await context.params).id)),
);
