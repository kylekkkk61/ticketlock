import { requireUser, type SessionUser } from "./auth";
import { AppError } from "./errors";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function failure(error: unknown) {
  if (error instanceof AppError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error("[api] unexpected error", error);
  return json({ error: { code: "internal", message: "Something went wrong. Please try again." } }, 500);
}

/** Route handler for an authenticated request. */
export function authed<C>(fn: (user: SessionUser, request: Request, context: C) => Promise<unknown>) {
  return async (request: Request, context: C) => {
    try {
      return json(await fn(await requireUser(request), request, context));
    } catch (error) {
      return failure(error);
    }
  };
}

export async function readBody<T extends Record<string, unknown>>(request: Request): Promise<Partial<T>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Partial<T>;
  } catch {
    // fall through
  }
  throw new AppError(400, "bad_request", "The request body must be a JSON object.");
}
