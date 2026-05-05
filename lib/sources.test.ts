import { describe, expect, it } from "vitest";
import { extractSourcesFromMessage, parseSourcesAnnotation } from "./sources";

describe("parseSourcesAnnotation", () => {
  it("returns sources array from valid annotation", () => {
    const a = { type: "sources", sources: [{ id: "a", score: 0.9, preview: "abc" }] };
    expect(parseSourcesAnnotation(a)).toEqual([{ id: "a", score: 0.9, preview: "abc" }]);
  });

  it("returns null for null/undefined input", () => {
    expect(parseSourcesAnnotation(null)).toBeNull();
    expect(parseSourcesAnnotation(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseSourcesAnnotation("foo")).toBeNull();
    expect(parseSourcesAnnotation(42)).toBeNull();
  });

  it("returns null when type !== 'sources'", () => {
    expect(parseSourcesAnnotation({ type: "other", sources: [] })).toBeNull();
  });

  it("returns null when sources is not an array", () => {
    expect(parseSourcesAnnotation({ type: "sources", sources: "x" })).toBeNull();
  });

  it("filters out malformed source entries", () => {
    const a = {
      type: "sources",
      sources: [
        { id: "a", score: 0.9, preview: "abc" },
        { id: "b" }, // missing score + preview
        { score: 0.5, preview: "no id" },
      ],
    };
    expect(parseSourcesAnnotation(a)).toEqual([{ id: "a", score: 0.9, preview: "abc" }]);
  });
});

describe("extractSourcesFromMessage", () => {
  const sources = [{ id: "x", score: 0.7, preview: "p" }];
  const data = { type: "sources", sources };

  it("returns null for null/undefined/non-object input", () => {
    expect(extractSourcesFromMessage(null)).toBeNull();
    expect(extractSourcesFromMessage(undefined)).toBeNull();
    expect(extractSourcesFromMessage("hi")).toBeNull();
  });

  it("returns the data field when a parts entry has type=data-sources", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "text", text: "hello" },
        { type: "data-sources", data },
      ],
    };
    expect(extractSourcesFromMessage(message)).toEqual(data);
  });

  it("returns null when no parts entry matches", () => {
    const message = {
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    };
    expect(extractSourcesFromMessage(message)).toBeNull();
  });

  it("falls back to an annotations entry typed as sources", () => {
    const annotation = { type: "sources", sources };
    const message = { role: "assistant", annotations: [annotation] };
    expect(extractSourcesFromMessage(message)).toBe(annotation);
  });

  it("returns null when neither parts nor annotations carry sources", () => {
    const message = { role: "assistant", parts: [], annotations: [] };
    expect(extractSourcesFromMessage(message)).toBeNull();
  });

  it("ignores data-sources part without data field by returning undefined data", () => {
    const message = {
      role: "assistant",
      parts: [{ type: "data-sources" }], // no data
    };
    expect(extractSourcesFromMessage(message)).toBeUndefined();
  });
});
