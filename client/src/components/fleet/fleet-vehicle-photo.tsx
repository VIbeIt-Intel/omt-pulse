import { Car } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: { box: "h-14 w-14 rounded-lg", icon: "h-6 w-6" },
  md: { box: "h-20 w-20 rounded-xl", icon: "h-8 w-8" },
  lg: { box: "h-28 w-28 sm:h-32 sm:w-32 rounded-xl", icon: "h-10 w-10 sm:h-12 sm:w-12" },
} as const;

type FleetVehiclePhotoProps = {
  photoUrl: string | null | undefined;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
};

export function FleetVehiclePhoto({ photoUrl, size = "sm", className }: FleetVehiclePhotoProps) {
  const cfg = SIZE_CLASS[size];
  const boxClass = cn(
    cfg.box,
    "shrink-0 overflow-hidden border border-border/60 bg-muted/40",
    className,
  );

  if (photoUrl) {
    return <img src={photoUrl} alt="" className={cn(boxClass, "object-cover")} />;
  }

  return (
    <div className={cn(boxClass, "flex items-center justify-center")}>
      <Car className={cn(cfg.icon, "text-muted-foreground/60")} />
    </div>
  );
}
