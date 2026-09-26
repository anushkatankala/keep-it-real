"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useProject } from "@/context/ProjectContext";

interface RouteGuardProps {
  children: ReactNode;
}

/** Shows protected workflow content only when drone images exist in context. */
export function RouteGuard({ children }: RouteGuardProps) {
  const router = useRouter();
  const { droneImages } = useProject();
  const hasDroneImages = droneImages.files.length > 0;

  useEffect(() => {
    if (!hasDroneImages) {
      router.replace("/");
    }
  }, [hasDroneImages, router]);

  return hasDroneImages ? children : null;
}
