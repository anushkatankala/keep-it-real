import { unzipSync } from "fflate";

const NODE_ODM_GLB = "odm_texturing/odm_textured_model_geo.glb";

export function extractGlb(zipBytes: Uint8Array) {
  const entries = unzipSync(zipBytes, {
    filter: (file) => file.name === NODE_ODM_GLB
  });
  const glb = entries[NODE_ODM_GLB];
  if (!glb) {
    throw new Error(`NodeODM output did not contain ${NODE_ODM_GLB}. Ensure the gltf option is enabled.`);
  }
  return glb;
}
