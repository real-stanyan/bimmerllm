import { describe, expect, it } from "vitest";
import { fromAiMessage, toAiMessage, type AiUiMessage } from "./chat-bridge";
import type { Message as StoredMessage } from "./conversation";

describe("toAiMessage", () => {
  it("maps storage 'model' role to AI SDK 'assistant'", () => {
    const ai = toAiMessage({ id: "m1", role: "model", content: "hi" }, 0);
    expect(ai.role).toBe("assistant");
    expect(ai.id).toBe("m1");
    expect(ai.parts).toEqual([{ type: "text", text: "hi" }]);
  });

  it("preserves 'user' role", () => {
    const ai = toAiMessage({ id: "u1", role: "user", content: "q" }, 0);
    expect(ai.role).toBe("user");
  });

  it("falls back to legacy-<idx> id when StoredMessage has no id", () => {
    const ai = toAiMessage({ role: "user", content: "q" }, 7);
    expect(ai.id).toBe("legacy-7");
  });
});

describe("fromAiMessage", () => {
  it("maps AI SDK 'assistant' role back to storage 'model'", () => {
    const stored = fromAiMessage({
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "answer" }],
    });
    expect(stored.role).toBe("model");
    expect(stored.id).toBe("a1");
    expect(stored.content).toBe("answer");
  });

  it("preserves user role", () => {
    const stored = fromAiMessage({ id: "u1", role: "user", parts: [{ type: "text", text: "q" }] });
    expect(stored.role).toBe("user");
  });

  it("concatenates multiple text parts in order", () => {
    const stored = fromAiMessage({
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    });
    expect(stored.content).toBe("hello world");
  });

  it("ignores non-text parts when joining content", () => {
    const stored = fromAiMessage({
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "before" },
        { type: "data-sources", data: { type: "sources", sources: [] } },
        { type: "text", text: "after" },
      ],
    });
    expect(stored.content).toBe("beforeafter");
  });

  it("returns empty content when there are no parts", () => {
    const stored = fromAiMessage({ id: "x", role: "assistant", parts: [] });
    expect(stored.content).toBe("");
  });

  it("treats text parts with missing text field as empty", () => {
    const stored = fromAiMessage({
      id: "x",
      role: "assistant",
      parts: [{ type: "text" }, { type: "text", text: "ok" }],
    });
    expect(stored.content).toBe("ok");
  });
});

describe("toAiMessage <-> fromAiMessage round trip", () => {
  it("preserves id, role, and content for a model message with id", () => {
    const original: StoredMessage = { id: "abc", role: "model", content: "answer" };
    const round = fromAiMessage(toAiMessage(original, 0) as AiUiMessage);
    expect(round.id).toBe(original.id);
    expect(round.role).toBe(original.role);
    expect(round.content).toBe(original.content);
  });

  it("populates the legacy id on round trip when source had none", () => {
    const original: StoredMessage = { role: "user", content: "q" };
    const round = fromAiMessage(toAiMessage(original, 3) as AiUiMessage);
    expect(round.id).toBe("legacy-3");
    expect(round.role).toBe("user");
    expect(round.content).toBe("q");
  });
});
