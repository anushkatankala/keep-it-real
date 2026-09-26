import { Logger, NodeIO, Verbosity } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { createDecoderModule, createEncoderModule } from "draco3dgltf";

let cached: Promise<NodeIO> | null = null;

/**
 * A GLB reader/writer configured for ODM output, which is Draco-compressed.
 *
 * Building the Draco WebAssembly modules costs hundreds of milliseconds, so the
 * configured instance is cached and shared. Safe to await on every request.
 */
export function glbIo(): Promise<NodeIO> {
  cached ??= build();
  return cached;
}

async function build() {
  const [decoder, encoder] = await Promise.all([createDecoderModule(), createEncoderModule()]);
  return new NodeIO()
    .setLogger(new Logger(Verbosity.ERROR))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": decoder,
      "draco3d.encoder": encoder
    });
}

export function toBytes(glb: Uint8Array | ArrayBuffer): Uint8Array {
  return glb instanceof Uint8Array ? glb : new Uint8Array(glb);
}
