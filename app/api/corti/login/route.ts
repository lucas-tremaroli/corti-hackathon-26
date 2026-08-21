import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeUrl } from "@/lib/corti";

// Keycloak matches this string exactly against the client's registered redirect
// URIs, so it has to be built the same way here and at the exchange.
export const callbackUrl = (request: Request) =>
  new URL("/api/corti/callback", request.url).toString();

export async function GET(request: Request) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");

  // The verifier proves at the exchange that we are the same party that started
  // the login, so it has to survive the round trip without reaching the browser.
  const jar = await cookies();
  const options = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 } as const;
  jar.set("corti_verifier", verifier, options);
  jar.set("corti_state", state, options);

  redirect(authorizeUrl(callbackUrl(request), verifier, state));
}
