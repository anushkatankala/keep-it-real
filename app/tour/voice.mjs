/**
 * Narration audio from ElevenLabs, with the character-level timing that drives
 * both the captions and the camera.
 *
 * Without a key this falls back to estimating timings from word length, so the
 * whole tour still builds and plays, silently. Adding a key later only upgrades
 * the estimate to real audio; nothing downstream changes shape.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** Pace of the estimated fallback, tuned to sound like an unhurried agent. */
const SECONDS_PER_LETTER = 0.045;
const WORD_OVERHEAD = 0.12;
const PAUSE_AFTER = { ",": 0.18, ";": 0.22, ":": 0.22, ".": 0.42, "!": 0.42, "?": 0.42 };

const round = (value) => Math.round(value * 1000) / 1000;

/** Words with their character offset in the original text. */
function splitWords(text) {
  const words = [];
  for (const match of text.matchAll(/\S+/g)) words.push({ text: match[0], index: match.index });
  return words;
}

/**
 * Plausible timings with no API call. Long words take longer and sentence
 * endings get a beat, which is enough for camera work to be developed against.
 */
export function estimateTiming(text) {
  let time = 0;
  const words = splitWords(text).map(({ text: word, index }) => {
    const letters = Math.max(word.replace(/[^\p{L}\p{N}]/gu, "").length, 1);
    const spoken = WORD_OVERHEAD + SECONDS_PER_LETTER * letters;
    const entry = { text: word, index, start: round(time), end: round(time + spoken) };
    time += spoken + (PAUSE_AFTER[word.at(-1)] ?? 0);
    return entry;
  });

  return { duration: round(time + 0.3), words, estimated: true };
}

/**
 * Groups ElevenLabs' per-character timings into words. The characters array
 * reconstructs the text that was sent, so its indices double as offsets into
 * the original narration.
 */
function wordsFromAlignment(alignment) {
  const characters = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];

  const words = [];
  let current = null;

  for (let i = 0; i < characters.length; i++) {
    if (/\s/.test(characters[i])) {
      if (current) words.push(current);
      current = null;
      continue;
    }
    if (!current) current = { text: "", index: i, start: round(starts[i] ?? 0), end: round(ends[i] ?? 0) };
    current.text += characters[i];
    current.end = round(ends[i] ?? current.end);
  }
  if (current) words.push(current);

  return words;
}

function cacheKey(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/**
 * Speaks one stop. Returns the audio bytes plus timings, or timings alone when
 * no key is configured. Results are cached on disk by a hash of the request, so
 * re-running a build costs nothing and never re-charges for unchanged lines.
 */
export async function synthesise(text, options = {}) {
  const {
    apiKey,
    voiceId,
    modelId = DEFAULT_MODEL_ID,
    outputFormat = DEFAULT_OUTPUT_FORMAT,
    cacheDir,
    signal
  } = options;

  if (!apiKey || !voiceId) return { audio: null, ...estimateTiming(text) };

  const key = cacheKey([voiceId, modelId, outputFormat, text]);
  const audioPath = cacheDir ? join(cacheDir, `${key}.mp3`) : null;
  const timingPath = cacheDir ? join(cacheDir, `${key}.json`) : null;

  if (cacheDir) {
    const cached = await Promise.all([
      readFile(audioPath).catch(() => null),
      readFile(timingPath, "utf8").catch(() => null)
    ]);
    if (cached[0] && cached[1]) {
      return { audio: cached[0], ...JSON.parse(cached[1]), cached: true };
    }
  }

  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(voiceId)}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId, output_format: outputFormat }),
    signal
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  const audio = Buffer.from(payload.audio_base64, "base64");

  // Locating a phrase means searching the text that was sent, so the original
  // alignment is the one to use, not the normalised one.
  const words = wordsFromAlignment(payload.alignment);
  const ends = payload.alignment?.character_end_times_seconds ?? [];
  const timing = {
    duration: round(ends.at(-1) ?? estimateTiming(text).duration),
    words,
    estimated: false
  };

  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(audioPath, audio);
    await writeFile(timingPath, JSON.stringify(timing));
  }

  return { audio, ...timing };
}

/** The time the narrator reaches a given character offset. */
export function timeAtCharacter(words, index) {
  if (words.length === 0) return 0;
  for (const word of words) {
    if (index <= word.index + word.text.length) return word.start;
  }
  return words.at(-1).end;
}

/**
 * When the narrator says a phrase. Falls back to the phrase's first word so a
 * slight paraphrase between script and speech does not lose the camera cue.
 */
export function findPhraseTime(text, words, phrase) {
  if (!phrase) return null;

  const haystack = text.toLowerCase();
  const needle = phrase.trim().toLowerCase();
  if (needle.length === 0) return null;

  let at = haystack.indexOf(needle);
  if (at === -1) {
    const first = needle.split(/\s+/)[0];
    at = first.length > 2 ? haystack.indexOf(first) : -1;
  }
  if (at === -1) return null;

  return timeAtCharacter(words, at);
}
