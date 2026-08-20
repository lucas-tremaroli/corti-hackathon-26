// The components never see the client secret: they call this whenever their
// token is missing or expired, and our route mints a fresh 300s one.
export async function refreshAccessToken() {
  const { token, expiresIn } = await fetch("/api/corti/token").then((r) => r.json());
  return { accessToken: token, expiresIn };
}
