"use client";

import { useState } from "react";
import { Warehouse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  AVAILABILITY_STATUS,
  LEASE_STRUCTURES,
  POWER_PHASES,
  SPRINKLER_TYPES,
  type IndustrialFields,
} from "@/lib/industrial-fields";

function NumField({
  value,
  onSave,
  suffix,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  function commit() {
    setEditing(false);
    const n = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    const next = n != null && !Number.isNaN(n) ? n : null;
    if (next !== value) onSave(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value != null ? String(value) : ""); setEditing(false); }
        }}
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
      className="font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full"
    >
      {value != null ? (
        <>{value.toLocaleString()}{suffix ? <span className="text-muted-foreground font-normal"> {suffix}</span> : null}</>
      ) : (
        <span className="text-muted-foreground/50 font-normal italic">Click to add</span>
      )}
    </button>
  );
}

function TextField({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  function commit() {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== value) onSave(next);
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
        }}
        className="text-sm font-medium px-1.5 py-0.5 -mx-1.5 border rounded outline-none focus:ring-1 ring-ring w-full bg-background"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className="font-medium mt-0.5 text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full truncate"
    >
      {value ?? <span className="text-muted-foreground/50 font-normal italic">Click to add</span>}
    </button>
  );
}

function SelectField({
  value, options, onSave,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onSave: (v: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
      className="font-medium mt-0.5 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-muted/60 w-full bg-transparent outline-none cursor-pointer text-sm"
    >
      <option value="">Click to set</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function IndustrialSection({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial: IndustrialFields;
}) {
  const [values, setValues] = useState(initial);

  async function save<K extends keyof IndustrialFields>(field: K, value: IndustrialFields[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    const supabase = createClient();
    const { error } = await supabase
      .from("properties")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", propertyId);
    if (error) {
      window.alert(`Failed to save: ${error.message}`);
      setValues((prev) => ({ ...prev, [field]: initial[field] }));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Warehouse className="size-4" />
          Industrial / flex specs
        </CardTitle>
        <p className="text-xs text-muted-foreground">Clear height, docks, power, availability, asking rent.</p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Clear height</dt>
            <dd><NumField value={values.clear_height_ft} suffix="ft" onSave={(v) => save("clear_height_ft", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Dock doors</dt>
            <dd><NumField value={values.dock_doors} onSave={(v) => save("dock_doors", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Drive-in doors</dt>
            <dd><NumField value={values.drive_in_doors} onSave={(v) => save("drive_in_doors", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Power</dt>
            <dd><NumField value={values.power_amps} suffix="amps" onSave={(v) => save("power_amps", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Phase</dt>
            <dd><SelectField value={values.power_phase} options={[...POWER_PHASES]} onSave={(v) => save("power_phase", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Yard</dt>
            <dd><NumField value={values.yard_acres} suffix="ac" onSave={(v) => save("yard_acres", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Column spacing</dt>
            <dd><TextField value={values.column_spacing} onSave={(v) => save("column_spacing", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sprinkler</dt>
            <dd><SelectField value={values.sprinkler_type} options={[...SPRINKLER_TYPES]} onSave={(v) => save("sprinkler_type", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Availability</dt>
            <dd><SelectField value={values.availability_status} options={[...AVAILABILITY_STATUS]} onSave={(v) => save("availability_status", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Asking rent</dt>
            <dd><NumField value={values.asking_rent_psf} suffix="$/SF" onSave={(v) => save("asking_rent_psf", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">NNN / CAM</dt>
            <dd><NumField value={values.nnn_cam_psf} suffix="$/SF" onSave={(v) => save("nnn_cam_psf", v)} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lease structure</dt>
            <dd><SelectField value={values.lease_structure} options={[...LEASE_STRUCTURES]} onSave={(v) => save("lease_structure", v)} /></dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
