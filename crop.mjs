#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cropGlb, glbFootprint } from "./dist/index.js";

const RAMP = " .:-=+*#%@";

const USAGE = `
Usage: node crop.mjs <input.glb> [options]

With no --box or --center, prints a top-down map of the model so you can read
off the coordinates of the house you want to keep.

Options:
  --box <a,b,c,d>    Keep region minU,minV,maxU,maxV in horizontal coordinates
  --center <u,v>     Keep a square centred here; use with --size
  --size <meters>    Side length of the --center square
  --rotate <degrees> Turn the box about its centre, anticlockwise (default: 0)
  --up <x|y|z>       Vertical axis          (default: the shortest extent)
  --select <mode>    "centroid" or "overlapping"  (default: centroid)
  --out <path>       Output GLB             (default: <input>-cropped.glb)
  --map <kind>       "height" or "density"  (default: height)
  --width <cols>     Map width in columns   (default: 78)
  --help             Show this message

Examples:
  node crop.mjs house.glb
  node crop.mjs house.glb --center -12,-8 --size 30
  node crop.mjs house.glb --box -16,-18,-2,2 --out house-only.glb
`.trim();

function parseArgs(argv) {
  const args = { mapWidth: 78, map: "height" };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    const numbers = (count) => {
      const parts = next().split(",").map((part) => Number(part.trim()));
      if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) {
        throw new Error(`${arg} expects ${count} comma-separated numbers`);
      }
      return parts;
    };

    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--box") args.box = numbers(4);
    else if (arg === "--center") args.center = numbers(2);
    else if (arg === "--size") args.size = Number(next());
    else if (arg === "--rotate") args.rotation = Number(next());
    else if (arg === "--up") args.up = next().toLowerCase();
    else if (arg === "--select") args.select = next().toLowerCase();
    else if (arg === "--out") args.out = next();
    else if (arg === "--map") args.map = next().toLowerCase();
    else if (arg === "--width") args.mapWidth = Number(next());
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (args.input === undefined) args.input = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }

  if (!args.input) throw new Error("An input .glb path is required");
  if (args.map !== "height" && args.map !== "density") throw new Error(`--map must be "height" or "density"`);
  if (args.center && !Number.isFinite(args.size)) throw new Error("--center requires --size");
  if (args.box && args.center) throw new Error("Use either --box or --center, not both");

  if (args.center) {
    const half = args.size / 2;
    args.box = [args.center[0] - half, args.center[1] - half, args.center[0] + half, args.center[1] + half];
  }
  args.out ??= args.input.replace(/\.glb$/i, "") + "-cropped.glb";
  return args;
}

function regionFrom(box, rotation) {
  return { minU: box[0], minV: box[1], maxU: box[2], maxV: box[3], rotation: rotation ?? 0 };
}

function printMap(footprint, kind) {
  const { width, height, bounds, horizontal } = footprint;
  const grid = kind === "height" ? footprint.heights : footprint.density;
  const [uName, vName] = horizontal;
  const uAxis = "xyz".indexOf(uName);
  const vAxis = "xyz".indexOf(vName);
  const uMin = bounds.min[uAxis];
  const uMax = bounds.max[uAxis];
  const vMin = bounds.min[vAxis];
  const vMax = bounds.max[vAxis];
  const peak = grid.reduce((max, value) => Math.max(max, value), 0) || 1;

  console.log(`\nTop-down view: ${uName} across, ${vName} down the page, ${footprint.up} is vertical.`);
  console.log(
    kind === "height"
      ? `Height above the lowest point, 0 to ${peak.toFixed(1)} m. Rooftops are the bright '%@' shapes; roads and lawns are dark '.:'.`
      : `Vertices per cell — dense areas ('%@') carry the most detail.`
  );
  console.log();

  const labelWidth = 9;
  const pad = " ".repeat(labelWidth);

  // Terminal cells are about twice as tall as they are wide, so fold row pairs.
  for (let row = 0; row < height; row += 2) {
    const v = vMax - ((row + 1) / height) * (vMax - vMin);
    const label = row % 8 === 0 ? v.toFixed(1).padStart(labelWidth - 2) + " ┤" : pad.slice(0, labelWidth - 2) + " │";
    let line = "";
    for (let column = 0; column < width; column++) {
      const value = Math.max(grid[row * width + column], grid[(row + 1) * width + column] ?? 0);
      const fraction = kind === "height" ? value / peak : Math.log1p(value) / Math.log1p(peak);
      line += value === 0 ? RAMP[0] : RAMP[Math.max(1, Math.round(fraction * (RAMP.length - 1)))];
    }
    console.log(label + line);
  }

  console.log(pad.slice(0, labelWidth - 2) + " └" + "─".repeat(width));
  let ticks = pad;
  for (let column = 0; column < width; column += 13) {
    ticks += (uMin + ((column + 0.5) / width) * (uMax - uMin)).toFixed(1).padEnd(13);
  }
  console.log(ticks.slice(0, labelWidth + width));
  console.log(
    `\n${uName} ranges ${uMin.toFixed(1)} to ${uMax.toFixed(1)} (${(uMax - uMin).toFixed(1)} m), ` +
      `${vName} ranges ${vMin.toFixed(1)} to ${vMax.toFixed(1)} (${(vMax - vMin).toFixed(1)} m)`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const bytes = await readFile(args.input);

  if (!args.box) {
    const footprint = await glbFootprint(bytes, { up: args.up, resolution: args.mapWidth });
    console.log(
      `${args.input}: ${footprint.primitives} primitive(s), ${footprint.triangles.toLocaleString()} triangles`
    );
    if (!args.up) console.log(`Treating ${footprint.up} as vertical (shortest extent). Override with --up.`);
    printMap(footprint, args.map);

    const [uAxis, vAxis] = footprint.horizontal.map((name) => "xyz".indexOf(name));
    const midU = (footprint.bounds.min[uAxis] + footprint.bounds.max[uAxis]) / 2;
    const midV = (footprint.bounds.min[vAxis] + footprint.bounds.max[vAxis]) / 2;
    console.log(
      `\nRead the ${footprint.horizontal.join(" and ")} of your house off the axes, then crop, e.g.:\n` +
        `  node crop.mjs ${args.input} --center ${midU.toFixed(1)},${midV.toFixed(1)} --size 30`
    );
    return;
  }

  const result = await cropGlb(bytes, {
    region: regionFrom(args.box, args.rotation),
    up: args.up,
    select: args.select
  });

  await writeFile(args.out, result.glb);
  console.log(
    `Kept ${result.keptTriangles.toLocaleString()} of ${result.totalTriangles.toLocaleString()} triangles ` +
      `(${((result.keptTriangles / result.totalTriangles) * 100).toFixed(1)}%)`
  );
  printMap(await glbFootprint(result.glb, { up: result.up, resolution: 60 }), args.map);
  console.log(`\nWrote ${resolve(args.out)}`);
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  if (error?.message?.includes("input .glb path is required")) console.error(`\n${USAGE}`);
  process.exit(1);
}
