"use client";

import { SegmentedControl } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import { ROLES, type Role } from "@/lib/sop";

// No accounts in the demo, so the role is a URL parameter and this switches it.
export function RoleSwitcher({ role }: { role: Role }) {
  const router = useRouter();

  return (
    <SegmentedControl.Root
      size="1"
      value={role}
      onValueChange={(next) => router.push(`/inbox?role=${next}`)}
    >
      {Object.entries(ROLES).map(([value, { short }]) => (
        <SegmentedControl.Item key={value} value={value}>
          {short}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl.Root>
  );
}
