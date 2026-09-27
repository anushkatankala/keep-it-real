"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  CROP_ORIGIN,
  loadDemoFixture,
  type DemoProjectInput,
} from "@/constants/demo";
import { useProject } from "@/context/ProjectContext";
import type { CropRegion } from "@/types";

interface CropPayload {
  region?: CropRegion;
  kept?: number | null;
  total?: number | null;
}

const isCropOrigin = (origin: string) =>
  origin === CROP_ORIGIN || origin === "http://localhost:5173";

/** Full-viewport crop step: embed the existing GLB viewer, then advance. */
export default function DemoCropPage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const { applyDemoProject, startDemo } = useProject();
  const [cropReady, setCropReady] = useState<CropPayload | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixtureRef = useRef<Promise<DemoProjectInput> | null>(null);

  useEffect(() => {
    startDemo();
    fixtureRef.current = loadDemoFixture(null).catch((reason: unknown) => {
      throw reason;
    });
  }, [startDemo]);

  const advance = useCallback(
    async (payload: CropPayload | null) => {
      if (isAdvancing) return;
      setIsAdvancing(true);
      setError(null);
      try {
        const region = payload?.region ?? null;
        const fixture = fixtureRef.current
          ? await fixtureRef.current
          : await loadDemoFixture(region);
        applyDemoProject({ ...fixture, cropRegion: region });
        router.push("/configure");
      } catch (reason) {
        setIsAdvancing(false);
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load the example floor plan.",
        );
      }
    },
    [applyDemoProject, isAdvancing, router],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isCropOrigin(event.origin)) return;
      const type = event.data?.type;
      const payload = (event.data?.payload ?? null) as CropPayload | null;
      if (type === "CROP_DONE") {
        setCropReady(payload);
      }
      if (type === "CROP_RESET") {
        setCropReady(null);
      }
      if (type === "CROP_CONTINUE") {
        void advance(payload);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [advance]);

  const handleContinue = () => {
    void advance(cropReady);
  };

  return (
    <main className="relative h-screen overflow-hidden bg-canvas">
      <iframe
        allow="fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
        src={`${CROP_ORIGIN}/`}
        title="Crop the example house"
      />

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-end px-10 py-5"
        initial={
          shouldReduceMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -6 }
        }
        transition={{
          duration: 0.4,
          ease: [0.25, 0.1, 0.25, 1],
        }}
      >
        <Link
          className="pointer-events-auto text-[10px] font-light uppercase tracking-[0.18em] text-white/40 transition-colors duration-200 hover:text-white/75"
          href="/"
        >
          Back
        </Link>
      </motion.div>

      {cropReady ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-8 pb-8">
          <GlassCard
            className="pointer-events-auto flex w-full max-w-xl flex-col items-center gap-4 p-6 text-center"
            variant="upload"
          >
            <p className="text-[10px] font-light uppercase tracking-[0.2em] text-white/35">
              Selection ready
            </p>
            <p className="text-sm font-light text-white/70">
              Crop saved
              {cropReady.kept && cropReady.total
                ? ` · ${cropReady.kept.toLocaleString()} of ${cropReady.total.toLocaleString()} triangles`
                : ""}
              . Next, review the example floor plan and rooms.
            </p>
            <Button
              className="text-xs uppercase tracking-[0.14em]"
              disabled={isAdvancing}
              onClick={handleContinue}
              variant="ghost"
            >
              {isAdvancing ? "Loading floor plan…" : "Continue"}
            </Button>
            {error ? (
              <p className="text-xs font-light text-white/45" role="alert">
                {error}
              </p>
            ) : null}
          </GlassCard>
        </div>
      ) : error ? (
        <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
          <GlassCard className="max-w-lg px-5 py-4 text-center">
            <p className="text-xs font-light text-white/55" role="alert">
              {error}
            </p>
          </GlassCard>
        </div>
      ) : null}
    </main>
  );
}
