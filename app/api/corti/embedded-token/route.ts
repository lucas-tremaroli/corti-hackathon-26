import { cookies } from "next/headers";
import { refreshUserToken } from "@/lib/corti";

// ponytail: same localhost-only caveat as the sibling token route. The cookie is
// httpOnly, so this endpoint is the only way back to a token — put it behind a
// session before this leaves a laptop.
export async function GET() {
  const refresh = (await cookies()).get("corti_refresh")?.value;
  // 401 is the signal the page watches for to send the practitioner to log in.
  if (!refresh) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    return Response.json(await refreshUserToken(refresh));
  } catch (error) {
    // A refresh token dies with the session behind it, and the only cure is a
    // fresh login — so clear it rather than leaving a dead cookie in the way.
    (await cookies()).delete("corti_refresh");
    return Response.json({ error: String(error) }, { status: 401 });
  }
}
