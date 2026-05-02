import { describe, expect, it } from "vitest";
import { parseSourcesAnnotation } from "./sources";

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
