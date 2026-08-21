"use client";

import { CortiEmbeddedReact, type CortiEmbeddedReactRef } from "@corti/embedded-web/react";
import { Code, Heading, Text } from "@radix-ui/themes";
import { useCallback, useRef, useState } from "react";

// ponytail: throwaway spike. The one thing it answers is whether the embedded
// assistant accepts the client-credentials token we already mint, or insists on
// a user OIDC login as its README says. Delete this file either way — if it
// authenticates, the real tab is built on top; if it 401s, we know why.
//
// The package registers a custom element on import, so it has to reach the
// browser and only the browser — /chat pulls it in with ssr: false.
export function EmbeddedSpike() {
  const ref = useRef<CortiEmbeddedReactRef>(null);
  const [log, setLog] = useState<string[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const say = (line: string) => setLog((prior) => [...prior, line]);

  const onReady = useCallback(async () => {
    const embedded = ref.current;
    if (!embedded) return;
    try {
      const response = await fetch("/api/corti/embedded-token");
      // Nobody signed in yet. A link rather than an automatic bounce: being
      // thrown at a login screen you did not ask for is how you lose your place.
      if (response.status === 401) {
        setSignedOut(true);
        return;
      }
      const credentials = await response.json();
      say(`user token minted, ${credentials.expires_in}s`);
      const user = await embedded.auth(credentials);
      say(`auth OK: ${JSON.stringify(user)}`);
      await embedded.configureApp({ ui: { aiChat: true, navigation: false } });
      // If auth held, this is the bridge the real tab uses: our graph facts are
      // already {text, group}, which is exactly what addFacts takes.
      await embedded.addFacts([{ text: "Spike fact — patient on apixaban", group: "medication" }]);
      say("facts pushed");
      await embedded.show();
    } catch (error) {
      say(`FAILED: ${error}`);
    }
  }, []);

  return (
    <div style={{ padding: 24, display: "grid", gap: 12 }}>
      <Heading size="4">Embedded assistant spike</Heading>
      {log.map((line, i) => (
        // biome-ignore lint: a log is append-only, the index is the identity
        <Code key={i} size="1">
          {line}
        </Code>
      ))}
      {signedOut && (
        <Text size="2">
          <a href="/api/corti/login">Sign in to Corti</a> — the assistant needs a person, not our
          service account.
        </Text>
      )}
      {log.length === 0 && !signedOut && (
        <Text size="1" color="gray">
          waiting for onReady…
        </Text>
      )}
      <CortiEmbeddedReact
        ref={ref}
        baseURL="https://assistant.eu.corti.app"
        onReady={onReady}
        onError={(e) => say(`error event: ${e.detail.message}`)}
        onEvent={(e) => say(`${e.detail.name}: ${JSON.stringify(e.detail.payload).slice(0, 200)}`)}
        style={{ width: "100%", height: 600 }}
      />
    </div>
  );
}
