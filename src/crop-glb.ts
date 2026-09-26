import { getBounds, type Accessor, type Document } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import {
  AXES,
  axisIndex,
  collectPrimitives,
  countTriangles,
  horizontalAxes,
  positions,
  shortestExtentAxis,
  transformPoint,
  triangleIndices,
  type PlacedPrimitive
} from "./geometry.js";
import { glbIo, toBytes } from "./glb-io.js";
import type { Bounds, CropGlbOptions, CropGlbResult, CropRegion } from "./types.js";

/**
 * Keep only the geometry inside a ground-plane rectangle and return a new GLB.
 *
 * Takes and returns bytes so it can run in a request handler without touching
 * the filesystem. Photogrammetry meshes join buildings to a single ground
 * surface, so this is a spatial cut: expect some surrounding terrain.
 */
export async function cropGlb(
  glb: Uint8Array | ArrayBuffer,
  options: CropGlbOptions
): Promise<CropGlbResult> {
  const region = normaliseRegion(options.region);
  const io = await glbIo();
  const document = await io.readBinary(toBytes(glb));
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB contains no scene");

  const upIndex = options.up ? axisIndex(options.up) : shortestExtentAxis(getBounds(scene) as Bounds);
  const primitives = collectPrimitives(document);
  const totalTriangles = countTriangles(primitives);
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();

  let keptTriangles = 0;
  for (const placed of primitives) {
    const kept = cropPrimitive(document, buffer, placed, region, upIndex, options.select ?? "centroid");
    keptTriangles += kept;
    if (kept === 0) placed.primitive.dispose();
  }

  if (keptTriangles === 0) {
    throw new Error(
      `No geometry inside region ${region.minU},${region.minV} to ${region.maxU},${region.maxV} ` +
        `at ${region.rotation}°. Use glbFootprint to check the model's bounds.`
    );
  }

  for (const mesh of document.getRoot().listMeshes()) {
    if (mesh.listPrimitives().length === 0) mesh.dispose();
  }
  await document.transform(prune());

  return {
    glb: await io.writeBinary(document),
    up: AXES[upIndex]!,
    bounds: getBounds(document.getRoot().listScenes()[0]!) as Bounds,
    keptTriangles,
    totalTriangles
  };
}

function normaliseRegion(region: CropRegion): Required<CropRegion> {
  const values = [region.minU, region.minV, region.maxU, region.maxV];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Crop region must contain four finite numbers");
  }
  const rotation = region.rotation ?? 0;
  if (!Number.isFinite(rotation)) throw new Error("Crop region rotation must be a finite number of degrees");

  return {
    minU: Math.min(region.minU, region.maxU),
    minV: Math.min(region.minV, region.maxV),
    maxU: Math.max(region.minU, region.maxU),
    maxV: Math.max(region.minV, region.maxV),
    rotation
  };
}

/**
 * Tests points against the region, turning them into its frame first when it
 * is rotated. The unrotated path keeps the plain comparison so results are
 * bit-identical to a crop with no rotation.
 */
function regionTest(region: Required<CropRegion>) {
  if (region.rotation === 0) {
    return (u: number, v: number) =>
      u >= region.minU && u <= region.maxU && v >= region.minV && v <= region.maxV;
  }

  const centreU = (region.minU + region.maxU) / 2;
  const centreV = (region.minV + region.maxV) / 2;
  const halfU = (region.maxU - region.minU) / 2;
  const halfV = (region.maxV - region.minV) / 2;
  const radians = (-region.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return (u: number, v: number) => {
    const du = u - centreU;
    const dv = v - centreV;
    return Math.abs(du * cos - dv * sin) <= halfU && Math.abs(du * sin + dv * cos) <= halfV;
  };
}

function allocateLike(source: ArrayLike<number>, length: number) {
  const Constructor = (source as unknown as { constructor: new (size: number) => ArrayLike<number> }).constructor;
  return new Constructor(length) as unknown as { [index: number]: number; length: number };
}

/** Rewrites the primitive in place; returns the number of triangles kept. */
function cropPrimitive(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  placed: PlacedPrimitive,
  region: Required<CropRegion>,
  upIndex: number,
  select: "centroid" | "overlapping"
): number {
  const { primitive, matrix } = placed;
  const [uAxis, vAxis] = horizontalAxes(upIndex);
  const accessor = positions(primitive);
  const array = accessor.getArray()!;
  const indices = triangleIndices(primitive);

  const flat = new Float64Array(accessor.getCount() * 2);
  for (let i = 0; i < accessor.getCount(); i++) {
    const point = transformPoint(matrix, array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!);
    flat[i * 2] = point[uAxis]!;
    flat[i * 2 + 1] = point[vAxis]!;
  }

  const contains = regionTest(region);
  const inside = (index: number) => contains(flat[index * 2]!, flat[index * 2 + 1]!);

  const kept: number[] = [];
  for (let corner = 0; corner < indices.length; corner += 3) {
    const a = indices[corner]!;
    const b = indices[corner + 1]!;
    const c = indices[corner + 2]!;
    const keep =
      select === "overlapping"
        ? inside(a) || inside(b) || inside(c)
        : contains(
            (flat[a * 2]! + flat[b * 2]! + flat[c * 2]!) / 3,
            (flat[a * 2 + 1]! + flat[b * 2 + 1]! + flat[c * 2 + 1]!) / 3
          );
    if (keep) kept.push(a, b, c);
  }

  if (kept.length === 0) return 0;

  const remap = new Map<number, number>();
  const newIndices = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const original = kept[i]!;
    let mapped = remap.get(original);
    if (mapped === undefined) {
      mapped = remap.size;
      remap.set(original, mapped);
    }
    newIndices[i] = mapped;
  }

  for (const semantic of primitive.listSemantics()) {
    primitive.setAttribute(semantic, remapAttribute(document, buffer, primitive.getAttribute(semantic)!, remap));
  }
  primitive.setIndices(document.createAccessor().setType("SCALAR").setArray(newIndices).setBuffer(buffer));
  return kept.length / 3;
}

/** Copies only the vertices that survived, so no orphans are left in the buffer. */
function remapAttribute(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  accessor: Accessor,
  remap: Map<number, number>
): Accessor {
  const source = accessor.getArray()!;
  const components = accessor.getElementSize();
  const target = allocateLike(source, remap.size * components);

  for (const [original, mapped] of remap) {
    for (let component = 0; component < components; component++) {
      target[mapped * components + component] = source[original * components + component]!;
    }
  }

  return document
    .createAccessor()
    .setType(accessor.getType())
    .setNormalized(accessor.getNormalized())
    .setArray(target as unknown as Parameters<Accessor["setArray"]>[0])
    .setBuffer(buffer);
}
