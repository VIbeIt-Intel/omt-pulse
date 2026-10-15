import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { MapPicker } from "@/components/map-picker";
import type { AuthUser } from "@/lib/auth-user";
import { acquirePanicLocation, hasPanicCoordinates } from "@/lib/panic-location";

type FireRow = {
  id: number;
  userId: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  createdAt: string;
  fireLat: number | null;
  fireLng: number | null;
};

export default function FarmerVuur() {
  const { t } = useFarmerLang();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: fires = [] } = useQuery<FireRow[]>({
    queryKey: ["/api/fire/active"],
    refetchInterval: 5000,
  });
  const [mode, setMode] = useState<"farm" | "smoke">("farm");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const loc = await acquirePanicLocation();
      const reporter = hasPanicCoordinates(loc) ? { reporterLat: loc.lat, reporterLng: loc.lng } : {};
      const fire = mode === "smoke" && pin ? { fireLat: pin.lat, fireLng: pin.lng } : {};
      const res = await apiRequest("POST", "/api/fire", { ...reporter, ...fire, note: note.trim() || undefined });
      return res.json() as Promise<{ joined: boolean }>;
    },
    onSuccess: (data) => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["/api/fire/active"] });
      toast({ title: data.joined ? t.fireJoined : t.fireSent });
    },
    onError: (err: Error) => {
      toast({ title: t.vuur, description: err.message, variant: "destructive" });
    },
  });

  const close = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/fire/${id}/close`, {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/fire/active"] }),
  });

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="page-farmer-vuur">
      <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          <Flame className="h-6 w-6 text-orange-600" />
          <h1 className="text-2xl font-bold">{t.reportFire}</h1>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("farm")}
            className={`h-12 rounded-2xl font-semibold text-sm ${mode === "farm" ? "bg-orange-600 text-white" : "bg-muted"}`}
            data-testid="button-fire-on-farm"
          >
            {t.onMyFarm}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("smoke");
              if (pin) return;
              void acquirePanicLocation().then((loc) => {
                if (hasPanicCoordinates(loc)) setPin({ lat: loc.lat, lng: loc.lng });
              });
            }}
            className={`h-12 rounded-2xl font-semibold text-sm ${mode === "smoke" ? "bg-orange-600 text-white" : "bg-muted"}`}
            data-testid="button-fire-smoke"
          >
            {t.seeSmoke}
          </button>
        </div>

        {mode === "smoke" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t.smokeHelp}</p>
            {pin ? (
              <MapPicker
                latitude={pin.lat}
                longitude={pin.lng}
                onLocationSelect={(lat, lng) => setPin({ lat, lng })}
                height="240px"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t.gpsUsed}</p>
            )}
          </div>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.note}
          rows={3}
          className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm"
          data-testid="input-fire-note"
        />

        <button
          type="button"
          disabled={send.isPending || (mode === "smoke" && !pin)}
          onClick={() => send.mutate()}
          className="w-full h-14 rounded-2xl bg-orange-600 text-white font-bold disabled:opacity-50"
          data-testid="button-send-fire"
        >
          {send.isPending ? t.sending : t.sendFire}
        </button>

        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t.firesNow}</h2>
          {fires.length === 0 && <p className="text-sm text-muted-foreground">{t.noFires}</p>}
          {fires.map((fire) => {
            const name = [fire.reporterFirstName, fire.reporterLastName].filter(Boolean).join(" ") || t.vuur;
            const mine = fire.userId === user?.id;
            return (
              <div key={fire.id} className="rounded-2xl border border-border p-3 flex items-center justify-between gap-3" data-testid={`card-fire-${fire.id}`}>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{mine ? t.you : name}</p>
                  <p className="text-xs text-muted-foreground">{t.reportedBy}</p>
                </div>
                <button
                  type="button"
                  onClick={() => close.mutate(fire.id)}
                  disabled={close.isPending}
                  className="shrink-0 h-10 px-3 rounded-xl bg-muted text-sm font-semibold"
                  data-testid={`button-close-fire-${fire.id}`}
                >
                  {t.closeFire}
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
