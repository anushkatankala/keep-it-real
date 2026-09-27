/**
 * Loads API keys from the repo's `.env` into process.env. Imported for its side
 * effect by every entry point that talks to Gemini, ElevenLabs or Higgsfield.
 * Variables already set in the shell win over the file.
 */

import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dirname, "..", "..", ".env");

try {
  process.loadEnvFile(ENV_FILE);
} catch (error) {
  if (error.code !== "ENOENT") throw new Error(`Could not read ${ENV_FILE}: ${error.message}`);
}
