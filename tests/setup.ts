// Shared test setup: jest-dom matchers, and unmounting Testing Library trees between tests
// (Vitest does not expose globals, so Testing Library cannot register its own cleanup).
// Component tests also import the helpers below from here: an axe-core check, a fetch stub
// and a ticket fixture.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import type { PrivateTicket } from "@/lib/types";

afterEach(() => cleanup());

/**
 * Runs axe-core on a rendered element and fails with a readable list when it
 * finds WCAG 2.x A or AA violations. Colour contrast is left to manual and
 * browser checks: jsdom does no layout or painting, so axe cannot measure it.
 */
export async function expectNoAxeViolations(element: Element) {
  // Loaded on first use, so the Node-only server tests never pay for it.
  const { default: axe } = await import("axe-core");
  const results = await axe.run(element, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  const violations = results.violations.map(
    (violation) => `${violation.id}: ${violation.help}\n  ${violation.nodes.map((node) => node.html).join("\n  ")}`,
  );
  expect(violations, violations.join("\n")).toEqual([]);
}

/** A JSON response, as the API sends it. */
export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/**
 * Replaces `fetch` with a mock that answers each call with the next reply (the
 * last one repeats); an Error reply rejects, like a network failure. Undo with
 * `vi.unstubAllGlobals()`.
 */
export function stubFetch(...replies: (Response | Error)[]) {
  const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => {
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (!reply || reply instanceof Error) throw reply ?? new Error("no reply");
    return reply.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the `index`th fetch call. */
export const sentJson = (fetchMock: ReturnType<typeof stubFetch>, index = 0) =>
  JSON.parse(String(fetchMock.mock.calls[index][1]?.body));

/** A complete ticket as the API returns it to its citizen or to staff, with any fields overridden. */
export function makeTicket(overrides: Partial<PrivateTicket> = {}): PrivateTicket {
  return {
    id: "CR-1001",
    title: "Pothole near the bus stand",
    description: "Big pothole",
    originalLanguage: "en",
    englishSummary: "A large pothole near Katpadi bus stand.",
    category: "Pothole",
    priority: "High",
    priorityReason: "Busy road",
    department: "Public Works (Roads)",
    status: "Reported",
    location: { lat: 12.97, lng: 79.13, address: "Katpadi bus stand" },
    reporterCount: 1,
    createdAt: "2026-11-01T06:00:00.000Z",
    updatedAt: "2026-11-01T06:00:00.000Z",
    resolvedAt: null,
    adminNotes: [],
    hasImage: false,
    history: [],
    messageCount: 0,
    slaDueAt: "2026-11-04T06:00:00.000Z",
    overdue: false,
    messages: [],
    ...overrides,
  };
}
