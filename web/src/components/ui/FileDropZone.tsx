"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import {
  IMAGE_INPUT_ACCEPT,
  validateImageFiles,
} from "@/utils/fileHelpers";

interface FileDropZoneProps {
  files: File[];
  previews: string[];
  label: string;
  onFilesChange: (files: File[]) => void;
  compact?: boolean;
}

const mergeUniqueFiles = (current: File[], additions: File[]): File[] => {
  const knownFiles = new Set(
    current.map(
      (file) => `${file.name}:${file.size}:${file.lastModified}`,
    ),
  );

  return [
    ...current,
    ...additions.filter((file) => {
      const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (knownFiles.has(fileKey)) {
        return false;
      }
      knownFiles.add(fileKey);
      return true;
    }),
  ];
};

/** Accepts image files by drop or file dialog and shows their preview strip. */
export function FileDropZone({
  files,
  previews,
  label,
  onFilesChange,
  compact = false,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);

  const addFiles = (incomingFiles: FileList | File[]) => {
    const validatedFiles = validateImageFiles(incomingFiles);
    setRejectedCount(validatedFiles.rejectedCount);

    if (validatedFiles.accepted.length > 0) {
      onFilesChange(mergeUniqueFiles(files, validatedFiles.accepted));
    }
  };

  const handleFilesDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }
    event.target.value = "";
  };

  const handleOpenFileDialog = () => {
    inputRef.current?.click();
  };

  const handleDropZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenFileDialog();
    }
  };

  return (
    <div>
      <div
        aria-label={`${label}. Click or drop files to upload.`}
        className={`flex cursor-pointer flex-col justify-between border border-dashed bg-black/10 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-white ${
          compact ? "min-h-32 p-5" : "min-h-72 p-7 md:min-h-80 md:p-9"
        } ${isDragging ? "border-white/60" : "border-white/20"}`}
        onClick={handleOpenFileDialog}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleFilesDrop}
        onKeyDown={handleDropZoneKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-start justify-between gap-6">
          <span className="text-sm font-light text-white/70">{label}</span>
          <span className="whitespace-nowrap text-xs text-white/35">
            JPG · PNG · WEBP · TIFF
          </span>
        </div>

        <div className="text-xs font-light text-white/35">
          {files.length > 0
            ? `${files.length} ${files.length === 1 ? "image" : "images"} selected`
            : "Click to browse or drag files here"}
        </div>
      </div>

      <input
        ref={inputRef}
        accept={IMAGE_INPUT_ACCEPT}
        className="sr-only"
        multiple
        onChange={handleFileInputChange}
        type="file"
      />

      {rejectedCount > 0 ? (
        <p className="mt-3 text-xs font-light text-white/45" role="status">
          {rejectedCount} unsupported{" "}
          {rejectedCount === 1 ? "file was" : "files were"} skipped.
        </p>
      ) : null}

      {previews.length > 0 ? (
        <div
          aria-label="Selected image previews"
          className="mt-4 flex gap-2 overflow-x-auto pb-2"
        >
          {previews.map((preview) => (
            <img
              key={preview}
              alt=""
              className="h-16 w-24 shrink-0 border border-white/10 object-cover grayscale opacity-60"
              src={preview}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
