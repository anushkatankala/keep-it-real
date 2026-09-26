import { getTaskInfo } from "./nodeodm-client.js";
import type { ReconstructionProgress } from "./types.js";

function abortError(message: string) {
  return new DOMException(message, "AbortError");
}

async function delay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? abortError("Reconstruction aborted");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? abortError("Reconstruction aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal) {
      setTimeout(() => signal.removeEventListener("abort", abort), milliseconds);
    }
  });
}

export async function waitForTask(
  taskId: string,
  config: {
    baseUrl: string;
    token?: string;
    pollIntervalMs: number;
    timeoutMs: number;
    signal?: AbortSignal;
    onProgress?: (update: ReconstructionProgress) => void;
  }
) {
  const deadline = Date.now() + config.timeoutMs;

  while (true) {
    if (Date.now() >= deadline) {
      throw new Error(`NodeODM task ${taskId} timed out after ${config.timeoutMs}ms`);
    }

    const task = await getTaskInfo(taskId, config);
    const progress = typeof task.progress === "number" ? task.progress : null;

    if (task.status.code === 40) {
      config.onProgress?.({ taskId, state: "ready", progress: progress ?? 100 });
      return;
    }
    if (task.status.code === 30 || task.status.code === 50) {
      throw new Error(task.status.errorMessage ?? `NodeODM task ${taskId} failed`);
    }

    config.onProgress?.({
      taskId,
      state: task.status.code === 20 ? "processing" : "queued",
      progress
    });
    await delay(config.pollIntervalMs, config.signal);
  }
}
