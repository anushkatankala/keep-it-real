import assert from "node:assert/strict";
import test from "node:test";
import { Document, NodeIO } from "@gltf-transform/core";
import { cropGlb, glbFootprint } from "../dist/index.js";

/**
 * Two separate 2x2x3 m boxes, one at the origin and one 20 m away diagonally,
 * so the layout is wide in x and y and shallow in z like aerial output.
 * Cropping near the origin must keep the first and drop the second, which is
 * the "one house out of many" case.
 */
async function twoBoxesGlb() {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = [];
  const indices = [];

  for (const offset of [0, 20]) {
    const base = positions.length / 3;
    for (const [x, y, z] of [
      [0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0],
      [0, 0, 3], [2, 0, 3], [2, 2, 3], [0, 2, 3]
    ]) {
      positions.push(x + offset, y + offset, z);
    }
    for (const [a, b, c] of [
      [0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6]
    ]) {
      indices.push(base + a, base + b, base + c);
    }
  }

  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer)
    )
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer));

  const node = document.createNode().setMesh(document.createMesh().addPrimitive(primitive));
  document.createScene().addChild(node);
  return new NodeIO().writeBinary(document);
}

test("glbFootprint reports bounds and the vertical axis", async () => {
  const footprint = await glbFootprint(await twoBoxesGlb());

  assert.equal(footprint.up, "z", "z has the shortest extent");
  assert.deepEqual(footprint.horizontal, ["x", "y"]);
  assert.equal(footprint.triangles, 16);
  assert.deepEqual(footprint.bounds.min.map(Math.round), [0, 0, 0]);
  assert.deepEqual(footprint.bounds.max.map(Math.round), [22, 22, 3]);
  assert.equal(footprint.heights.length, footprint.width * footprint.height);
  assert.equal(Math.max(...footprint.heights), 3, "tallest cell is the 3 m box roof");
});

test("cropGlb keeps only the geometry inside the region", async () => {
  const result = await cropGlb(await twoBoxesGlb(), {
    region: { minU: -1, minV: -1, maxU: 3, maxV: 3 }
  });

  assert.equal(result.keptTriangles, 8, "one of the two boxes survives");
  assert.equal(result.totalTriangles, 16);
  assert.equal(result.up, "z");
  assert.ok(result.bounds.max[0] <= 3, `cropped model should not reach the far box, got ${result.bounds.max[0]}`);

  const footprint = await glbFootprint(result.glb);
  assert.equal(footprint.triangles, 8, "output GLB re-reads with the kept geometry");
});

test("cropGlb accepts a region given in any corner order", async () => {
  const glb = await twoBoxesGlb();
  const forwards = await cropGlb(glb, { region: { minU: -1, minV: -1, maxU: 3, maxV: 3 } });
  const backwards = await cropGlb(glb, { region: { minU: 3, minV: 3, maxU: -1, maxV: -1 } });
  assert.equal(backwards.keptTriangles, forwards.keptTriangles);
});

test("cropGlb rotation is a no-op at 0 and 360 degrees", async () => {
  const glb = await twoBoxesGlb();
  const region = { minU: -1, minV: -1, maxU: 3, maxV: 3 };
  const plain = await cropGlb(glb, { region });
  const turned = await cropGlb(glb, { region: { ...region, rotation: 360 } });
  assert.equal(turned.keptTriangles, plain.keptTriangles);
});

test("cropGlb turns the rectangle about its own centre", async () => {
  const glb = await twoBoxesGlb();
  // A long narrow strip centred on the origin box. Pointing along u it runs
  // past the far box without touching it; turned 45 degrees it aims straight
  // down the diagonal at it. The boxes are 28 m apart, so the strip is long
  // enough to reach either way and only the angle decides.
  const strip = { minU: -29, maxU: 31, minV: 0, maxV: 2 };

  const along = await cropGlb(glb, { region: strip });
  assert.equal(along.keptTriangles, 8, "strip along u keeps only the origin box");
  assert.ok(along.bounds.max[0] < 5, `should not reach the far box, got max x ${along.bounds.max[0]}`);

  const diagonal = await cropGlb(glb, { region: { ...strip, rotation: 45 } });
  assert.ok(
    diagonal.bounds.max[0] > 15,
    `a 45 degree strip should reach the far box at x=20, got max x ${diagonal.bounds.max[0]}`
  );
});

test("cropGlb rejects a non-finite rotation", async () => {
  await assert.rejects(
    cropGlb(await twoBoxesGlb(), {
      region: { minU: -1, minV: -1, maxU: 3, maxV: 3, rotation: Number.NaN }
    }),
    /rotation must be a finite number/
  );
});

test("cropGlb rejects an empty region instead of writing an empty model", async () => {
  await assert.rejects(
    cropGlb(await twoBoxesGlb(), { region: { minU: 500, minV: 500, maxU: 600, maxV: 600 } }),
    /No geometry inside region/
  );
});

test("cropGlb reuses vertices only where they are still referenced", async () => {
  const result = await cropGlb(await twoBoxesGlb(), {
    region: { minU: -1, minV: -1, maxU: 3, maxV: 3 }
  });

  const document = await new NodeIO().readBinary(result.glb);
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const vertices = primitive.getAttribute("POSITION").getCount();
      const highest = primitive.getIndices().getArray().reduce((max, value) => Math.max(max, value), 0);
      assert.ok(highest < vertices, `index ${highest} must be within ${vertices} vertices`);
      assert.equal(vertices, 8, "only the surviving box's vertices are copied across");
    }
  }
});
