# Web AR Museum

A no-install Web AR test app: open the link, pick an image and a video, then point your phone's camera at that image to play the video projected on top of it — tracked live, in the browser, on both Android and iOS.

## Stack and why

| Piece | Choice | Why |
|---|---|---|
| Image tracking | [MindAR](https://hiukim.github.io/mind-ar-js-doc/) | The most stable, actively-used web AR tracking engine that runs on plain camera video (`getUserMedia`) instead of the WebXR Device API. iOS Safari has never shipped WebXR, so a WebXR-based approach (e.g. native `<model-viewer>`/Scene Viewer AR, or three.js WebXR AR) simply doesn't run on iPhone. MindAR works identically in Chrome on Android and Safari on iOS. |
| Rendering | [three.js](https://threejs.org/) | MindAR's official three.js integration; renders the video as a textured plane locked to the tracked image's pose. |
| Target compilation | MindAR's in-browser `Compiler` | Normally MindAR wants a pre-built `.mind` file. Its `Compiler` class runs the same feature-extraction step live in the browser (via a Web Worker), so a **user-uploaded** image can become an AR target on the fly, with no server or build step. |
| App shell | Plain HTML/CSS/JS + [Vite](https://vitejs.dev/) (dev server only) | The app has no backend and nothing to bundle — MindAR and three.js are loaded from a version-pinned CDN via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap). Vite is used only to serve the files locally with HTTPS (see below); the deployed site is fully static. |

## How it works

1. You pick an image and a video file. Both stay on-device — nothing is uploaded to a server.
2. The image is downscaled (max 1024px) and run through MindAR's `Compiler` in your browser, producing a compact binary "target" describing its trackable features.
3. Your camera starts, and MindAR's tracker looks for that target in the video feed every frame.
4. When it's found, a three.js plane sized to the image's aspect ratio is positioned exactly on top of it, textured with your video (`THREE.VideoTexture`), and the video plays. Losing the target pauses playback; finding it again resumes.

## Local development

```bash
npm install
npm run dev
```

Vite prints a `https://localhost:5173` URL and a `https://<your-lan-ip>:5173` one. Camera access requires a secure context, so to test on a phone during development, open the LAN URL on the phone (same Wi-Fi as your computer) and accept the self-signed certificate warning (dev only — the deployed site gets a real certificate).

## Deploying

The site is fully static (`index.html`, `src/`) — no server or build step is required, though `npm run build` (outputs to `dist/`) works if you want a bundled copy. It can be hosted anywhere that serves static files over HTTPS: GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc. HTTPS is mandatory — browsers refuse camera access on plain HTTP for any host other than `localhost`.

## Tips for good tracking

- Use a flat, high-contrast, detailed image (a poster, photo, or painting) — plain colors or simple logos with large blank areas track poorly.
- Print or display the image at a reasonable size and keep it well lit and unobstructed.
- Video files are looped and stretched to fill the image's bounds; audio plays once your camera view is active (browsers may require a manual "Unmute" tap first if autoplay-with-sound is blocked).

## Browser support

Chrome/Edge/Firefox on Android, and Safari 13+ on iOS. Camera access requires HTTPS (or `localhost`).
