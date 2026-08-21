import { corti } from "./corti";
import { rows } from "./graph";

/**
 * One agent, owned by name. Corti keeps agents per tenant, so this is the whole
 * of our lifecycle management: look for ours, make it if a fresh tenant has none.
 * Nothing here is per-user — the service account creates and calls it, which is
 * the reason this page works at all while the embedded assistant waits on a login.
 */
const AGENT_NAME = "careos-ward-assistant";

const SYSTEM_PROMPT = `You answer a ward clinician's questions about handoffs on the CareOS board.

Every question arrives with the current state of the board attached. Answer only
from that state. If the answer is not in it, say so plainly rather than guessing —
a confident invention about a patient is worse than an admitted gap.

Be brief. Name patients and clinicians as they are written. Where something is
overdue or unassigned, say so first.`;

async function findOrCreate() {
  const { data } = await corti().agentic.agents.list();
  const existing = data.find((agent) => agent.name === AGENT_NAME);
  if (existing) return existing.id;

  const created = await corti().agentic.agents.create({
    name: AGENT_NAME,
    description: "Answers questions about the CareOS handoff board.",
    systemPrompt: SYSTEM_PROMPT,
    visibility: "private",
    lifecycle: "persistent",
  });
  return created.id;
}

/**
 * The board as text. This is deliberately the whole small graph rather than a
 * retrieval step: the demo dataset is a few dozen rows, and a query planner that
 * picks the wrong three of them is a bug the agent cannot recover from.
 *
 * ponytail: send everything, add retrieval when the graph outgrows one prompt.
 */
export async function boardState() {
  const state = await rows<{
    patient: string;
    facts: string[];
    tasks: string[];
    handoffs: string[];
  }>(`
    MATCH (p:Patient)
    OPTIONAL MATCH (f:Fact)-[:SAID_IN]->(:Conversation)-[:ABOUT]->(p)
    OPTIONAL MATCH (t:Task)-[:FOR]->(p)
    OPTIONAL MATCH (t)-[:OWNED_BY]->(owner:Clinician)
    OPTIONAL MATCH (from:Clinician)-[:HANDED]->(h:Handoff)-[:ABOUT]->(p)
    OPTIONAL MATCH (h)-[:TO]->(to:Clinician)
    RETURN p.name AS patient,
           collect(DISTINCT f.group + ": " + f.text) AS facts,
           collect(DISTINCT t.title + " [" + t.status + ", due " + t.dueAt +
                            ", owner " + coalesce(owner.name, "nobody") + "]") AS tasks,
           collect(DISTINCT "from " + from.name + " to " + coalesce(to.name, "nobody") +
                            " at " + h.at) AS handoffs
    ORDER BY patient`);

  return state
    .map(({ patient, facts, tasks, handoffs }) =>
      [
        `## ${patient}`,
        facts.length ? `Facts:\n${facts.map((f) => `- ${f}`).join("\n")}` : "Facts: none recorded",
        tasks.length ? `Tasks:\n${tasks.map((t) => `- ${t}`).join("\n")}` : "Tasks: none",
        handoffs.length ? `Handoffs:\n${handoffs.map((h) => `- ${h}`).join("\n")}` : "Handoffs: none",
      ].join("\n"),
    )
    .join("\n\n");
}

// The SDK types this response as `unknown` — it is the A2A envelope, and this is
// the shape we read out of it. Verified against a live call.
type SendMessageResult = { task?: { artifacts?: { parts?: { text?: string }[] }[] } };

export async function askAgent(question: string) {
  const agentId = await findOrCreate();
  const { task } = (await corti().agentic.agents.sendMessage(agentId, {
    message: {
      messageId: `msg.${crypto.randomUUID()}`,
      role: "ROLE_USER",
      parts: [{ text: `Board state:\n\n${await boardState()}\n\nQuestion: ${question}` }],
    },
  })) as SendMessageResult;

  // A2A answers arrive as artifacts, each a bag of parts. Anything without text
  // is a tool call we did not ask for, so joining the text parts is the answer.
  const answer = task?.artifacts
    ?.flatMap((artifact) => artifact.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!answer) throw new Error("The agent came back with nothing to say.");
  return answer;
}
