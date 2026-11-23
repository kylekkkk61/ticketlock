import { authed } from "@/server/http";
import { organiserOverview } from "@/server/services";

export const GET = authed((user) => organiserOverview(user));
