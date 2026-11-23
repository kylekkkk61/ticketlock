import { eventSummary } from "@/server/services";

// Public chain data: capacity and counts for the seeded event.
export async function GET() {
  try {
    return Response.json(await eventSummary(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[api] event read failed", error);
    return Response.json({ error: { code: "chain_unavailable", message: "The network is not responding." } }, { status: 503 });
  }
}
