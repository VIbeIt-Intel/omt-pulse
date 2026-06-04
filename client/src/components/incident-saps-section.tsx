import { useEffect, useState } from "react";
import type { FormField } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield } from "lucide-react";

export type SapsCustomValues = Record<string, string | number | null | undefined>;

export function isSapsFormField(field: { label: string; fieldKey: string }): boolean {
  const hay = `${field.label} ${field.fieldKey}`.toLowerCase();
  return hay.includes("saps");
}

export function hasSapsCaseData(
  fields: Array<{ fieldKey: string }>,
  customFields: SapsCustomValues | null | undefined,
): boolean {
  const cf = customFields ?? {};
  return fields.some((f) => {
    const v = cf[f.fieldKey];
    return v != null && String(v).trim() !== "";
  });
}

function clearSapsFields(
  current: SapsCustomValues,
  fields: Array<{ fieldKey: string }>,
): SapsCustomValues {
  const next = { ...current };
  for (const f of fields) delete next[f.fieldKey];
  return next;
}

type Props = {
  fields: FormField[];
  customFields: SapsCustomValues;
  onChange: (next: SapsCustomValues) => void;
};

export function IncidentSapsSection({ fields, customFields, onChange }: Props) {
  const [open, setOpen] = useState(() => hasSapsCaseData(fields, customFields));

  useEffect(() => {
    if (hasSapsCaseData(fields, customFields)) setOpen(true);
  }, [fields, customFields]);

  if (fields.length === 0) return null;

  const setField = (key: string, value: string) => {
    onChange({ ...customFields, [key]: value.trim() ? value : null });
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) onChange(clearSapsFields(customFields, fields));
        }}
        className={`w-full flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors touch-manipulation ${
          open
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:bg-muted/40"
        }`}
        data-testid="toggle-saps-case"
      >
        <Shield className="h-4 w-4 shrink-0" />
        SAPS case
      </button>

      {open && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3" data-testid="section-saps-case">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" />
            SAPS case details
          </p>
          <div className="space-y-3">
            {fields.map((cf) => {
              const value = String(customFields[cf.fieldKey] ?? "");

              if (cf.fieldType === "select") {
                const opts = (cf.options || "").split(",").map((o) => o.trim()).filter(Boolean);
                return (
                  <div key={cf.id} className="space-y-1.5">
                    <Label className="text-xs">{cf.label}</Label>
                    <Select value={value} onValueChange={(v) => setField(cf.fieldKey, v)}>
                      <SelectTrigger data-testid={`select-saps-field-${cf.fieldKey}`}>
                        <SelectValue placeholder={`Select ${cf.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {opts.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }

              return (
                <div key={cf.id} className="space-y-1.5">
                  <Label className="text-xs">{cf.label}</Label>
                  <Input
                    value={value}
                    onChange={(e) => setField(cf.fieldKey, e.target.value)}
                    placeholder={cf.label}
                    data-testid={`input-saps-field-${cf.fieldKey}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only summary for occurrence book / detail views. */
export function IncidentSapsSummary({
  fields,
  customFields,
}: {
  fields: Array<{ id: number; label: string; fieldKey: string }>;
  customFields: SapsCustomValues | null | undefined;
}) {
  const sapsFields = fields.filter(isSapsFormField);
  if (!hasSapsCaseData(sapsFields, customFields)) return null;
  const cf = customFields ?? {};

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="summary-saps-case">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5" />
        SAPS case
      </p>
      {sapsFields.map((f) => {
        const v = cf[f.fieldKey];
        if (v == null || String(v).trim() === "") return null;
        return (
          <div key={f.fieldKey}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{f.label}</p>
            <p className="text-sm mt-0.5">{String(v)}</p>
          </div>
        );
      })}
    </div>
  );
}
