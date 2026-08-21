import { cookies } from "next/headers";
import { clinicians } from "./queries";

export const PROFILE_COOKIE = "careos.clinician";

/**
 * Who you are signed in as. A cookie rather than a URL parameter, so switching
 * follows you across every screen instead of being something you carry in a link.
 *
 * Falls back to cardiology: the demo opens on the sending side of the handoff.
 */
export async function activeClinician() {
  const [people, jar] = await Promise.all([clinicians(), cookies()]);
  const id = jar.get(PROFILE_COOKIE)?.value;
  return (
    people.find((p) => p.id === id) ?? people.find((p) => p.role === "Cardiology") ?? people[0] ?? null
  );
}
