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
  const { demoMode, droneImages } = useProject();
  const hasDroneImages = droneImages.files.length > 0;
  const canEnter = hasDroneImages || demoMode;

  useEffect(() => {
    if (!canEnter) {
      router.replace("/");
    }
  }, [canEnter, router]);

  return canEnter ? children : null;
}
