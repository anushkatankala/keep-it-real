/**
 * Wires the built tour to the reference scene.
 *
 * Everything time-dependent was resolved at build time, so this file only
 * loads two JSON documents, hands them to the director, and keeps the UI in
 * step. Swapping in the interactive walkthrough means replacing PanoScene with
 * anything that implements the same five methods.
 */

import { analysePlan, headingToRoom, normaliseHeading } from "/lib/targets.mjs";
import { Director } from "./director.mjs";
import { PanoScene } from "./scene.mjs";
import { clearCaption, highlightCaption, renderCaption } from "./captions.mjs";

const dom = new Proxy({}, { get: (_, id) => document.getElementById(id) });

function formatClock(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function fail(message) {
  dom.error.textContent = message;
  dom.introText.textContent = "";
  dom.begin.classList.add("hidden");
}

const [plan, tour] = await Promise.all([
  fetch("/api/plan").then((response) => (response.ok ? response.json() : null)),
  fetch("/api/tour").then((response) => (response.ok ? response.json() : null))
]);

if (!tour) {
  fail("No tour.json yet. Build one with: node app/tour/build.mjs");
  throw new Error("no tour");
}

const geometry = plan ? analysePlan(plan) : null;
const mode = new URLSearchParams(location.search).get("mode") === "walk" ? "walk" : "auto";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scene = new PanoScene(dom.stage, {
  plan,
  panoUrl: (roomId) => `/panos/${roomId}.jpg`,
  roomOf: (roomId) => geometry?.byId.get(roomId) ?? null,
  targetsOf: (roomId) => geometry?.targets.get(roomId) ?? {}
});

// The narrated tour stays on the house GLB. Room changes still advance the
// script, but the picture is the model, not the interior photos.
if (mode === "auto") {
  scene.showRoom = () => scene.showExterior("/model");
}

const director = new Director(scene, tour, {
  audioBase: "/",
  modelUrl: "/model",
  onChange: update
});
director.preload();

/** Handle for poking at playback from the console. */
globalThis.__tour = { scene, director };

// A hidden tab stops getting animation frames while its clock keeps running,
// so on return the tour would jump forward and skip stops. Narration playing
// to nobody is not wanted either, so hiding pauses and returning resumes.
let resumeOnReturn = false;
addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resumeOnReturn = director.playing;
    if (resumeOnReturn) director.pause();
  } else if (resumeOnReturn) {
    resumeOnReturn = false;
    director.play();
  }
});

// ------------------------------------------------------------------ chrome

dom.house.textContent = tour.projectName ?? plan?.name ?? "Tour";
dom.introTitle.textContent = tour.projectName ?? "AI tour";

const silent = tour.voice?.provider !== "elevenlabs";
dom.introText.textContent =
  mode === "walk"
    ? "Click a room, or a doorway inside it, and the camera walks through."
    : silent
      ? "An automated walk through the same rooms, with the narration on screen. Voice arrives with the ElevenLabs key."
      : `Narrated tour, ${formatClock(tour.totalDuration)}.`;
if (mode === "walk") {
  dom.begin.textContent = "Step inside";
  dom.controls.classList.add("hidden");
}

dom.badge.textContent = "Interiors are AI-generated. The exterior is the real house.";
dom.badge.classList.remove("hidden");

for (const [index, stop] of tour.stops.entries()) {
  const button = document.createElement("button");
  button.innerHTML = `<span>${stop.name}${stop.transit ? " ·" : ""}</span><span class="len">${formatClock(stop.duration)}</span>`;
  button.onclick = () => {
    if (mode === "walk" && stop.roomId) walkTo(stop.roomId);
    else director.goTo(index, { autoplay: true });
  };
  dom.stops.append(button);
}

let walking = false;
let currentRoomId = null;

function showLine(text) {
  dom.caption.dataset.stop = "";
  dom.caption.replaceChildren();
  const span = document.createElement("span");
  span.className = "speaking";
  span.textContent = text;
  dom.caption.append(span);
}

function renderDoors(roomId) {
  dom.doors.replaceChildren();
  const doors = geometry?.doors.get(roomId) ?? [];
  if (mode !== "walk" || doors.length === 0) {
    dom.doors.classList.add("hidden");
    return;
  }
  dom.doors.classList.remove("hidden");
  for (const door of doors) {
    const button = document.createElement("button");
    button.textContent = `Through to ${door.name}`;
    button.onclick = () => walkTo(door.roomId);
    dom.doors.append(button);
  }
}

/** Turn toward the doorway, then crossfade into the room on the other side. */
async function walkTo(roomId) {
  if (!roomId || walking || roomId === currentRoomId) {
    renderDoors(roomId);
    return;
  }
  walking = true;
  director.pause();
  dom.intro.classList.add("hidden");

  const room = geometry?.byId.get(roomId);
  const from = currentRoomId;
  const toward = from && geometry ? headingToRoom(geometry, from, roomId) : null;

  showLine(from ? `Walking through to the ${room?.name ?? "next room"}.` : `Stepping into the ${room?.name ?? "house"}.`);
  const incoming = await scene.prefetch(roomId);
  const flatPhoto = incoming && scene.isEquirect(roomId) === false;
  if (!flatPhoto && toward != null) {
    scene.lookAt({ heading: toward, pitch: -4, fov: 64 }, { duration: 900 });
    await sleep(980);
  }

  await scene.showRoom(roomId, { fade: 1100 });
  currentRoomId = roomId;

  if (!flatPhoto) {
    const arrival = from && geometry ? headingToRoom(geometry, roomId, from) : null;
    const opening = arrival == null ? (geometry?.targets.get(roomId)?.windows?.heading ?? 0) : normaliseHeading(arrival + 180);
    scene.lookAt({ heading: opening, pitch: 0, fov: 74 }, { duration: 900 });
  }
  scene.setInteractive(true);

  const stop = tour.stops.find((entry) => entry.roomId === roomId);
  dom.where.textContent = stop ? `${stop.name} · interior` : room?.name ?? "";
  [...dom.stops.children].forEach((button, index) => {
    button.setAttribute("aria-current", String(tour.stops[index]?.roomId === roomId));
  });
  renderDoors(roomId);
  walking = false;
}

addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "WALK_TO") return;
  const stop = tour.stops.find(
    (entry) => entry.roomId === data.roomId || entry.name === data.name
  );
  if (stop?.roomId) walkTo(stop.roomId);
});

function update() {
  const stop = director.stop;
  const buttons = [...dom.stops.children];
  buttons.forEach((button, index) => button.setAttribute("aria-current", String(index === director.index)));

  dom.play.innerHTML = director.playing ? "&#10073;&#10073;" : "&#9654;";
  dom.where.textContent = stop ? (stop.kind === "exterior" ? "Exterior" : `${stop.name} · interior`) : "";

  const elapsed = director.elapsedBefore + director.time;
  dom.clock.textContent = `${formatClock(elapsed)} / ${formatClock(tour.totalDuration)}`;
  dom.fill.style.width = `${Math.min(100, (elapsed / tour.totalDuration) * 100)}%`;

  if (!stop || mode === "walk") return;
  if (dom.caption.dataset.stop !== stop.id) {
    dom.caption.dataset.stop = stop.id;
    renderCaption(dom.caption, stop);
  }
  highlightCaption(dom.caption, director.time);
}

// ----------------------------------------------------------------- controls

dom.play.onclick = () => director.toggle();
dom.next.onclick = () => director.next();
dom.prev.onclick = () => director.previous();
dom.restart.onclick = () => director.restart();

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") director.toggle();
  else if (event.code === "ArrowRight") director.next();
  else if (event.code === "ArrowLeft") director.previous();
  else return;
  event.preventDefault();
});

dom.begin.classList.remove("hidden");
dom.begin.onclick = async () => {
  dom.intro.classList.add("hidden");
  if (mode === "walk") {
    const first = tour.stops.find((stop) => stop.roomId);
    if (first) await walkTo(first.roomId);
    return;
  }
  // Audio playback has to originate from a gesture, so the narrated tour
  // starts here rather than on load.
  await director.goTo(0, { autoplay: true });
};

// -------------------------------------------------------------------- frame

await scene.showExterior("/model");
scene.drift(3);
clearCaption(dom.caption);
update();

if (mode === "auto") {
  dom.intro.classList.add("hidden");
  director.goTo(0, { autoplay: true });
}

let last = performance.now();
requestAnimationFrame(function frame(now) {
  // The scene is animated per-frame, so a long frame is clamped to keep camera
  // motion smooth. The director times itself against the wall clock instead.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  director.tick();
  scene.update(dt);
  requestAnimationFrame(frame);
});
