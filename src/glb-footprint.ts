import { getBounds } from "@gltf-transform/core";
import {
  AXES,
  axisIndex,
  collectPrimitives,
  countTriangles,
  horizontalAxes,
  positions,
  shortestExtentAxis,
  transformPoint
} from "./geometry.js";
import { glbIo, toBytes } from "./glb-io.js";
import type { Bounds, GlbFootprint, GlbFootprintOptions } from "./types.js";

/**
 * Summarise a GLB as a top-down grid so a caller can choose a crop region
 * without loading the geometry itself. Cheap enough to run per upload.
 */
export async function glbFootprint(
  glb: Uint8Array | ArrayBuffer,
  options: GlbFootprintOptions = {}
): Promise<GlbFootprint> {
  const io = await glbIo();
  const document = await io.readBinary(toBytes(glb));
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB contains no scene");

  const bounds = getBounds(scene) as Bounds;
  const upIndex = options.up ? axisIndex(options.up) : shortestExtentAxis(bounds);
  const [uAxis, vAxis] = horizontalAxes(upIndex);
  const resolution = Math.max(8, Math.floor(options.resolution ?? 96));

  const uSpan = bounds.max[uAxis]! - bounds.min[uAxis]! || 1;
  const vSpan = bounds.max[vAxis]! - bounds.min[vAxis]! || 1;
  const width = uSpan >= vSpan ? resolution : Math.max(8, Math.round((resolution * uSpan) / vSpan));
  const height = uSpan >= vSpan ? Math.max(8, Math.round((resolution * vSpan) / uSpan)) : resolution;

  const heights = new Float32Array(width * height);
  const density = new Float32Array(width * height);
  const ground = bounds.min[upIndex]!;
  const primitives = collectPrimitives(document);

  for (const { primitive, matrix } of primitives) {
    const accessor = positions(primitive);
    const array = accessor.getArray()!;
    for (let i = 0; i < accessor.getCount(); i++) {
      const point = transformPoint(matrix, array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!);
      const column = Math.min(width - 1, Math.max(0, Math.floor(((point[uAxis]! - bounds.min[uAxis]!) / uSpan) * width)));
      const row = Math.min(height - 1, Math.max(0, Math.floor(((bounds.max[vAxis]! - point[vAxis]!) / vSpan) * height)));
      const cell = row * width + column;
      heights[cell] = Math.max(heights[cell]!, point[upIndex]! - ground);
      density[cell]!++;
    }
  }

  return {
    up: AXES[upIndex]!,
    horizontal: [AXES[uAxis]!, AXES[vAxis]!],
    bounds,
    width,
    height,
    heights,
    density,
    triangles: countTriangles(primitives),
    primitives: primitives.length
  };
}
