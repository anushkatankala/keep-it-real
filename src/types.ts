export type ImageInput = {
  /** Filename sent to NodeODM, including its extension. */
  name: string;
  /** Original image bytes. A browser File is also accepted because it is a Blob. */
  data: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
};

export type NodeOdmOption = {
  name: string;
  value: string | number | boolean;
};

export type ReconstructionState = "queued" | "processing" | "ready";

export type ReconstructionProgress = {
  taskId: string;
  state: ReconstructionState;
  progress: number | null;
};

export type UpAxis = "x" | "y" | "z";

export type Vec3 = [number, number, number];

export type Bounds = { min: Vec3; max: Vec3 };

/**
 * A rectangle on the ground plane, in the GLB's own units (metres, for ODM
 * output). `u` and `v` are the two non-vertical axes, reported as
 * `horizontal` by `glbFootprint`.
 */
export type CropRegion = {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  /**
   * Degrees to turn the rectangle about its own centre, anticlockwise seen
   * from above. Buildings are rarely square to the world axes, so a turned
   * rectangle fits one far more tightly. Defaults to 0.
   */
  rotation?: number;
};

export type CropGlbOptions = {
  region: CropRegion;
  /** Defaults to the axis with the shortest extent. */
  up?: UpAxis;
  /** Keep triangles whose centre is inside the region, or any that touch it. */
  select?: "centroid" | "overlapping";
};

export type CropGlbResult = {
  glb: Uint8Array;
  up: UpAxis;
  /** Bounds of the cropped model, all three axes. */
  bounds: Bounds;
  keptTriangles: number;
  totalTriangles: number;
};

export type GlbFootprintOptions = {
  up?: UpAxis;
  /** Cells across the longer horizontal axis. Default 96. */
  resolution?: number;
};

/**
 * A top-down summary of a GLB, for letting a user pick a region. `heights`
 * outlines rooftops far better than `density` does; both are row-major grids of
 * `width * height` cells. Use `Array.from` to make them JSON-safe.
 */
export type GlbFootprint = {
  up: UpAxis;
  /** Which axes the `u` and `v` grid directions correspond to. */
  horizontal: [UpAxis, UpAxis];
  bounds: Bounds;
  width: number;
  height: number;
  /** Metres above the lowest point in the model; 0 where there is no geometry. */
  heights: Float32Array;
  /** Vertex count per cell. */
  density: Float32Array;
  triangles: number;
  primitives: number;
};

export type ImagesToGlbOptions = {
  /** NodeODM origin, for example http://127.0.0.1:3001. */
  nodeOdmUrl: string;
  token?: string;
  label?: string;
  quality?: "standard" | "high";
  /** Replaces the built-in roof-oriented NodeODM options when provided. */
  nodeOdmOptions?: NodeOdmOption[];
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (update: ReconstructionProgress) => void;
};
