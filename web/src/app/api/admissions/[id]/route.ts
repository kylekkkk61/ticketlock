import { authed } from "@/server/http";
import { getAdmission } from "@/server/services";

export const GET = authed<{ params: Promise<{ id: string }> }>(async (user, _request, context) =>
  getAdmission(user, (await context.params).id),
);
