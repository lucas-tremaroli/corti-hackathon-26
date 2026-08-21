"use client";

import { Button } from "@radix-ui/themes";
import { useTransition } from "react";
import { ingestDemoDischarge } from "@/app/actions";
import { toast } from "./toast";

export function Ingest() {
  const [pending, run] = useTransition();

  return (
    <Button
      type="button"
      size="2"
      variant="surface"
      color="gray"
      disabled={pending}
      onClick={() =>
        run(async () => {
          await ingestDemoDischarge().catch((error: Error) => toast(error.message, "error"));
        })
      }
    >
      {pending ? "Reading the conversation…" : "Take the discharge conversation"}
    </Button>
  );
}
