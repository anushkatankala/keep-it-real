# 360° Tour Builder Pro — Integration Guide

This folder contains the standalone `index.html` for the **360° Tour Builder Pro** application. It is a single-file vanilla HTML/CSS/JS app with no build step and no external dependencies (all CDN-loaded).

## Why it lives in `public/`

Next.js server-side renders (SSR) all pages by default. This app:
- Uses `window`, `document`, and DOM APIs immediately on load
- Initializes Pannellum viewer which requires a live browser environment
- Has inline `<script>` tags that execute on parse

If imported as a React component, it causes **hydration mismatches**, **`window is not defined`** errors, and SSR crashes.  
Placing it in `public/` serves it as a static asset, bypassing Next.js compilation entirely.

---

## 1. Direct Browser Access

Once the dev server (`npm run dev`) or production server is running, the builder is available at:

```
/360-tour-builder/index.html
```

Example: `http://localhost:3000/360-tour-builder/index.html`

Open this URL directly in a new tab to use the full builder UI (sidebar, minimap, hotspot editor, export, etc.).

---

## 2. Embedding in a Next.js Page (via `<iframe>`)

Create a page like `src/app/tour-builder/page.tsx` (App Router) or `pages/tour-builder.tsx` (Pages Router):

```tsx
// src/app/tour-builder/page.tsx  (Next.js 13+ App Router)
export default function TourBuilderPage() {
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <iframe
        src="/360-tour-builder/index.html"
        width="100%"
        height="100%"
        style={{ border: 'none', display: 'block' }}
        title="360° Tour Builder"
        allowFullScreen
      />
    </div>
  );
}
```

```tsx
// pages/tour-builder.tsx  (Legacy Pages Router)
export default function TourBuilderPage() {
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      <iframe
        src="/360-tour-builder/index.html"
        width="100%"
        height="100%"
        style={{ border: 'none', display: 'block' }}
        title="360° Tour Builder"
        allowFullScreen
      />
    </div>
  );
}
```

### Notes
- The iframe fills the viewport (`100vh`). Adjust height if you have a header/navbar.
- `allowFullScreen` enables the Pannellum fullscreen button inside the iframe.
- The builder exports a standalone `.html` file (Admin or Player). That exported file can also be served from `public/` and embedded the same way.

---

## 3. Communicating with the Iframe (Optional)

If your Next.js app needs to send data **into** the builder (e.g., pre-load a floor plan, set a user token) or receive data **out** (e.g., get the exported tour HTML), use `window.postMessage`:

### Next.js Parent → Iframe (Send Data)

```tsx
'use client';

import { useEffect, useRef } from 'react';

export default function TourBuilderPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      iframe.contentWindow?.postMessage(
        { type: 'INIT_DATA', payload: { userId: '123', projectId: 'abc' } },
        '*' // Restrict to your origin in production: 'https://yourdomain.com'
      );
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/360-tour-builder/index.html"
      width="100%"
      height="100%"
      style={{ border: 'none' }}
      title="360° Tour Builder"
      allowFullScreen
    />
  );
}
```

### Inside `index.html` (Listen for Messages)

Add this inside the main `<script>` block of `index.html` (or ask the builder maintainer to add it):

```js
window.addEventListener('message', (event) => {
  // Validate origin in production!
  // if (event.origin !== 'https://yourdomain.com') return;

  if (event.data?.type === 'INIT_DATA') {
    const { userId, projectId } = event.data.payload;
    console.log('Received from parent:', userId, projectId);
    // e.g., pre-fill UI, load a saved project via SAVED_STATE, etc.
  }
});
```

### Iframe → Next.js Parent (Send Export Back)

Inside `index.html`, after generating the export blob:

```js
// Example: after export confirmation
const exportBlob = new Blob([generatedHTML], { type: 'text/html' });
const exportURL = URL.createObjectURL(exportBlob);

window.parent.postMessage(
  { type: 'TOUR_EXPORTED', payload: { url: exportURL, filename: 'my-tour.html' } },
  '*' // Restrict in production
);
```

In the Next.js parent page:

```tsx
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'TOUR_EXPORTED') {
      const { url, filename } = event.data.payload;
      // Trigger download, upload to your API, etc.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
  };
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

---

## 4. Export & Deployment

- The builder's **Save** button produces a single `.html` file (Admin or Player).
- That file is self-contained and can be:
  - Served from `public/tours/my-tour.html` and embedded in another iframe.
  - Uploaded to any static host (Vercel, Netlify, S3, GitHub Pages).
  - Sent to clients via email/WhatsApp (it runs offline after load).

---

## 5. Updating the Builder

To update the builder:
1. Replace `public/360-tour-builder/index.html` with the new version.
2. Commit and push.
3. No rebuild of the Next.js app is required (static file only).

---

## Files in This Folder

| File | Description |
|------|-------------|
| `index.html` | The standalone 360° Tour Builder Pro application |
| `INTEGRATION.md` | This guide |

---

## Support

For issues with the builder itself (Pannellum, hotspots, export logic), refer to the original repository or contact the builder maintainer. For Next.js integration issues (iframe sizing, CSP, postMessage), check this guide and Next.js docs.