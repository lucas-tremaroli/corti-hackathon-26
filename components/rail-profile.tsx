import { ProfileSwitcher } from "@/components/profile-switcher";
import { activeClinician } from "@/lib/profile";
import { clinicians } from "@/lib/queries";

/** The signed-in account, for the foot of the rail on every screen. */
export async function RailProfile() {
  const [current, people] = await Promise.all([activeClinician(), clinicians()]);
  return current ? <ProfileSwitcher current={current} people={people} /> : null;
}
