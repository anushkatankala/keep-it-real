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
  DemoProjectInput,
} from "@/constants/demo";
import type {
  ProjectResults,
  ProjectState,
  RoomConfig,
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
  startDemo: () => void;
  resetDemo: () => void;
  applyDemoProject: (input: DemoProjectInput) => void;
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
  demoMode: false,
  cropRegion: null,
});

const attachRoomPreviews = (roomConfig: RoomConfig): RoomConfig => ({
  ...roomConfig,
  standardRoomImages: {
    bedrooms: roomConfig.standardRoomImages.bedrooms.map((imageSet) => ({
      ...imageSet,
      imagePreviews: createImagePreviews(imageSet.imageFiles),
    })),
    bathrooms: roomConfig.standardRoomImages.bathrooms.map((imageSet) => ({
      ...imageSet,
      imagePreviews: createImagePreviews(imageSet.imageFiles),
    })),
    livingRooms: roomConfig.standardRoomImages.livingRooms.map((imageSet) => ({
      ...imageSet,
      imagePreviews: createImagePreviews(imageSet.imageFiles),
    })),
    diningRooms: roomConfig.standardRoomImages.diningRooms.map((imageSet) => ({
      ...imageSet,
      imagePreviews: createImagePreviews(imageSet.imageFiles),
    })),
    kitchens: roomConfig.standardRoomImages.kitchens.map((imageSet) => ({
      ...imageSet,
      imagePreviews: createImagePreviews(imageSet.imageFiles),
    })),
  },
  specialRooms: roomConfig.specialRooms.map((room) => ({
    ...room,
    imagePreviews: createImagePreviews(room.imageFiles),
  })),
});

const revokeRoomPreviews = (roomConfig: RoomConfig) => {
  Object.values(roomConfig.standardRoomImages).forEach((imageSets) => {
    imageSets.forEach(({ imagePreviews }) => {
      revokeImagePreviews(imagePreviews);
    });
  });
  roomConfig.specialRooms.forEach(({ imagePreviews }) => {
    revokeImagePreviews(imagePreviews);
  });
};

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

  const startDemo = useCallback(() => {
    updateProjectState((current) => ({
      ...current,
      demoMode: true,
    }));
  }, [updateProjectState]);

  const resetDemo = useCallback(() => {
    updateProjectState((current) => ({
      ...current,
      demoMode: true,
      cropRegion: null,
      results: null,
      isProcessing: false,
    }));
  }, [updateProjectState]);

  const applyDemoProject = useCallback(
    (input: DemoProjectInput) => {
      const previous = projectStateRef.current;
      const dronePreviews = createImagePreviews(input.droneFiles);
      const roomConfig = attachRoomPreviews(input.roomConfig);

      updateProjectState((current) => ({
        ...current,
        demoMode: true,
        cropRegion: input.cropRegion,
        droneImages: { files: input.droneFiles, previews: dronePreviews },
        roomConfig,
        results: null,
        isProcessing: false,
      }));

      revokeImagePreviews(previous.droneImages.previews);
      revokeRoomPreviews(previous.roomConfig);
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
      startDemo,
      resetDemo,
      applyDemoProject,
    }),
    [
      projectState,
      applyDemoProject,
      setDroneImages,
      setIsProcessing,
      setResults,
      resetDemo,
      startDemo,
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
