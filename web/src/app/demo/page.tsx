"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
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
    <main className="relative h-screen overflow-hidden bg-black">
      <iframe
        allow="fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
        src={`${CROP_ORIGIN}/`}
        title="Crop the example house"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-6 py-5">
        <p className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
          Example · draw a box, crop, then continue
        </p>
        <a
          className="pointer-events-auto text-xs text-white/45 hover:text-white"
          href="/"
        >
          ← Back
        </a>
      </div>

      {cropReady ? (
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-black via-black/80 to-transparent px-6 pb-8 pt-16">
          <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
            <p className="text-sm font-light text-white/70">
              Crop saved
              {cropReady.kept && cropReady.total
                ? ` · ${cropReady.kept.toLocaleString()} of ${cropReady.total.toLocaleString()} triangles`
                : ""}
              . Next, review the example floor plan and rooms.
            </p>
            <Button disabled={isAdvancing} onClick={handleContinue}>
              {isAdvancing ? "Loading floor plan…" : "Continue to floor plan →"}
            </Button>
            {error ? (
              <p className="text-xs text-red-300" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : error ? (
        <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
          <p className="max-w-lg text-center text-xs text-red-300" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </main>
  );
}
