import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { useToast } from "@/hooks/use-toast";
import {
  ALBERT_FPA,
  ALBERT_MUNICIPALITY,
  ALBERT_PROVINCE,
  blankFireReport,
  downloadFireReport,
  forwardFireReport,
  loadFireReport,
  printFireReport,
  saveFireReport,
  type DamageCell,
  type FireReportDraft,
} from "@/lib/albert-fire-report";

function Field({
  label,
  value,
  onChange,
  testId,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  type?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-2xl border border-border bg-background px-3 text-sm"
        data-testid={testId}
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm"
        data-testid={testId}
      />
    </label>
  );
}

function DamageCard({
  title,
  value,
  onChange,
  labels,
  testId,
}: {
  title: string;
  value: DamageCell;
  onChange: (value: DamageCell) => void;
  labels: { injury: string; damage: string; area: string; loss: string };
  testId: string;
}) {
  const set = (key: keyof DamageCell) => (next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="space-y-2 rounded-2xl border border-border p-3" data-testid={testId}>
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={labels.injury} value={value.injury} onChange={set("injury")} testId={`${testId}-injury`} />
        <Field label={labels.damage} value={value.damage} onChange={set("damage")} testId={`${testId}-damage`} />
        <Field label={labels.area} value={value.area} onChange={set("area")} testId={`${testId}-area`} />
        <Field label={labels.loss} value={value.loss} onChange={set("loss")} testId={`${testId}-loss`} />
      </div>
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
  hint,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  hint: string;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2) {
        frame = requestAnimationFrame(paint);
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      if (!value) return;
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, width, height);
      image.src = value;
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [value]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="h-36 w-full touch-none rounded-2xl border border-border bg-white"
        data-testid="canvas-brand-sign"
        onPointerDown={(event) => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          canvas.setPointerCapture(event.pointerId);
          const next = point(event);
          ctx.beginPath();
          ctx.moveTo(next.x, next.y);
          drawing.current = true;
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const next = point(event);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          const canvas = canvasRef.current;
          if (canvas) onChange(canvas.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{hint}</span>
        <button
          type="button"
          className="text-sm font-semibold"
          data-testid="button-brand-sign-clear"
          onClick={() => onChange("")}
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

export function FarmerBrandverslag({
  name,
  contact,
  fireAt,
  onBack,
}: {
  name: string;
  contact: string;
  fireAt?: string | null;
  onBack: () => void;
}) {
  const { t, lang } = useFarmerLang();
  const { toast } = useToast();
  const ready = useRef(false);
  const [draft, setDraft] = useState<FireReportDraft>(() => loadFireReport() ?? blankFireReport());
  const [busy, setBusy] = useState<"save" | "print" | "forward" | null>(null);

  useEffect(() => {
    if (ready.current) return;
    const saved = loadFireReport();
    if (saved) {
      setDraft(saved);
      ready.current = true;
      return;
    }
    if (!name && !contact && !fireAt) return;
    setDraft(blankFireReport({ name, contact, fireAt }));
    ready.current = true;
  }, [name, contact, fireAt]);

  useEffect(() => {
    if (!ready.current) return;
    saveFireReport(draft);
  }, [draft]);

  function patch(partial: Partial<FireReportDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  const damageLabels = {
    injury: t.brandInjury,
    damage: t.brandDamage,
    area: t.brandArea,
    loss: t.brandEstimated,
  };

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="page-brandverslag">
      <div className="mx-auto max-w-lg space-y-4 px-4 py-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold" data-testid="button-brand-back">
          <ArrowLeft className="h-4 w-4" />
          {t.vuur}
        </button>
        <div>
          <h1 className="text-2xl font-bold">{t.brandTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.brandHint}</p>
        </div>

        <div className="space-y-1 rounded-2xl border border-border px-4 py-3 text-sm">
          <p className="font-bold">Albert</p>
          <p>Fire Protection Association</p>
          <p className="text-muted-foreground">{t.brandFpa}: {ALBERT_FPA}</p>
          <p className="text-muted-foreground">{t.brandProvince}: {ALBERT_PROVINCE}</p>
          <p className="text-muted-foreground">{t.brandMunicipality}: {ALBERT_MUNICIPALITY}</p>
        </div>

        <Field label={t.brandBy} value={draft.reportBy} onChange={(reportBy) => patch({ reportBy })} testId="input-brand-by" />
        <Field label={t.brandContact} value={draft.contact} onChange={(contactNo) => patch({ contact: contactNo })} testId="input-brand-contact" />
        <Field label={t.brandDate} value={draft.reportDate} onChange={(reportDate) => patch({ reportDate })} testId="input-brand-date" type="date" />

        <h2 className="pt-2 text-sm font-semibold">{t.brandDetails}</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.brandFireDate} value={draft.fireDate} onChange={(fireDate) => patch({ fireDate })} testId="input-brand-fire-date" type="date" />
          <Field label={t.brandFireTime} value={draft.fireTime} onChange={(fireTime) => patch({ fireTime })} testId="input-brand-fire-time" type="time" />
        </div>
        <Field label={t.brandDuration} value={draft.duration} onChange={(duration) => patch({ duration })} testId="input-brand-duration" />
        <Area label={t.brandCause} value={draft.cause} onChange={(cause) => patch({ cause })} testId="input-brand-cause" />
        <Area label={t.brandProperties} value={draft.properties} onChange={(properties) => patch({ properties })} testId="input-brand-properties" />
        <Area label={t.brandResponders} value={draft.responders} onChange={(responders) => patch({ responders })} testId="input-brand-responders" />
        <Area label={t.brandResources} value={draft.resources} onChange={(resources) => patch({ resources })} testId="input-brand-resources" />

        <h2 className="pt-2 text-sm font-semibold">{t.brandLoss}</h2>
        <DamageCard title={t.brandLivestock} value={draft.livestock} onChange={(livestock) => patch({ livestock })} labels={damageLabels} testId="card-brand-livestock" />
        <DamageCard title={t.brandBuildings} value={draft.buildings} onChange={(buildings) => patch({ buildings })} labels={damageLabels} testId="card-brand-buildings" />
        <DamageCard title={t.brandGrazing} value={draft.grazing} onChange={(grazing) => patch({ grazing })} labels={damageLabels} testId="card-brand-grazing" />
        <DamageCard title={t.brandEquipment} value={draft.equipment} onChange={(equipment) => patch({ equipment })} labels={damageLabels} testId="card-brand-equipment" />

        <div className="space-y-2">
          <p className="text-sm font-semibold">{t.brandSaps}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => patch({ saps: draft.saps === "yes" ? "" : "yes" })}
              className={`h-12 rounded-2xl text-sm font-semibold ${draft.saps === "yes" ? "bg-zinc-800 text-white" : "bg-muted"}`}
              data-testid="button-brand-saps-yes"
            >
              {t.brandYes}
            </button>
            <button
              type="button"
              onClick={() => patch({ saps: draft.saps === "no" ? "" : "no", caseNumber: draft.saps === "no" ? draft.caseNumber : "" })}
              className={`h-12 rounded-2xl text-sm font-semibold ${draft.saps === "no" ? "bg-zinc-800 text-white" : "bg-muted"}`}
              data-testid="button-brand-saps-no"
            >
              {t.brandNo}
            </button>
          </div>
        </div>
        {draft.saps === "yes" && (
          <Field label={t.brandCase} value={draft.caseNumber} onChange={(caseNumber) => patch({ caseNumber })} testId="input-brand-case" />
        )}
        <Field label={t.brandReporter} value={draft.reportingPerson} onChange={(reportingPerson) => patch({ reportingPerson })} testId="input-brand-reporter" />
        <Field label={t.brandSign} value={draft.signatory} onChange={(signatory) => patch({ signatory })} testId="input-brand-signatory" />
        <SignaturePad
          value={draft.signature}
          onChange={(signature) => patch({ signature })}
          hint={t.brandSignHint}
          clearLabel={t.brandSignClear}
        />
        <Field label={t.brandSignDate} value={draft.signDate} onChange={(signDate) => patch({ signDate })} testId="input-brand-sign-date" type="date" />

        <div className="grid grid-cols-3 gap-2 pb-6">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => {
              setBusy("save");
              void downloadFireReport(draft, lang)
                .then(() => toast({ title: t.brandSaved, description: t.brandSavedHint }))
                .catch(() => toast({ title: t.brandSaved, description: t.brandSaveFailed, variant: "destructive" }))
                .finally(() => setBusy(null));
            }}
            className="h-14 rounded-2xl bg-zinc-900 text-sm font-bold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            data-testid="button-brand-save"
          >
            {t.brandSave}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => {
              setBusy("print");
              void printFireReport(draft, lang)
                .then(() => toast({ title: t.brandPrint, description: t.brandPrintHint }))
                .catch(() => toast({ title: t.brandPrint, description: t.brandSaveFailed, variant: "destructive" }))
                .finally(() => setBusy(null));
            }}
            className="h-14 rounded-2xl bg-muted text-sm font-bold disabled:opacity-50"
            data-testid="button-brand-print"
          >
            {t.brandPrint}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => {
              setBusy("forward");
              void forwardFireReport(draft, lang)
                .then((result) => {
                  toast(result === "shared"
                    ? { title: t.brandShared, description: t.brandSavedHint }
                    : { title: t.brandSaved, description: t.brandSavedHint });
                })
                .catch(() => toast({ title: t.brandForward, description: t.brandSaveFailed, variant: "destructive" }))
                .finally(() => setBusy(null));
            }}
            className="h-14 rounded-2xl bg-orange-600 text-sm font-bold text-white disabled:opacity-50"
            data-testid="button-brand-forward"
          >
            {t.brandForward}
          </button>
        </div>
      </div>
    </div>
  );
}
