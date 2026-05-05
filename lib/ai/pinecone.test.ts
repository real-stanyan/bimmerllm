import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./pinecone";

describe("reciprocalRankFusion", () => {
  it("returns empty array for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("preserves single ranking order", () => {
    const ranking = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const fused = reciprocalRankFusion([ranking]);
    expect(fused.map(r => r.id)).toEqual(["a", "b", "c"]);
  });

  it("boosts items appearing in both rankings", () => {
    const dense = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const sparse = [{ id: "x" }, { id: "b" }, { id: "y" }];
    const fused = reciprocalRankFusion([dense, sparse]);
    // 'b' appears in both at rank 1 (0-indexed), so its rrfScore = 2/(60+2) > any single appearance
    expect(fused[0].id).toBe("b");
  });

  it("uses configurable k parameter", () => {
    const ranking = [{ id: "a" }, { id: "b" }];
    const k1 = reciprocalRankFusion([ranking], 1);
    const k60 = reciprocalRankFusion([ranking], 60);
    // smaller k → larger score gap between ranks 0 and 1
    const gapK1 = k1[0].rrfScore - k1[1].rrfScore;
    const gapK60 = k60[0].rrfScore - k60[1].rrfScore;
    expect(gapK1).toBeGreaterThan(gapK60);
  });

  it("merges three rankings deduping by id", () => {
    const a = [{ id: "1" }, { id: "2" }];
    const b = [{ id: "2" }, { id: "3" }];
    const c = [{ id: "3" }, { id: "1" }];
    const fused = reciprocalRankFusion([a, b, c]);
    const ids = fused.map(r => r.id).sort();
    expect(ids).toEqual(["1", "2", "3"]);
    expect(fused).toHaveLength(3);
  });

  it("preserves payload fields besides id", () => {
    const ranking = [{ id: "a", title: "Foo" }, { id: "b", title: "Bar" }];
    const fused = reciprocalRankFusion([ranking]);
    expect(fused[0]).toMatchObject({ id: "a", title: "Foo" });
    expect(fused[0]).toHaveProperty("rrfScore");
  });
});
