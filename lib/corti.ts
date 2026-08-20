function cfg() {
  const {
    CORTI_TENANT_NAME: tenant,
    CORTI_CLIENT_ID: clientId,
    CORTI_CLIENT_SECRET: clientSecret,
    CORTI_ENVIRONMENT: environment,
  } = process.env;
  if (!tenant || !clientId || !clientSecret || !environment) {
    throw new Error("Missing CORTI_* env vars — see .env");
  }
  return { tenant, clientId, clientSecret, environment };
}

let cached: { token: Promise<string>; expiresAt: number } | null = null;

export function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const { tenant, clientId, clientSecret, environment } = cfg();
  const entry: { token: Promise<string>; expiresAt: number } = {
    expiresAt: Date.now() + 60_000,
    token: fetch(
      `https://auth.${environment}.corti.app/realms/${tenant}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "openid",
        }),
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Corti auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const { access_token, expires_in } = await res.json();
        entry.expiresAt = Date.now() + (expires_in - 30) * 1000;
        return access_token as string;
      })
      .catch((err) => {
        cached = null;
        throw err;
      }),
  };

  cached = entry;
  return entry.token;
}

export async function cortiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const { tenant, environment } = cfg();
  const res = await fetch(`https://api.${environment}.corti.app/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Tenant-Name": tenant,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Corti ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function browserCredentials() {
  const { tenant, environment } = cfg();
  return { token: await getToken(), tenantName: tenant, environment };
}
