# Keep It Real Web

Next.js frontend for the Keep It Real property capture workflow.

## Local development

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## 3D viewer integration contract

The frontend embeds the existing repository viewer; it does not parse, render,
or crop GLB files itself.

When property processing completes, the backend integration must update the
project context with a `ProjectResults` object containing:

```ts
{
  glbModelUrl: string | null;
  viewerUrl: string | null;
  virtualTourUrl: string | null;
  aiVideoUrl: string | null;
}
```

`viewerUrl` must point to a ready instance of the existing viewer page. The
frontend should set `isProcessing` to `false` only after this URL is available.

The viewer origin must serve the routes expected by `public/viewer.js`:

- `GET /meta` — model name, bounds, axes, triangle count, and byte size
- `GET /model` — GLB model bytes
- `POST /crop` — cropped GLB response for the selected region

Because these paths are absolute, they must resolve on the same origin as
`viewerUrl`. The viewer response must also permit embedding by the web app in
its `Content-Security-Policy: frame-ancestors` and `X-Frame-Options` headers.

The results iframe allows scripts, same-origin requests, downloads, and
fullscreen. Only trusted backend-generated viewer URLs should be placed in
project state.

## Testing the existing viewer locally

From the repository root, build the existing package and start its viewer with
an available model:

```powershell
npm run build
node server.mjs C:\path\to\property.glb --port 5173
```

The local viewer URL is `http://127.0.0.1:5173`. During backend integration,
return that URL as `viewerUrl` to verify the iframe flow before connecting the
deployed viewer service.
