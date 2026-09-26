import type { ImageInput, NodeOdmOption } from "./types.js";

export type NodeOdmTaskInfo = {
  uuid: string;
  status: {
    code: 10 | 20 | 30 | 40 | 50;
    errorMessage?: string;
  };
  progress?: number;
};

function endpoint(baseUrl: string, pathname: string, token?: string) {
  const url = new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`);
  if (token) url.searchParams.set("token", token);
  return url;
}

async function errorMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? `${response.status} ${response.statusText}`;
}

function imageBlob(image: ImageInput) {
  if (image.data instanceof Blob) return image.data;
  if (image.data instanceof ArrayBuffer) {
    return new Blob([image.data], { type: image.contentType ?? "application/octet-stream" });
  }
  const bytes = image.data.slice();
  return new Blob([bytes.buffer], { type: image.contentType ?? "application/octet-stream" });
}

export async function createTask(
  images: readonly ImageInput[],
  config: {
    baseUrl: string;
    token?: string;
    label: string;
    options: NodeOdmOption[];
    signal?: AbortSignal;
  }
) {
  const body = new FormData();
  body.set("name", config.label);
  body.set("options", JSON.stringify(config.options));
  for (const image of images) {
    body.append("images", imageBlob(image), image.name);
  }

  const response = await fetch(endpoint(config.baseUrl, "/task/new", config.token), {
    method: "POST",
    body,
    signal: config.signal
  });
  const payload = await response.json().catch(() => null) as { uuid?: string; error?: string } | null;
  if (!response.ok || !payload?.uuid) {
    throw new Error(payload?.error ?? `NodeODM task creation failed: ${response.status}`);
  }
  return payload.uuid;
}

export async function getTaskInfo(
  taskId: string,
  config: { baseUrl: string; token?: string; signal?: AbortSignal }
): Promise<NodeOdmTaskInfo> {
  const response = await fetch(endpoint(config.baseUrl, `/task/${taskId}/info`, config.token), {
    cache: "no-store",
    signal: config.signal
  });
  if (!response.ok) throw new Error(`NodeODM status check failed: ${await errorMessage(response)}`);
  return response.json() as Promise<NodeOdmTaskInfo>;
}

export async function downloadAllZip(
  taskId: string,
  config: { baseUrl: string; token?: string; signal?: AbortSignal }
) {
  const response = await fetch(
    endpoint(config.baseUrl, `/task/${taskId}/download/all.zip`, config.token),
    { cache: "no-store", signal: config.signal }
  );
  if (!response.ok) throw new Error(`NodeODM output download failed: ${await errorMessage(response)}`);
  return new Uint8Array(await response.arrayBuffer());
}
