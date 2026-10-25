import {
  Anchor,
  AudioWaveform,
  ChartColumn,
  CircleCheckBig,
  Handshake,
  Lock,
  Megaphone,
  Scale,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BadgeId } from "@/lib/progress";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";

/** Each badge's icon and colour. The colours are mid-tones that read on light and dark panels. */
export const BADGE_LOOK: Record<BadgeId, { icon: LucideIcon; color: string }> = {
  opener: { icon: Megaphone, color: "#6366f1" },
  fearless: { icon: Zap, color: "#ef4444" },
  "fair-share": { icon: Scale, color: "#14b8a6" },
  "data-driven": { icon: ChartColumn, color: "#3b82f6" },
  "bridge-builder": { icon: Handshake, color: "#a855f7" },
  "held-ground": { icon: ShieldCheck, color: "#f97316" },
  anchor: { icon: Anchor, color: "#ec4899" },
  closer: { icon: CircleCheckBig, color: "#eab308" },
  smooth: { icon: AudioWaveform, color: "#22c55e" },
};

/** The colours of every badge, for the confetti. */
export const BADGE_COLORS = Object.values(BADGE_LOOK).map((look) => look.color);

const SIZES = {
  sm: { box: "size-10", icon: "size-[18px]", lock: "size-4" },
  lg: { box: "size-14", icon: "size-6", lock: "size-5" },
} as const;

/** A badge medallion: in its colour when earned, a muted shape with a lock when not. Decorative. */
export function BadgeIcon({ id, earned, size = "sm" }: { id: BadgeId; earned: boolean; size?: keyof typeof SIZES }) {
  const { icon: Icon, color } = BADGE_LOOK[id];
  const sizes = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full",
        sizes.box,
        !earned && "bg-panel-2 text-ink-3 ring-1 ring-line ring-inset",
      )}
      style={
        earned
          ? {
              color,
              background: `linear-gradient(145deg, ${tint(color, 30)}, ${tint(color, 10)})`,
              boxShadow: `inset 0 0 0 1.5px ${tint(color, 55)}, 0 6px 16px -8px ${tint(color, 70)}`,
            }
          : undefined
      }
    >
      <Icon className={cn(sizes.icon, !earned && "opacity-50")} strokeWidth={2.25} />
      {!earned && (
        <Lock
          className={cn("absolute -bottom-0.5 -right-0.5 rounded-full bg-panel p-0.5 text-ink-3 shadow-card", sizes.lock)}
        />
      )}
    </span>
  );
}
