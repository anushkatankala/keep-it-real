"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const { droneImages, setDroneImages } = useProject();
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

  return (
    <main className="min-h-screen px-8 pb-20 pt-40">
      <div className="mx-auto max-w-4xl">
        <section className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">
            Aerial property capture
          </p>
          <h1 className="mt-7 text-5xl font-light leading-tight tracking-tight text-ink">
            From drone imagery to a property you can walk through.
          </h1>
          <p className="mt-6 text-sm font-light leading-loose text-white/50">
            Begin with the complete exterior capture set.
          </p>
        </section>

        <GlassCard className="mt-14 p-3">
          <FileDropZone
            files={selectedFiles}
            label="Drop drone capture images"
            onFilesChange={handleFilesDrop}
            previews={localPreviews}
          />
        </GlassCard>

        {selectedFiles.length > 0 ? (
          <div className="mt-8 flex justify-end">
            <Button onClick={handleContinue}>Continue →</Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
