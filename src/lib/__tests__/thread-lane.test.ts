import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Thread continuity is the rule that keeps a candidate's phone showing ONE conversation.
 *
 * Answer a blue thread over SMS and iOS files the reply as a separate green thread from the
 * same recruiter. That is confusing for a human and reads as automation, and unlike almost
 * every other mistake in this system it cannot be undone once delivered. So a reply follows
 * the wire the thread is already on, never the campaign's current channel setting.
 */

let rows: { provider: string }[] = [];
const orderByCalls: unknown[][] = [];

// Minimal drizzle query-builder stand-in. The chain in threadLane is
// select(...).from(...).where(...).orderBy(...).limit(...) and awaits an array.
vi.mock("@/db/client", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: (...args: unknown[]) => {
      orderByCalls.push(args);
      return chain;
    },
    limit: () => Promise.resolve(rows.slice(0, 1)),
  };
  return { db: { select: () => chain } };
});

import { threadLane } from "../lane";

afterEach(() => {
  rows = [];
  orderByCalls.length = 0;
});

describe("threadLane", () => {
  it("keeps a blue thread blue", async () => {
    rows = [{ provider: "imessage" }];
    await expect(threadLane("c1")).resolves.toBe("imessage");
  });

  it("keeps a green thread green", async () => {
    rows = [{ provider: "telnyx" }];
    await expect(threadLane("c1")).resolves.toBe("telnyx");
  });

  it("falls back to Telnyx for a thread with no messages at all", async () => {
    rows = [];
    await expect(threadLane("c1")).resolves.toBe("telnyx");
  });

  it("orders the lookup rather than taking an arbitrary row", async () => {
    // WHICH outbound wins matters: a contact reached on iMessage and later followed up on
    // SMS is a green thread now, so the lane must come from the LATEST outbound. Recency is
    // enforced by the SQL `ORDER BY created_at DESC`, which a stubbed query builder cannot
    // evaluate - so this asserts the ordering step is present at all. Deleting the ORDER BY
    // (leaving Postgres free to return any row) fails here instead of silently splitting
    // threads in production.
    rows = [{ provider: "imessage" }];
    await threadLane("c1");
    expect(orderByCalls.length).toBeGreaterThan(0);
    expect(orderByCalls[0].length).toBeGreaterThan(0);
  });
});
