import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPreferences, writePreferences } from "./preferences";

const KEY = "bimmerllm_prefs";
const DEFAULT = {
  units: "metric" as const,
  citations: true,
  autoModel: true,
  retrievalConfig: "v1" as const,
};

// happy-dom 20 + Node 22 collide on the global `localStorage` (Node ships an
// empty placeholder when --localstorage-file isn't set). Mock it ourselves so
// the tests don't depend on which Storage wins the race.
function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
}

let storage: ReturnType<typeof mockStorage>;

beforeEach(() => {
  storage = mockStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPreferences", () => {
  it("returns defaults when localStorage has no entry", () => {
    expect(readPreferences()).toEqual(DEFAULT);
  });

  it("returns the parsed value when JSON is present", () => {
    storage.setItem(KEY, JSON.stringify({
      units: "imperial", citations: false, autoModel: false, retrievalConfig: "v2-hybrid",
    }));
    expect(readPreferences()).toEqual({
      units: "imperial", citations: false, autoModel: false, retrievalConfig: "v2-hybrid",
    });
  });

  it("spreads defaults under partial JSON to fill missing fields", () => {
    storage.setItem(KEY, JSON.stringify({ units: "imperial" }));
    expect(readPreferences()).toEqual({
      units: "imperial", citations: true, autoModel: true, retrievalConfig: "v1",
    });
  });

  it("returns defaults when stored JSON is malformed", () => {
    storage.setItem(KEY, "{not json");
    expect(readPreferences()).toEqual(DEFAULT);
  });
});

describe("writePreferences", () => {
  it("round-trips through localStorage", () => {
    const next = {
      units: "imperial" as const,
      citations: false,
      autoModel: true,
      retrievalConfig: "v2-dense" as const,
    };
    writePreferences(next);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(next);
    expect(readPreferences()).toEqual(next);
  });
});
