import { describe, expect, it } from "vitest";
import { migrateConversation, type Conversation } from "./conversation";

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
    expect(out.pinned).toBe(false);
    expect(out.favorite).toBe(false);
    expect(out.model).toBe("Auto-detect");
  });

  it("preserves existing pinned=true", () => {
    const out = migrateConversation({ ...baseLegacy, pinned: true });
    expect(out.pinned).toBe(true);
  });

  it("preserves existing favorite + model", () => {
    const out = migrateConversation({ ...baseLegacy, favorite: true, model: "335i • E92" });
    expect(out.favorite).toBe(true);
    expect(out.model).toBe("335i • E92");
  });

  it("preserves messages verbatim including role", () => {
    const out = migrateConversation(baseLegacy);
    expect(out.messages).toEqual(baseLegacy.messages);
  });

  it("returns null for non-object input", () => {
    expect(migrateConversation(null)).toBeNull();
    expect(migrateConversation("hi")).toBeNull();
  });

  it("returns null when required fields missing", () => {
    expect(migrateConversation({ id: "c1" })).toBeNull();
  });
});
