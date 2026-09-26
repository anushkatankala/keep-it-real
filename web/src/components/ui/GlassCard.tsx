import type { HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Renders its children inside a subtle, etched-glass surface. */
export function GlassCard({
  children,
  className = "",
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-2xl shadow-black/50 backdrop-blur-xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
