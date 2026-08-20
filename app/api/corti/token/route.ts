import { browserCredentials } from "@/lib/corti";

// ponytail: unauthenticated token minter. Safe only because this runs on
// localhost; gate on a session the moment it is exposed to a network.
export async function GET() {
  return Response.json(await browserCredentials());
}
