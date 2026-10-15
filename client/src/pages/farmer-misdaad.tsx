import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { acquirePanicLocation, hasPanicCoordinates } from "@/lib/panic-location";
import { prepareAndUploadFile } from "@/lib/upload-media";

const KINDS = ["stock_theft", "burglary", "suspicious_vehicle", "suspicious_person", "other"] as const;
type Kind = (typeof KINDS)[number];

type CrimeRow = {
  id: number;
  categoryName: string | null;
  description: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  createdAt: string;
};

export default function FarmerMisdaad() {
  const { t } = useFarmerLang();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const { data: reports = [] } = useQuery<CrimeRow[]>({
    queryKey: ["/api/crime"],
    refetchInterval: 8000,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!kind) throw new Error(t.crimeHelp);
      const loc = await acquirePanicLocation();
      const coords = hasPanicCoordinates(loc) ? { lat: loc.lat, lng: loc.lng } : {};
      const res = await apiRequest("POST", "/api/crime", {
        kind,
        note: note.trim() || undefined,
        ...coords,
      });
      const body = await res.json() as { incidentId: number };
      if (photo) {
        try {
          const uploaded = await prepareAndUploadFile(photo, { preset: "evidence" });
          await apiRequest("POST", `/api/incidents/${body.incidentId}/attachments`, {
            url: uploaded.objectUrl,
            filename: uploaded.file.name,
            mimeType: uploaded.file.type || "image/jpeg",
            evidencePhase: "scene",
            byteSize: uploaded.byteSize,
          });
        } catch {
          /* The report is already in the book. A failed photo must not look like a failed send. */
        }
      }
      return body;
    },
    onSuccess: () => {
      setKind(null);
      setNote("");
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["/api/crime"] });
      toast({ title: t.crimeSent });
    },
    onError: (err: Error) => {
      toast({ title: t.misdaad, description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="page-farmer-misdaad">
      <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6" />
          <h1 className="text-2xl font-bold">{t.crimeTitle}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t.crimeHelp}</p>
        <p className="text-xs text-muted-foreground">{t.gpsUsed}</p>

        <div className="grid grid-cols-1 gap-2">
          {KINDS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={`h-12 rounded-2xl px-4 text-left font-semibold text-sm ${kind === key ? "bg-zinc-800 text-white" : "bg-muted"}`}
              data-testid={`button-crime-${key}`}
            >
              {t.kinds[key]}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.whatHappened}
          rows={3}
          className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm"
          data-testid="input-crime-note"
        />

        <label className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 h-12 text-sm cursor-pointer">
          <span>{photo ? photo.name : t.photo}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid="input-crime-photo"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="button"
          disabled={!kind || send.isPending}
          onClick={() => send.mutate()}
          className="w-full h-14 rounded-2xl bg-zinc-900 text-white font-bold disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          data-testid="button-send-crime"
        >
          {send.isPending ? t.sending : t.sendCrime}
        </button>

        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t.recent}</h2>
          {reports.length === 0 && <p className="text-sm text-muted-foreground">{t.noCrime}</p>}
          {reports.map((row) => {
            const who = [row.reporterFirstName, row.reporterLastName].filter(Boolean).join(" ");
            return (
              <article key={row.id} className="rounded-2xl border border-border p-3" data-testid={`card-crime-${row.id}`}>
                <p className="font-semibold">{row.categoryName}</p>
                <p className="text-sm text-muted-foreground">{who}</p>
                {row.description && <p className="text-sm mt-1 whitespace-pre-wrap">{row.description}</p>}
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
