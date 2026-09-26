import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { zipSync } from "fflate";
import { imagesToGlb } from "../dist/index.js";

test("turns image bytes into the GLB returned by NodeODM", async (t) => {
  const expectedGlb = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const archive = zipSync({
    "odm_texturing/odm_textured_model_geo.glb": expectedGlb
  });
  let statusChecks = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "POST" && url.pathname === "/task/new") {
      let body = "";
      for await (const chunk of request) body += chunk.toString("latin1");
      assert.match(body, /house-01\.jpg/);
      assert.match(body, /gltf/);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ uuid: "task-123" }));
      return;
    }
    if (url.pathname === "/task/task-123/info") {
      statusChecks++;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        uuid: "task-123",
        status: { code: statusChecks === 1 ? 20 : 40 },
        progress: statusChecks === 1 ? 42 : 100
      }));
      return;
    }
    if (url.pathname === "/task/task-123/download/all.zip") {
      response.setHeader("content-type", "application/zip");
      response.end(archive);
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const updates = [];
  const glb = await imagesToGlb(
    [{ name: "house-01.jpg", data: Uint8Array.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" }],
    {
      nodeOdmUrl: `http://127.0.0.1:${address.port}`,
      pollIntervalMs: 1,
      timeoutMs: 1_000,
      onProgress: (update) => updates.push(update)
    }
  );

  assert.deepEqual(glb, expectedGlb);
  assert.deepEqual(updates.map((update) => update.state), ["processing", "ready"]);
});
