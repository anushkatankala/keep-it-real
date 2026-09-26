"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createInitialSpecialRooms,
  createInitialStandardRoomImages,
  STANDARD_ROOMS,
} from "@/constants/rooms";
import type {
  ProjectResults,
  ProjectState,
  StandardRoomKey,
} from "@/types";
import {
  createImagePreviews,
  revokeImagePreviews,
} from "@/utils/fileHelpers";

interface ProjectContextValue extends ProjectState {
  setDroneImages: (files: File[]) => void;
  setStandardRoomCount: (room: StandardRoomKey, count: number) => void;
  setStandardRoomImages: (
    room: StandardRoomKey,
    imageSetId: string,
    files: File[],
  ) => void;
  toggleSpecialRoom: (roomId: string) => void;
  setSpecialRoomImages: (roomId: string, files: File[]) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setResults: (results: ProjectResults | null) => void;
}

interface ProjectProviderProps {
  children: ReactNode;
}

const createInitialProjectState = (): ProjectState => ({
  droneImages: {
    files: [],
    previews: [],
  },
  roomConfig: {
    bedrooms: 0,
    bathrooms: 0,
    livingRooms: 0,
    diningRooms: 0,
    kitchens: 0,
    standardRoomImages: createInitialStandardRoomImages(),
    specialRooms: createInitialSpecialRooms(),
  },
  results: null,
  isProcessing: false,
});

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Provides uploaded files, room configuration, and result state to the app. */
export function ProjectProvider({ children }: ProjectProviderProps) {
  const [projectState, setProjectState] = useState<ProjectState>(
    createInitialProjectState,
  );
  const projectStateRef = useRef(projectState);

  const updateProjectState = useCallback(
    (updater: (current: ProjectState) => ProjectState) => {
      setProjectState((current) => {
        const nextState = updater(current);
        projectStateRef.current = nextState;
        return nextState;
      });
    },
    [],
  );

  const setDroneImages = useCallback(
    (files: File[]) => {
      const previousPreviews = projectStateRef.current.droneImages.previews;
      const previews = createImagePreviews(files);

      updateProjectState((current) => ({
        ...current,
        droneImages: { files, previews },
      }));
      revokeImagePreviews(previousPreviews);
    },
    [updateProjectState],
  );

  const setStandardRoomCount = useCallback(
    (room: StandardRoomKey, count: number) => {
      const currentImageSets =
        projectStateRef.current.roomConfig.standardRoomImages[room];
      const singularLabel =
        STANDARD_ROOMS.find(({ key }) => key === room)?.singularLabel ?? room;
      const nextImageSets = Array.from(
        { length: count },
        (_, index) =>
          currentImageSets[index] ?? {
            id: `${room}-${index + 1}`,
            label: `${singularLabel} ${index + 1}`,
            imageFiles: [],
            imagePreviews: [],
          },
      );
      const removedImageSets = currentImageSets.slice(count);

      updateProjectState((current) => ({
        ...current,
        roomConfig: {
          ...current.roomConfig,
          [room]: count,
          standardRoomImages: {
            ...current.roomConfig.standardRoomImages,
            [room]: nextImageSets,
          },
        },
      }));
      removedImageSets.forEach(({ imagePreviews }) => {
        revokeImagePreviews(imagePreviews);
      });
    },
    [updateProjectState],
  );

  const setStandardRoomImages = useCallback(
    (
      room: StandardRoomKey,
      imageSetId: string,
      files: File[],
    ) => {
      const previousPreviews =
        projectStateRef.current.roomConfig.standardRoomImages[room].find(
          ({ id }) => id === imageSetId,
        )?.imagePreviews ?? [];
      const imagePreviews = createImagePreviews(files);

      updateProjectState((current) => ({
        ...current,
        roomConfig: {
          ...current.roomConfig,
          standardRoomImages: {
            ...current.roomConfig.standardRoomImages,
            [room]: current.roomConfig.standardRoomImages[room].map(
              (imageSet) =>
                imageSet.id === imageSetId
                  ? {
                      ...imageSet,
                      imageFiles: files,
                      imagePreviews,
                    }
                  : imageSet,
            ),
          },
        },
      }));
      revokeImagePreviews(previousPreviews);
    },
    [updateProjectState],
  );

  const toggleSpecialRoom = useCallback(
    (roomId: string) => {
      const room = projectStateRef.current.roomConfig.specialRooms.find(
        ({ id }) => id === roomId,
      );
      const previewsToRevoke = room?.selected ? room.imagePreviews : [];

      updateProjectState((current) => ({
        ...current,
        roomConfig: {
          ...current.roomConfig,
          specialRooms: current.roomConfig.specialRooms.map((specialRoom) =>
            specialRoom.id === roomId
              ? {
                  ...specialRoom,
                  selected: !specialRoom.selected,
                  imageFiles: specialRoom.selected
                    ? []
                    : specialRoom.imageFiles,
                  imagePreviews: specialRoom.selected
                    ? []
                    : specialRoom.imagePreviews,
                }
              : specialRoom,
          ),
        },
      }));
      revokeImagePreviews(previewsToRevoke);
    },
    [updateProjectState],
  );

  const setSpecialRoomImages = useCallback(
    (roomId: string, files: File[]) => {
      const previousPreviews =
        projectStateRef.current.roomConfig.specialRooms.find(
          ({ id }) => id === roomId,
        )?.imagePreviews ?? [];
      const imagePreviews = createImagePreviews(files);

      updateProjectState((current) => ({
        ...current,
        roomConfig: {
          ...current.roomConfig,
          specialRooms: current.roomConfig.specialRooms.map((specialRoom) =>
            specialRoom.id === roomId
              ? {
                  ...specialRoom,
                  imageFiles: files,
                  imagePreviews,
                }
              : specialRoom,
          ),
        },
      }));
      revokeImagePreviews(previousPreviews);
    },
    [updateProjectState],
  );

  const setIsProcessing = useCallback(
    (isProcessing: boolean) => {
      updateProjectState((current) => ({
        ...current,
        isProcessing,
      }));
    },
    [updateProjectState],
  );

  const setResults = useCallback(
    (results: ProjectResults | null) => {
      updateProjectState((current) => ({
        ...current,
        results,
      }));
    },
    [updateProjectState],
  );

  useEffect(
    () => () => {
      const currentState = projectStateRef.current;
      revokeImagePreviews(currentState.droneImages.previews);
      Object.values(
        currentState.roomConfig.standardRoomImages,
      ).forEach((imageSets) => {
        imageSets.forEach(({ imagePreviews }) => {
          revokeImagePreviews(imagePreviews);
        });
      });
      currentState.roomConfig.specialRooms.forEach(({ imagePreviews }) => {
        revokeImagePreviews(imagePreviews);
      });
    },
    [],
  );

  const contextValue = useMemo<ProjectContextValue>(
    () => ({
      ...projectState,
      setDroneImages,
      setStandardRoomCount,
      setStandardRoomImages,
      toggleSpecialRoom,
      setSpecialRoomImages,
      setIsProcessing,
      setResults,
    }),
    [
      projectState,
      setDroneImages,
      setIsProcessing,
      setResults,
      setSpecialRoomImages,
      setStandardRoomImages,
      setStandardRoomCount,
      toggleSpecialRoom,
    ],
  );

  return (
    <ProjectContext.Provider value={contextValue}>
      {children}
    </ProjectContext.Provider>
  );
}

/** Returns the current project state and its typed update actions. */
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error("useProject must be used within ProjectProvider");
  }

  return context;
}
