import type { NodeOdmOption } from "./types.js";

export function defaultNodeOdmOptions(quality: "standard" | "high"): NodeOdmOption[] {
  return [
    { name: "dsm", value: true },
    { name: "gltf", value: true },
    { name: "cog", value: true },
    { name: "resize-to", value: quality === "high" ? 4096 : 2048 },
    { name: "orthophoto-resolution", value: quality === "high" ? 2 : 5 },
    { name: "feature-quality", value: "high" },
    { name: "pc-quality", value: quality === "high" ? "high" : "medium" }
  ];
}
