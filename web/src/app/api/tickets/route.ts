import { authed } from "@/server/http";
import { listTickets } from "@/server/services";

export const GET = authed((user) => listTickets(user));
