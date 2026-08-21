import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exchangeCode } from "@/lib/corti";
import { callbackUrl } from "../login/route";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const error = params.get("error");
  if (error) {
    return Response.json(
      { error: `${error}: ${params.get("error_description") ?? "no detail"}` },
      { status: 401 },
    );
  }

  const jar = await cookies();
  const verifier = jar.get("corti_verifier")?.value;
  const state = jar.get("corti_state")?.value;
  const code = params.get("code");

  // An unsolicited code, or one that came back under a state we never issued, is
  // somebody else's login attempt being replayed through this browser.
  if (!code || !verifier || params.get("state") !== state) {
    return Response.json({ error: "Login did not come from us — start again at /chat" }, { status: 400 });
  }

  const token = await exchangeCode(code, callbackUrl(request), verifier);
  jar.delete("corti_verifier");
  jar.delete("corti_state");

  // Only the refresh token is kept. The access token expires in five minutes and
  // is minted on demand, so there is nothing long-lived worth stealing here.
  jar.set("corti_refresh", token.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: token.refresh_expires_in ?? 60 * 60 * 24,
  });

  redirect("/chat");
}
