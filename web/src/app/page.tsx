"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LandingBackdrop } from "@/components/layout/LandingBackdrop";
import { Button } from "@/components/ui/Button";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { GlassCard } from "@/components/ui/GlassCard";
import { useProject } from "@/context/ProjectContext";
import {
  createImagePreviews,
  revokeImagePreviews,
} from "@/utils/fileHelpers";

/** Presents the upload-first landing experience for drone capture images. */
export default function LandingPage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const {
    demoMode,
    droneImages,
    resetDemo,
    results,
    setDroneImages,
    startDemo,
  } = useProject();
  const hasDemoResults = demoMode && Boolean(results);
  const [selectedFiles, setSelectedFiles] = useState<File[]>(
    droneImages.files,
  );
  const [localPreviews, setLocalPreviews] = useState<string[]>([]);

  useEffect(() => {
    const nextPreviews = createImagePreviews(selectedFiles);
    setLocalPreviews(nextPreviews);

    return () => {
      revokeImagePreviews(nextPreviews);
    };
  }, [selectedFiles]);

  const handleFilesDrop = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleContinue = () => {
    setDroneImages(selectedFiles);
    router.push("/configure");
  };

  const handleDemo = () => {
    startDemo();
    router.push(hasDemoResults ? "/results" : "/demo");
  };

  const handleStartOver = () => {
    resetDemo();
    router.push("/demo");
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-8 pb-20 pt-40">
      <LandingBackdrop />
      <div className="relative z-10 mx-auto max-w-4xl">
        <section className="max-w-2xl">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 16 }
            }
            transition={{
              delay: 0,
              duration: 0.5,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">
              Aerial property capture
            </p>
          </motion.div>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mt-7"
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 16 }
            }
            transition={{
              delay: 0.08,
              duration: 0.5,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          >
            <h1 className="text-5xl font-light leading-tight tracking-tight text-ink">
              From drone imagery to a property you can walk through.
            </h1>
          </motion.div>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mt-6"
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 16 }
            }
            transition={{
              delay: 0.14,
              duration: 0.5,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          >
            <p className="text-sm font-light leading-loose text-white/40">
              Begin with the complete exterior capture set.
            </p>
          </motion.div>
        </section>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mt-14"
          initial={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 16 }
          }
          transition={{
            delay: 0.22,
            duration: 0.5,
            ease: [0.25, 0.1, 0.25, 1],
          }}
        >
          <GlassCard className="p-3" variant="upload">
            <FileDropZone
              files={selectedFiles}
              label="Drop drone capture images"
              onFilesChange={handleFilesDrop}
              previews={localPreviews}
            />
          </GlassCard>
        </motion.div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="text-xs uppercase tracking-[0.14em]"
              onClick={handleDemo}
              variant="ghost"
            >
              Explore demo
            </Button>
            {hasDemoResults ? (
              <Button onClick={handleStartOver} variant="ghost">
                Start over
              </Button>
            ) : null}
          </div>
          {selectedFiles.length > 0 ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 6 }
              }
              transition={{
                duration: 0.3,
                ease: [0.25, 0.1, 0.25, 1],
              }}
            >
              <Button
                className="text-xs uppercase tracking-[0.14em]"
                onClick={handleContinue}
                variant="ghost"
              >
                Continue
              </Button>
            </motion.div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
