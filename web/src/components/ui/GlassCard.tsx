import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "upload";
}

const VARIANT_STYLES: Record<
  NonNullable<GlassCardProps["variant"]>,
  string
> = {
  default: "border-white/[0.08] bg-white/[0.04] shadow-2xl shadow-black/50",
  upload: "",
};

const UPLOAD_GLASS_STYLE: CSSProperties = {
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  backdropFilter: "blur(24px) saturate(180%)",
  background: "rgba(255, 255, 255, 0.03)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px rgba(0,0,0,0.4)",
};

/** Renders its children inside a subtle, etched-glass surface. */
export function GlassCard({
  children,
  className = "",
  variant = "default",
  style,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl border backdrop-blur-xl ${VARIANT_STYLES[variant]} ${className}`}
      style={{
        ...(variant === "upload" ? UPLOAD_GLASS_STYLE : undefined),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
