"use client";

import { Button } from "@radix-ui/themes";
import { useTransition } from "react";
import { acceptHandoff } from "@/app/actions";
import { toast } from "./toast";

/** The other half of a handoff: someone on this side saying they have it. */
export function AcceptHandoff({
  handoffId,
  patientName,
}: {
  handoffId: string;
  patientName: string;
}) {
  const [pending, run] = useTransition();

  return (
    <Button
      type="button"
      size="1"
      variant="surface"
      color="gray"
      disabled={pending}
      onClick={() =>
        run(async () => {
          await acceptHandoff(handoffId);
          toast(`You have ${patientName}.`);
        })
      }
    >
      {pending ? "…" : "Pick up"}
    </Button>
  );
}
