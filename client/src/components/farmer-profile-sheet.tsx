import { useRef, useState } from "react";
import { Camera, UserRound } from "lucide-react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ProfileUser = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

function emailOk(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function photoSrc(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("data:")) return avatarUrl;
  try {
    const url = new URL(avatarUrl);
    return url.pathname + url.search;
  } catch {
    return avatarUrl;
  }
}

async function shrinkPhoto(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("photo"));
      el.src = objectUrl;
    });
    const max = 256;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function FarmerProfileButton({
  user,
  onLocalName,
}: {
  user?: ProfileUser | null;
  onLocalName?: (firstName: string) => void;
}) {
  const { t } = useFarmerLang();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoDirty, setPhotoDirty] = useState(false);

  function openSheet() {
    const preview = import.meta.env.DEV && window.location.pathname.startsWith("/preview/farmer");
    setFirstName(user?.firstName?.trim() || (preview ? "Nico" : ""));
    setLastName(user?.lastName?.trim() || "");
    setPhone(user?.contactNumber?.trim() || "");
    setEmail(user?.email?.trim() || "");
    setPhoto(photoSrc(user?.avatarUrl));
    setPhotoDirty(false);
    setOpen(true);
  }

  async function save() {
    const name = firstName.trim();
    const surname = lastName.trim();
    const address = email.trim().toLowerCase();
    if (!name || !surname || !emailOk(address)) return;
    setBusy(true);
    try {
      if (!user?.id) {
        onLocalName?.(name);
        toast({ title: t.profileSaved });
        setOpen(false);
        return;
      }
      if (user?.id) {
        if (photoDirty && photo) {
          const photoRes = await fetch("/api/users/me/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ avatarDataUrl: photo }),
          });
          if (!photoRes.ok) throw new Error(t.profileFailed);
        }
        await apiRequest("PATCH", "/api/users/me", {
          firstName: name,
          lastName: surname,
          contactNumber: phone.trim() || null,
          email: address,
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
      toast({ title: t.profileSaved });
      setOpen(false);
    } catch (error) {
      const taken = error instanceof Error && /already exists|409/.test(error.message);
      toast({ title: taken ? t.profileEmailTaken : t.profileFailed, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="h-9 rounded-full border border-zinc-300 bg-white px-3.5 text-xs font-semibold text-zinc-800"
        data-testid="button-farmer-profile"
      >
        {t.profile}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          data-testid="sheet-farmer-profile"
          onClick={() => { if (!busy) setOpen(false); }}
        >
          <div
            className="max-h-[92vh] w-full max-w-[360px] overflow-y-auto rounded-[1.6rem] bg-white px-5 py-6 text-zinc-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-bold">{t.profileTitle}</h2>
            <button
              type="button"
              className="mx-auto mt-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-zinc-500"
              onClick={() => fileRef.current?.click()}
              aria-label={t.profilePhoto}
              data-testid="button-profile-photo"
            >
              {photo ? (
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-8 w-8" />
              )}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-zinc-500">
              <Camera className="h-3.5 w-3.5" />
              {t.profilePhoto}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="input-profile-photo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void shrinkPhoto(file).then((dataUrl) => {
                  setPhoto(dataUrl);
                  setPhotoDirty(true);
                }).catch(() => {
                  toast({ title: t.profileFailed, variant: "destructive" });
                });
              }}
            />
            <label className="mt-4 block text-xs font-semibold text-zinc-500" htmlFor="profile-first">{t.profileFirst}</label>
            <input
              id="profile-first"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-zinc-200 px-3 text-base"
              data-testid="input-profile-first"
            />
            <label className="mt-3 block text-xs font-semibold text-zinc-500" htmlFor="profile-last">{t.profileLast}</label>
            <input
              id="profile-last"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-zinc-200 px-3 text-base"
              data-testid="input-profile-last"
            />
            <label className="mt-3 block text-xs font-semibold text-zinc-500" htmlFor="profile-phone">{t.profilePhone}</label>
            <input
              id="profile-phone"
              value={phone}
              inputMode="tel"
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-zinc-200 px-3 text-base"
              data-testid="input-profile-phone"
            />
            <label className="mt-3 block text-xs font-semibold text-zinc-500" htmlFor="profile-email">{t.profileEmail}</label>
            <input
              id="profile-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-zinc-200 px-3 text-base"
              data-testid="input-profile-email"
            />
            <button
              type="button"
              disabled={busy || !firstName.trim() || !lastName.trim() || !emailOk(email)}
              onClick={() => void save()}
              className="mt-5 h-12 w-full rounded-xl bg-[#006039] text-sm font-bold text-white disabled:opacity-50"
              data-testid="button-profile-save"
            >
              {busy ? t.profileSaving : t.profileSave}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
