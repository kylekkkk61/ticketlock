import { AppError } from "@/server/errors";
import { authed, readBody } from "@/server/http";
import { approveAdmission, rejectAdmission } from "@/server/services";

export const POST = authed<{ params: Promise<{ id: string }> }>(async (user, request, context) => {
  const { id } = await context.params;
  const body = await readBody<{ action: string; signature: string }>(request);
  if (body.action === "approve") return approveAdmission(user, id, body.signature);
  if (body.action === "reject") return rejectAdmission(user, id);
  throw new AppError(400, "bad_request", "Unknown action.");
});
