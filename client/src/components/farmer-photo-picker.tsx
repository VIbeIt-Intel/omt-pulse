import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, X } from "lucide-react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { FARMER_PHOTO_LIMIT } from "@/lib/scene-photos";

type Preview = { url: string };

export function FarmerPhotoPicker({
  photos,
  onChange,
  tone,
  idPrefix,
}: {
  photos: File[];
  onChange: (next: File[]) => void;
  tone: "fire" | "plain" | "livestock" | "crime";
  idPrefix: "fire" | "crime";
}) {
  const { t } = useFarmerLang();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const atLimit = photos.length >= FARMER_PHOTO_LIMIT;
  const fire = tone === "fire";
  const livestock = tone === "livestock";
  const crime = tone === "crime";
  const cardClass = fire
    ? "border-orange-200 bg-orange-50 text-orange-950"
    : livestock
      ? "border-[#e7d3b0] bg-[#fffaf3] text-[#7c2d12]"
      : crime
        ? "border-[#d5deea] bg-white text-[#1E3A5F]"
        : "border-border bg-background";
  const buttonClass = fire
    ? "bg-orange-50 text-orange-950"
    : livestock
      ? "border border-[#e7d3b0] bg-[#fffaf3] text-[#7c2d12]"
      : crime
        ? "border border-[#d5deea] bg-white text-[#1E3A5F]"
        : "bg-muted";
  const labelClass = fire ? "text-orange-950" : livestock ? "text-[#7c2d12]" : crime ? "text-[#1E3A5F]" : "";

  useEffect(() => {
    const next = photos.map((file) => ({ url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    };
  }, [photos]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = [...photos];
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/")) continue;
      if (next.length >= FARMER_PHOTO_LIMIT) break;
      next.push(file);
    }
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <p className={`text-sm font-semibold ${labelClass}`}>{t.photo}</p>
      {previews.map((preview, index) => (
        <div
          key={preview.url}
          className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${cardClass}`}
        >
          <img
            src={preview.url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-xl object-cover"
            data-testid={index === 0 ? `img-${idPrefix}-photo` : `img-${idPrefix}-photo-${index}`}
          />
          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight">{t.photoAdded}</span>
          <button
            type="button"
            onClick={() => removeAt(index)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10"
            aria-label={t.removePhoto}
            data-testid={`button-${idPrefix}-remove-photo-${index}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          disabled={atLimit}
          onClick={() => cameraRef.current?.click()}
          className={`inline-flex h-12 items-center gap-2 rounded-2xl px-4 text-left text-sm font-semibold disabled:opacity-50 ${buttonClass}`}
          data-testid={idPrefix === "fire" ? "button-fire-take-photo" : "button-take-photo"}
        >
          <Camera className="h-4 w-4 shrink-0" />
          {t.takePhoto}
        </button>
        <button
          type="button"
          disabled={atLimit}
          onClick={() => libraryRef.current?.click()}
          className={`inline-flex h-12 items-center gap-2 rounded-2xl px-4 text-left text-sm font-semibold disabled:opacity-50 ${buttonClass}`}
          data-testid={idPrefix === "fire" ? "button-fire-upload-photo" : "button-upload-photo"}
        >
          <ImageIcon className="h-4 w-4 shrink-0" />
          {t.uploadPhoto}
        </button>
      </div>
      {atLimit && <p className="text-xs text-muted-foreground">{t.photoLimit}</p>}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid={idPrefix === "fire" ? "input-fire-camera" : "input-crime-camera"}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid={idPrefix === "fire" ? "input-fire-library" : "input-crime-library"}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
