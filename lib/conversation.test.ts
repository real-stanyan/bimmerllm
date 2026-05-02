import { describe, expect, it } from "vitest";
import {
  migrateConversation,
  getBucket,
  derivePreview,
  type Conversation,
  type Message,
} from "./conversation";

describe("migrateConversation", () => {
  const baseLegacy = {
    id: "c1",
    title: "Old conv",
    messages: [{ role: "user", content: "hi" }, { role: "model", content: "hello" }],
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };

  it("fills pinned/favorite/model defaults on legacy entry", () => {
    const out = migrateConversation(baseLegacy);
    expect(out).not.toBeNull();
    expect(out!.pinned).toBe(false);
    expect(out!.favorite).toBe(false);
    expect(out!.model).toBe("Auto-detect");
  });

  it("preserves existing pinned=true", () => {
    const out = migrateConversation({ ...baseLegacy, pinned: true });
    expect(out).not.toBeNull();
    expect(out!.pinned).toBe(true);
  });

  it("preserves existing favorite + model", () => {
    const out = migrateConversation({ ...baseLegacy, favorite: true, model: "335i • E92" });
    expect(out).not.toBeNull();
    expect(out!.favorite).toBe(true);
    expect(out!.model).toBe("335i • E92");
  });

  it("preserves messages verbatim including role", () => {
    const out = migrateConversation(baseLegacy);
    expect(out).not.toBeNull();
    expect(out!.messages).toEqual(baseLegacy.messages);
  });

  it("returns null for non-object input", () => {
    expect(migrateConversation(null)).toBeNull();
    expect(migrateConversation("hi")).toBeNull();
  });

  it("returns null when required fields missing", () => {
    expect(migrateConversation({ id: "c1" })).toBeNull();
  });
});

describe("getBucket", () => {
  const now = new Date("2026-05-02T12:00:00Z");

  it("returns 'today' for same calendar day", () => {
    expect(getBucket("2026-05-02T01:00:00Z", now)).toBe("today");
  });
  it("returns 'yesterday' for prior calendar day", () => {
    expect(getBucket("2026-05-01T23:00:00Z", now)).toBe("yesterday");
  });
  it("returns 'week' for 3 days ago", () => {
    expect(getBucket("2026-04-29T12:00:00Z", now)).toBe("week");
  });
  it("returns 'older' for 30 days ago", () => {
    expect(getBucket("2026-04-02T12:00:00Z", now)).toBe("older");
  });
});

describe("derivePreview", () => {
  it("returns first user message trimmed to 80 chars", () => {
    const msgs: Message[] = [
      { role: "user", content: "Why does my E90 335i hesitate when starting cold below 50°F? No CEL pulled and the issue persists for ~2s." },
      { role: "model", content: "It's HPFP." },
    ];
    expect(derivePreview(msgs)).toMatch(/^Why does my E90/);
    expect(derivePreview(msgs).length).toBeLessThanOrEqual(80);
  });
  it("returns empty string when no messages", () => {
    expect(derivePreview([])).toBe("");
  });
  it("returns empty string when only model messages", () => {
    expect(derivePreview([{ role: "model", content: "hi" }])).toBe("");
  });
});
