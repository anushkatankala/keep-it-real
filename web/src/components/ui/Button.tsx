import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost";
}

const VARIANT_STYLES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "border-white bg-white text-black hover:bg-white/85 disabled:hover:bg-white",
  ghost:
    "border-white/20 bg-transparent text-white/70 hover:border-white/40 hover:text-white",
};

/** Renders a primary or ghost action button with native button props. */
export function Button({
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded-lg border px-5 py-3 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-30 ${VARIANT_STYLES[variant]} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
