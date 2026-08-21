"use client";

import dynamic from "next/dynamic";

const EmbeddedSpike = dynamic(
  () => import("@/components/embedded-spike").then((m) => m.EmbeddedSpike),
  { ssr: false },
);

export default function ChatSpikePage() {
  return <EmbeddedSpike />;
}
