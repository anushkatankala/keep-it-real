"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ANIMATED_ROUTES = new Set(["/", "/configure", "/results"]);

interface PageTransitionProps {
  children: ReactNode;
}

/** Animates transitions between the three steps of the property workflow. */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const shouldAnimate = ANIMATED_ROUTES.has(pathname);

  const initial =
    !shouldReduceMotion ? { opacity: 0, y: 10 } : { opacity: 0 };
  const exit =
    !shouldReduceMotion ? { opacity: 0, y: -6 } : { opacity: 0 };

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={pathname}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldAnimate ? exit : undefined}
        initial={shouldAnimate ? initial : false}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.1, 0.25, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
