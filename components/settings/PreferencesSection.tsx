// components/settings/PreferencesSection.tsx
"use client";
import { useEffect, useState } from "react";
import { readPreferences, writePreferences, type Preferences } from "@/lib/preferences";
import { Toggle } from "./Toggle";
import { Segment } from "./Segment";

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--text-1)] font-medium">{title}</div>
        {sub && <div className="text-xs text-[var(--text-3)] mt-0.5">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Divider() { return <div className="h-px bg-[var(--line-1)] -mx-5" />; }

export function PreferencesSection() {
  const [prefs, setPrefs] = useState<Preferences>(() => readPreferences());

  useEffect(() => { writePreferences(prefs); }, [prefs]);

  return (
    <div className="animate-fadeUp">
      <div className="flex justify-between items-end mb-4.5 gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight m-0">Preferences</h2>
          <p className="text-[13px] text-[var(--text-3)] mt-1">How bimmerllm answers you.</p>
        </div>
      </div>
      <div className="rounded-2xl p-5" style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}>
        <Row title="Measurement units" sub="Used in torque specs, mileage, fluid volumes.">
          <Segment
            value={prefs.units}
            onChange={v => setPrefs({ ...prefs, units: v as Preferences["units"] })}
            options={[{ id: "metric", label: "Metric" }, { id: "imperial", label: "Imperial" }]}
          />
        </Row>
        <Divider />
        <Row title="Cite sources inline" sub="Show retrieved bimmerpost passages next to claims.">
          <Toggle on={prefs.citations} onChange={v => setPrefs({ ...prefs, citations: v })} />
        </Row>
        <Divider />
        <Row title="Auto-detect vehicle" sub="Infer the model from context if you don't pick one.">
          <Toggle on={prefs.autoModel} onChange={v => setPrefs({ ...prefs, autoModel: v })} />
        </Row>
      </div>
    </div>
  );
}
