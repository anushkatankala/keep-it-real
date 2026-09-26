# images-to-glb

A small server-side TypeScript package exposing one public function:

```ts
imagesToGlb(images, options): Promise<Uint8Array>
```

It sends overlapping source photographs to a NodeODM worker, waits for the
photogrammetry task to finish, downloads the output archive, and returns the
textured GLB bytes. It contains no Next.js, Prisma, authentication, UI, or
Aernova-specific job code.

## Requirements

- Node.js 20 or newer
- A reachable NodeODM worker
- Several overlapping photographs of the same building; original geotagged
  drone JPEGs generally give the best result

For a local worker:

```bash
docker run --rm -p 3001:3000 opendronemap/nodeodm
```

## Quick start

`dist/` is not committed, so build it after installing:

```bash
npm install
npm run build
```

Then, with a NodeODM worker running, turn a folder of photos into a GLB:

```bash
node run.mjs ./photos --out house.glb
```

A reconstruction covers everything the cameras saw, so to keep a single
building either crop it in the browser:

```bash
node server.mjs house.glb     # then open http://127.0.0.1:5173
```

or from the command line, where running without a region prints a top-down
map to read coordinates off:

```bash
node crop.mjs house.glb
node crop.mjs house.glb --center -9,-8 --size 24 --rotate 12 --out house-only.glb
```

## Usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import { imagesToGlb } from "images-to-glb";

const paths = ["./photos/001.jpg", "./photos/002.jpg", "./photos/003.jpg"];
const images = await Promise.all(
  paths.map(async (path) => ({
    name: path.split("/").at(-1)!,
    data: await readFile(path),
    contentType: "image/jpeg"
  }))
);

const glb = await imagesToGlb(images, {
  nodeOdmUrl: "http://127.0.0.1:3001",
  quality: "standard",
  onProgress: ({ state, progress }) => {
    console.log(state, progress ?? "");
  }
});

await writeFile("house.glb", glb);
```

In a browser upload handler, convert each `File` into an input while keeping
the function itself on the server:

```ts
const images = files.map((file) => ({
  name: file.name,
  data: file,
  contentType: file.type
}));
```

## Cropping to one building

Photogrammetry reconstructs everything the cameras saw, so a GLB of one house
usually contains its neighbours too. Two further functions trim it, and both
take and return bytes so they can run inside a request handler:

```ts
glbFootprint(glb, options): Promise<GlbFootprint>
cropGlb(glb, options): Promise<CropGlbResult>
```

`glbFootprint` summarises the model as a top-down grid, for letting a user
choose a region. `heights` (metres above the lowest point) outlines rooftops
much more clearly than `density` does, so it is the better basis for a picker
UI. `horizontal` names the two axes the grid's `u` and `v` directions
correspond to; the third is vertical and is inferred from the shortest extent
unless you pass `up`.

```ts
const footprint = await glbFootprint(glb, { resolution: 128 });
// { up: "z", horizontal: ["x", "y"], bounds, width, height, heights, density }
```

`cropGlb` keeps the geometry inside a ground-plane rectangle given in the
model's own units. `region` is plain JSON, so it can come straight from a
request body:

```ts
const { glb: cropped, keptTriangles, totalTriangles } = await cropGlb(glb, {
  region: { minU: -16, minV: -18, maxU: -2, maxV: 2 }
});
```

Buildings are rarely square to the world axes, so `region.rotation` turns the
rectangle about its own centre, in degrees anticlockwise seen from above. It
fits a building far more tightly than an axis-aligned box, and leaves results
bit-identical to an unrotated crop when it is 0:

```ts
await cropGlb(glb, {
  region: { minU: -16, minV: -18, maxU: -2, maxV: 2, rotation: 12 }
});
```

A minimal server route:

```ts
export async function POST(request: Request) {
  const { glbUrl, region } = await request.json();
  const source = await fetch(glbUrl).then((response) => response.arrayBuffer());
  const { glb } = await cropGlb(source, { region });
  return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
}
```

Notes for web use:

- Both functions accept `Uint8Array` or `ArrayBuffer` and never touch the
  filesystem. `cropGlb` resolves with the new GLB in `result.glb`.
- The Draco codecs ODM output requires are compiled once and shared across
  calls. The first call pays a few hundred milliseconds; later ones do not.
- `heights` and `density` are `Float32Array`s. Use `Array.from` to put them in
  a JSON response, or send them as binary.
- Buildings sit on one continuous ground mesh, so this is a rectangular cut and
  keeps some surrounding terrain. Pass `select: "overlapping"` to keep every
  triangle touching the region instead of only those centred inside it.
- Cropping does not shrink textures. Most of a GLB's size is its texture
  atlases, and the surviving geometry can still reference all of them.

`node crop.mjs <input.glb>` is a thin command-line wrapper over these two
functions that draws the footprint as ASCII; run it with `--help` for options.

## Notes

- This function waits for a long-running external NodeODM task. Call it from a
  background worker or a server runtime with a sufficiently long timeout.
- The returned value is the exact NodeODM output at
  `odm_texturing/odm_textured_model_geo.glb`.
- The package intentionally does not perform database writes or permanent
  object-storage uploads. The caller decides where to save the returned bytes.
- Pass an `AbortSignal` as `signal` to cancel waiting or network requests.
