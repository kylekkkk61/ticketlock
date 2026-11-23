import { authed } from "@/server/http";
import { describeUser } from "@/server/services";

export const POST = authed((user) => describeUser(user));
