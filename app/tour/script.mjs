/**
 * The realtor's script, written by Gemini against the floor plan.
 *
 * The model never sees coordinates. It is given each room's named targets
 * ("windows", "door:r5") and returns camera moves referencing those names, so
 * it cannot ask the camera to look at something that does not exist. build.mjs
 * resolves the names back into headings.
 */

import { readFile } from "node:fs/promises";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const DEFAULT_TEXT_MODEL = "gemini-flash-latest";

export const EXTERIOR_STOP_ID = "exterior";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    stops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          roomId: { type: "string" },
          text: { type: "string" },
          moves: {
            type: "array",
            items: {
              type: "object",
              properties: {
                atPhrase: { type: "string" },
                target: { type: "string" },
                fov: { type: "number" }
              },
              required: ["atPhrase", "target"]
            }
          }
        },
        required: ["roomId", "text", "moves"]
      }
    }
  },
  required: ["stops"]
};

function describeStop(geometry, stop) {
  const room = geometry.byId.get(stop.roomId);
  const targets = geometry.targets.get(stop.roomId) ?? {};
  const names = Object.entries(targets)
    .filter(([, target]) => target.heading !== null)
    .map(([name, target]) => `      - "${name}": ${target.description}`)
    .join("\n");

  return [
    `  ${stop.roomId} — ${room.name} (${room.type}, ${room.areaSqFt} sq ft)${stop.transit ? " [pass-through]" : ""}`,
    room.notes ? `      notes: ${room.notes}` : null,
    names.length > 0 ? `      targets:\n${names}` : "      targets: none"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPrompt({ plan, geometry, route }) {
  const totalSqFt = geometry.rooms.reduce((sum, room) => sum + (room.areaSqFt ?? 0), 0);

  return `You are writing the narration for a video tour of a house, spoken by an
enthusiastic but credible real-estate agent. The viewer sees the real exterior
of the house first, then a series of interior panoramas, one per room.

House: ${plan.name}
Style: ${plan.style ?? "unspecified"}
Total floor area: ${totalSqFt} sq ft across ${geometry.rooms.length} rooms.

Write one stop per entry below, in exactly this order. The first stop has
roomId "${EXTERIOR_STOP_ID}" and is spoken over a slow orbit of the house from outside.

Stops:
  ${EXTERIOR_STOP_ID} — the house seen from outside
${route.map((stop) => describeStop(geometry, stop)).join("\n")}

Rules for "text":
- Two to four sentences per stop. Pass-through rooms get one short sentence.
- Written to be spoken aloud. Contractions, plain words, no bullet points, no
  headings, no stage directions, no emoji.
- Mention a room's square footage only where it genuinely sells the room, in
  roughly a third of the stops. Never recite numbers mechanically.
- Use the notes where they help. Do not invent major features like pools,
  basements or extra floors that are not listed.
- Vary the openings. Not every room may begin with "And here is".
- The last stop should close the tour warmly.

Rules for "moves":
- Zero to two per stop. A move turns the camera while the narrator keeps talking.
- "target" must be one of that stop's target names, exactly as written above.
  The exterior stop has no targets, so it gets no moves.
- "atPhrase" must be a short phrase copied verbatim from that stop's own text,
  positioned where the camera should start turning. Choose the moment the
  narration refers to what the camera will show.
- "fov" is optional, between 45 and 80. Lower is a tighter, more emphatic shot.
  Use it sparingly.`;
}

/** Drops moves the geometry cannot satisfy, rather than letting them mislead the camera. */
export function validateScript(script, { geometry, route }) {
  const expected = [EXTERIOR_STOP_ID, ...route.map((stop) => stop.roomId)];
  const warnings = [];
  const byRoom = new Map((script.stops ?? []).map((stop) => [stop.roomId, stop]));

  const stops = expected.map((roomId) => {
    const stop = byRoom.get(roomId);
    if (!stop) {
      warnings.push(`no narration for ${roomId}, using a placeholder line`);
      const room = geometry.byId.get(roomId);
      return { roomId, text: room ? `This is the ${room.name.toLowerCase()}.` : "", moves: [] };
    }

    const targets = geometry.targets.get(roomId) ?? {};
    const moves = (stop.moves ?? []).filter((move) => {
      const target = targets[move.target];
      if (!target || target.heading === null) {
        warnings.push(`${roomId}: dropped move to unknown target "${move.target}"`);
        return false;
      }
      if (!move.atPhrase || !stop.text.toLowerCase().includes(move.atPhrase.trim().toLowerCase())) {
        warnings.push(`${roomId}: phrase "${move.atPhrase}" is not in the narration, timing will be approximate`);
      }
      return true;
    });

    return { roomId, text: stop.text.trim(), moves };
  });

  for (const stop of script.stops ?? []) {
    if (!expected.includes(stop.roomId)) warnings.push(`ignored narration for unknown room ${stop.roomId}`);
  }

  return { stops, warnings };
}

export async function loadScript(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Overload and rate limit are the model being busy, not the request being wrong. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1500;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });

export async function generateScript({
  plan,
  geometry,
  route,
  apiKey,
  model = DEFAULT_TEXT_MODEL,
  signal,
  onRetry
}) {
  if (!apiKey) throw new Error("generateScript needs a Gemini API key");

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: buildPrompt({ plan, geometry, route }) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.85
    }
  });

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body,
        signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      onRetry?.({ attempt, reason: error.message });
      await sleep(RETRY_BASE_MS * attempt, signal);
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      lastError = new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;
      onRetry?.({ attempt, reason: `${response.status}, model busy` });
      await sleep(RETRY_BASE_MS * attempt, signal);
      continue;
    }

    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? "";
    if (!text) throw new Error("Gemini returned no content");

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 200)}`);
    }
  }

  throw lastError;
}
