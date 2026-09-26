import { createTask, downloadAllZip } from "./nodeodm-client.js";
import { extractGlb } from "./extract-glb.js";
import { defaultNodeOdmOptions } from "./options.js";
import type { ImageInput, ImagesToGlbOptions } from "./types.js";
import { waitForTask } from "./wait-for-task.js";

/**
 * Submit overlapping source photos to NodeODM and resolve with the generated
 * textured GLB bytes. Run this on a server; photogrammetry commonly takes
 * several minutes and can produce large archives.
 */
export async function imagesToGlb(
  images: readonly ImageInput[],
  options: ImagesToGlbOptions
): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("At least one image is required");
  if (!options.nodeOdmUrl) throw new Error("nodeOdmUrl is required");

  const quality = options.quality ?? "standard";
  const client = {
    baseUrl: options.nodeOdmUrl,
    token: options.token,
    signal: options.signal
  };
  const taskId = await createTask(images, {
    ...client,
    label: options.label ?? "Photogrammetry reconstruction",
    options: options.nodeOdmOptions ?? defaultNodeOdmOptions(quality)
  });

  await waitForTask(taskId, {
    ...client,
    pollIntervalMs: options.pollIntervalMs ?? 5_000,
    timeoutMs: options.timeoutMs ?? 2 * 60 * 60 * 1_000,
    onProgress: options.onProgress
  });

  return extractGlb(await downloadAllZip(taskId, client));
}
