"use client";

import type { ReactNode } from "react";

import { ProjectProvider } from "@/context/ProjectContext";

interface ProvidersProps {
  children: ReactNode;
}

/** Mounts client-side application providers around all routed content. */
export function Providers({ children }: ProvidersProps) {
  return <ProjectProvider>{children}</ProjectProvider>;
}
