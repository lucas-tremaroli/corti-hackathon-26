"use client";

import { DropdownMenu, Text } from "@radix-ui/themes";
import { useTransition } from "react";
import { switchProfile } from "@/app/actions";
import type { Clinician } from "@/lib/model";
import styles from "./profile-switcher.module.css";

// "Dr Michael Chen" reads as MC. Skips the title, which every one of them shares
// and which would make both avatars say D.
function initials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/);
  return `${parts.at(0)?.[0] ?? ""}${parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : ""}`;
}

/** Who you are signed in as, and the only way to become someone else. */
export function ProfileSwitcher({
  current,
  people,
}: {
  current: Clinician;
  people: Clinician[];
}) {
  const [pending, run] = useTransition();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={pending}>
        <button type="button" className={styles.trigger} aria-label={`Signed in as ${current.name}`}>
          <span className={styles.avatar} aria-hidden>
            {initials(current.name)}
          </span>
          <span className={styles.who}>
            <Text size="2" className={styles.name}>
              {current.name}
            </Text>
            <Text size="1" className={styles.org}>
              {current.org}
            </Text>
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content size="1" side="top" align="start">
        <DropdownMenu.RadioGroup
          value={current.id}
          onValueChange={(id) => run(async () => switchProfile(id))}
        >
          {people.map((person) => (
            <DropdownMenu.RadioItem key={person.id} value={person.id}>
              {person.name} · {person.org}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
