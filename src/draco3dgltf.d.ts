declare module "draco3dgltf" {
  export function createDecoderModule(options?: object): Promise<unknown>;
  export function createEncoderModule(options?: object): Promise<unknown>;
}
