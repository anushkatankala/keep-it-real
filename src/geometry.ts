import type { Document, Primitive } from "@gltf-transform/core";
import type { Bounds, UpAxis } from "./types.js";

export const AXES: readonly UpAxis[] = ["x", "y", "z"];

export type PlacedPrimitive = {
  primitive: Primitive;
  /** World matrix of the node the primitive is attached to, column-major. */
  matrix: number[];
};

export function axisIndex(axis: UpAxis): number {
  return AXES.indexOf(axis);
}

/** The two axes that remain once the vertical one is removed, in x,y,z order. */
export function horizontalAxes(upIndex: number): [number, number] {
  const remaining = [0, 1, 2].filter((axis) => axis !== upIndex);
  return [remaining[0]!, remaining[1]!];
}

/**
 * Aerial photogrammetry output is much wider than it is tall, so the shortest
 * extent is the vertical axis. ODM writes Z-up; glTF authoring tools write Y-up.
 */
export function shortestExtentAxis(bounds: Bounds): number {
  const extents = bounds.max.map((value, axis) => value - bounds.min[axis]!);
  return extents.indexOf(Math.min(...extents));
}

export function transformPoint(matrix: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!
  ];
}

export function collectPrimitives(document: Document): PlacedPrimitive[] {
  const found: PlacedPrimitive[] = [];
  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const matrix = [...node.getWorldMatrix()];
      for (const primitive of mesh.listPrimitives()) found.push({ primitive, matrix });
    });
  }
  return found;
}

/** Triangle corner indices, synthesised for non-indexed primitives. */
export function triangleIndices(primitive: Primitive): ArrayLike<number> {
  const indices = primitive.getIndices();
  if (indices) return indices.getArray()!;
  const count = positions(primitive).getCount();
  return Uint32Array.from({ length: count }, (_, i) => i);
}

export function positions(primitive: Primitive) {
  const accessor = primitive.getAttribute("POSITION");
  if (!accessor) throw new Error("Primitive has no POSITION attribute");
  return accessor;
}

export function countTriangles(primitives: readonly PlacedPrimitive[]): number {
  return primitives.reduce((sum, { primitive }) => sum + triangleIndices(primitive).length / 3, 0);
}
