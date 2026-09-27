/**
 * Higgsfield API client: upload a still, price a request, run it, fetch the clip.
 *
 * The API bills a prepaid dollar balance per second of output, so every request
 * can be priced first with the free /estimate route. An empty balance does not
 * fail a request, it leaves it queued, which is why polling has a deadline.
 */

const API = "https://api.higgsfield.ai";
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled", "cancelled"]);

/**
 * Accepts the key as two fields or as the single "id:secret" string the
 * console copies, whichever the .env holds.
 */
export function credentialsFromEnv(env = process.env) {
  const combined = env.HF_CREDENTIALS ?? "";
  if (combined.includes(":")) return combined;

  const id = env.HF_API_KEY_ID ?? "";
  const secret = env.HF_API_KEY_SECRET ?? "";
  if (id.includes(":")) return id;
  if (id && secret) return `${id}:${secret}`;
  return null;
}

export function createClient({ credentials, fetchImpl = fetch }) {
  if (!credentials) throw new Error("Higgsfield credentials missing: set HF_API_KEY_ID and HF_API_KEY_SECRET");
  const authorization = `Key ${credentials}`;

  async function call(path, body) {
    const response = await fetchImpl(path.startsWith("http") ? path : `${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Higgsfield ${response.status} on ${path}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  return {
    /** Uploads bytes and returns the public URL the models read from. */
    async upload(bytes, contentType = "image/jpeg") {
      const slot = await call("/files/generate-upload-url", { content_type: contentType });
      const response = await fetchImpl(slot.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType, ...(slot.upload_headers ?? {}) },
        body: bytes
      });
      if (!response.ok) throw new Error(`Higgsfield upload failed: ${response.status}`);
      return slot.public_url;
    },

    /** Charged price in dollars. Free to call. */
    async estimate(model, input) {
      const quote = await call(`/estimate/${model}`, input);
      return Number(quote.usd);
    },

    async submit(model, input) {
      return call(`/${model}`, input);
    },

    async wait(job, { timeoutMs = 15 * 60_000, intervalMs = 8_000, onStatus } = {}) {
      const statusUrl = job.status_url ?? `${API}/requests/${job.request_id}/status`;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const status = await call(statusUrl);
        onStatus?.(status.status);
        if (TERMINAL.has(status.status)) {
          const url = status.video?.url ?? (typeof status.video === "string" ? status.video : null);
          if (status.status !== "completed" || !url) {
            throw new Error(`Higgsfield request ${job.request_id} ended ${status.status}`);
          }
          return url;
        }
      }
      // A request queued on an empty balance would otherwise run, and charge,
      // whenever funds are next added.
      if (job.cancel_url) await call(job.cancel_url, {}).catch(() => null);
      throw new Error(`Higgsfield request ${job.request_id} still pending after ${timeoutMs / 60_000} min, cancelled (is the balance empty?)`);
    },

    async download(url) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
