"use client";

import { motion } from "motion/react";
import { Barlow_Condensed, Inter } from "next/font/google";

const barlowCondensed = Barlow_Condensed({
  display: "swap",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  weight: ["300", "400"],
});

/** Renders the persistent wordmark and a quiet product descriptor. */
export function Navbar() {
  return (
    <motion.nav
      animate={{ opacity: 1 }}
      className="absolute inset-x-0 top-0 z-40 flex w-full items-center justify-between border-b border-white/[0.05] bg-transparent px-10 py-5"
      initial={{ opacity: 0 }}
      transition={{
        duration: 0.5,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      <motion.span
        animate={{ opacity: 1, x: 0 }}
        className={`${barlowCondensed.className} inline-block uppercase`}
        initial={{ opacity: 0, x: -8 }}
        style={{
          background: "none",
          color: "rgba(255, 255, 255, 0.95)",
          fontSize: "15px",
          fontWeight: 600,
          letterSpacing: "0.25em",
          textShadow: "none",
          WebkitTextFillColor: "rgba(255, 255, 255, 0.95)",
        }}
        transition={{
          delay: 0.1,
          duration: 0.45,
          ease: [0.25, 0.1, 0.25, 1],
        }}
      >
        KEEP IT REAL
      </motion.span>
      <motion.span
        animate={{ opacity: 1, x: 0 }}
        className={`${inter.className} inline-block uppercase`}
        initial={{ opacity: 0, x: 8 }}
        style={{
          background: "none",
          color: "rgba(255, 255, 255, 0.3)",
          fontSize: "10px",
          fontWeight: 300,
          letterSpacing: "0.22em",
          textShadow: "none",
          WebkitTextFillColor: "rgba(255, 255, 255, 0.3)",
        }}
        transition={{
          delay: 0.15,
          duration: 0.45,
          ease: [0.25, 0.1, 0.25, 1],
        }}
      >
        SPATIAL PROPERTY SYSTEM
      </motion.span>
    </motion.nav>
  );
}
