const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);

const ACCEPTED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "tif",
  "tiff",
]);

export const IMAGE_INPUT_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.tif,.tiff,image/jpeg,image/png,image/webp,image/tiff";

export interface ValidatedFiles {
  accepted: File[];
  rejectedCount: number;
}

/** Filters a file list to the image formats supported by the property workflow. */
export const validateImageFiles = (
  files: FileList | File[],
): ValidatedFiles => {
  const candidates = Array.from(files);
  const accepted = candidates.filter((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return (
      ACCEPTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase()) ||
      ACCEPTED_IMAGE_EXTENSIONS.has(extension)
    );
  });

  return {
    accepted,
    rejectedCount: candidates.length - accepted.length,
  };
};

/** Creates local browser URLs used for image thumbnails. */
export const createImagePreviews = (files: File[]): string[] =>
  files.map((file) => URL.createObjectURL(file));

/** Releases local browser URLs after replacement or provider teardown. */
export const revokeImagePreviews = (previews: string[]): void => {
  previews.forEach((preview) => URL.revokeObjectURL(preview));
};
