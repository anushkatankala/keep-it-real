"use client";

import { useEffect, useMemo, useState } from "react";

import { RouteGuard } from "@/components/layout/RouteGuard";
import { GlassCard } from "@/components/ui/GlassCard";
import { TabBar, type TabDefinition } from "@/components/ui/TabBar";
import { STANDARD_ROOMS } from "@/constants/rooms";
import { useProject } from "@/context/ProjectContext";
import type { ProjectResults, RoomConfig } from "@/types";

const PROCESSING_PREVIEW_DELAY_MS = 2400;

const RESULT_TABS = [
  { id: "model", label: "3D Model" },
  { id: "tour", label: "Virtual Tour" },
  { id: "walkthrough", label: "AI Walkthrough" },
] as const satisfies readonly TabDefinition[];

const LOADING_MESSAGES: Record<string, string> = {
  model: "Processing drone imagery…",
  tour: "Mapping interior viewpoints…",
  walkthrough: "Composing AI walkthrough…",
};

const MEASUREMENTS = [
  { label: "Gross area", value: "— m²" },
  { label: "Roof height", value: "— m" },
  { label: "Perimeter", value: "— m" },
  { label: "Ground level", value: "— m" },
];

const TRANSCRIPT_ROWS = [
  { time: "00:00", text: "Exterior approach and aerial context." },
  { time: "00:18", text: "Entry sequence and primary living spaces." },
  { time: "00:46", text: "Private rooms and additional spaces." },
];

const EMPTY_RESULTS: ProjectResults = {
  glbModelUrl: null,
  virtualTourUrl: null,
  aiVideoUrl: null,
};

const buildTourRoomList = (roomConfig: RoomConfig): string[] => {
  const standardRooms = STANDARD_ROOMS.flatMap(({ key, singularLabel }) =>
    Array.from(
      { length: roomConfig[key] },
      (_, index) => `${singularLabel} ${index + 1}`,
    ),
  );
  const specialRooms = roomConfig.specialRooms
    .filter(({ selected }) => selected)
    .map(({ label }) => label);

  return [...standardRooms, ...specialRooms];
};

interface LoadingPanelProps {
  message: string;
}

/** Shows one processing message and a thin pulsing progress line. */
function LoadingPanel({ message }: LoadingPanelProps) {
  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center">
      <div className="w-full max-w-xl">
        <p className="text-sm font-light text-white/60">{message}</p>
        <div className="mt-5 h-px overflow-hidden bg-white/10">
          <div className="h-px w-2/3 animate-pulse bg-white/80" />
        </div>
      </div>
    </div>
  );
}

interface ModelPanelProps {
  modelUrl: string | null;
}

/** Displays the dominant model canvas with floating property measurements. */
function ModelPanel({ modelUrl }: ModelPanelProps) {
  return (
    <div className="relative min-h-[calc(100vh-14rem)] py-6">
      <div className="relative min-h-[calc(100vh-17rem)] overflow-hidden border border-white/[0.08] bg-white/[0.02]">
        {/* TODO: integrate Three.js GLB viewer */}
        <canvas
          aria-label="3D property model viewer"
          className="absolute inset-0 h-full w-full"
          data-model-url={modelUrl ?? ""}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-white/25">
              Spatial model
            </p>
            <p className="mt-3 text-sm font-light text-white/40">
              {modelUrl ? "Model asset ready" : "GLB viewer placeholder"}
            </p>
          </div>
        </div>
      </div>

      <GlassCard className="absolute right-6 top-12 w-64 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
          Measurements
        </p>
        <dl className="mt-5">
          {MEASUREMENTS.map(({ label, value }) => (
            <div
              key={label}
              className="flex justify-between border-b border-white/[0.06] py-3 text-xs"
            >
              <dt className="font-light text-white/40">{label}</dt>
              <dd className="font-medium tabular-nums text-white/70">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </GlassCard>
    </div>
  );
}

interface TourPanelProps {
  roomConfig: RoomConfig;
  tourUrl: string | null;
}

/** Shows the virtual-tour surface and a clickable room list from configuration. */
function TourPanel({ roomConfig, tourUrl }: TourPanelProps) {
  const roomList = useMemo(
    () => buildTourRoomList(roomConfig),
    [roomConfig],
  );
  const [selectedRoom, setSelectedRoom] = useState(roomList[0] ?? "");

  return (
    <div className="min-h-[calc(100vh-14rem)] py-6">
      <div className="relative min-h-[calc(100vh-22rem)] border border-white/[0.08] bg-white/[0.02]">
        {/* TODO: recommend Pannellum or Marzipano for 360 rendering */}
        {tourUrl ? (
          <iframe
            className="absolute inset-0 h-full w-full border-0"
            src={tourUrl}
            title="Property virtual tour"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-white/25">
                360 environment
              </p>
              <p className="mt-3 text-sm font-light text-white/40">
                {selectedRoom || "Virtual tour placeholder"}
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        aria-label="Virtual tour rooms"
        className="mt-6 flex overflow-x-auto border-y border-white/[0.06]"
      >
        {roomList.map((room) => {
          const handleRoomSelect = () => {
            setSelectedRoom(room);
          };

          return (
            <button
              key={room}
              className={`shrink-0 border-r border-white/[0.06] px-5 py-4 text-sm font-light transition-colors ${
                selectedRoom === room
                  ? "bg-white text-black"
                  : "text-white/45 hover:text-white/75"
              }`}
              onClick={handleRoomSelect}
              type="button"
            >
              {room}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface WalkthroughPanelProps {
  videoUrl: string | null;
}

/** Renders the AI walkthrough video and its timestamped transcript panel. */
function WalkthroughPanel({ videoUrl }: WalkthroughPanelProps) {
  return (
    <div className="min-h-[calc(100vh-14rem)] py-6">
      <video
        className="aspect-video w-full border border-white/[0.08] bg-black"
        controls
        preload="metadata"
        src={videoUrl ?? undefined}
      >
        Your browser does not support embedded video.
      </video>

      <GlassCard className="mt-6 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
          Transcript
        </p>
        <div className="mt-5">
          {TRANSCRIPT_ROWS.map(({ time, text }) => (
            <div
              key={time}
              className="flex gap-8 border-b border-white/[0.06] py-4 text-sm"
            >
              <span className="font-medium tabular-nums text-white/30">
                {time}
              </span>
              <span className="font-light text-white/55">{text}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

/** Presents the processed property across model, tour, and video result tabs. */
export default function ResultsPage() {
  const {
    isProcessing,
    results,
    roomConfig,
    setIsProcessing,
    setResults,
  } = useProject();
  const [activeTab, setActiveTab] = useState<string>(RESULT_TABS[0].id);

  useEffect(() => {
    if (!isProcessing) {
      return undefined;
    }

    const processingTimer = window.setTimeout(() => {
      setResults(EMPTY_RESULTS);
      setIsProcessing(false);
    }, PROCESSING_PREVIEW_DELAY_MS);

    return () => {
      window.clearTimeout(processingTimer);
    };
  }, [isProcessing, setIsProcessing, setResults]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  const renderActivePanel = () => {
    if (isProcessing) {
      return (
        <LoadingPanel
          message={LOADING_MESSAGES[activeTab] ?? "Processing property…"}
        />
      );
    }

    if (activeTab === "tour") {
      return (
        <TourPanel
          roomConfig={roomConfig}
          tourUrl={results?.virtualTourUrl ?? null}
        />
      );
    }

    if (activeTab === "walkthrough") {
      return (
        <WalkthroughPanel videoUrl={results?.aiVideoUrl ?? null} />
      );
    }

    return <ModelPanel modelUrl={results?.glbModelUrl ?? null} />;
  };

  return (
    <RouteGuard>
      <main className="min-h-screen px-8 pb-8 pt-32">
        <div className="mx-auto max-w-4xl">
          <p className="mb-5 text-xs uppercase tracking-[0.2em] text-white/40">
            03 / Property output
          </p>
          <TabBar
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tabs={RESULT_TABS}
          />
          <section role="tabpanel">{renderActivePanel()}</section>
        </div>
      </main>
    </RouteGuard>
  );
}
