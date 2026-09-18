// Imported by the exact same URL the page's import map resolves the bare
// "three" specifier to (see index.html), so this is the same module
// instance mind-ar's bundle uses internally — required for its
// `instanceof` checks against three's classes to work, and it also lets
// Vite's dev server treat this as an external URL it doesn't try to
// resolve from node_modules (this project has no npm-installed three/mind-ar
// on purpose, to avoid native build tooling).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js";
import { Compiler } from "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";
import { MindARThree } from "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

// Longest side an uploaded target image is downscaled to before feature
// extraction. Full-resolution phone photos (3000px+) make the compiler slow
// and don't improve tracking quality — MindAR's own CLI tool recommends the
// same kind of cap.
const MAX_TARGET_DIMENSION = 1024;

const els = {
  uploadScreen: document.getElementById("upload-screen"),
  loadingScreen: document.getElementById("loading-screen"),
  arScreen: document.getElementById("ar-screen"),
  form: document.getElementById("upload-form"),
  imageInput: document.getElementById("image-input"),
  videoInput: document.getElementById("video-input"),
  imagePreview: document.getElementById("image-preview"),
  imagePreviewImg: document.getElementById("image-preview-img"),
  videoPreview: document.getElementById("video-preview"),
  videoPreviewEl: document.getElementById("video-preview-el"),
  startBtn: document.getElementById("start-btn"),
  errorMessage: document.getElementById("error-message"),
  loadingText: document.getElementById("loading-text"),
  progressFill: document.getElementById("progress-fill"),
  arContainer: document.getElementById("ar-container"),
  arHint: document.getElementById("ar-hint"),
  stopBtn: document.getElementById("stop-btn"),
  unmuteBtn: document.getElementById("unmute-btn")
};

let mindarThree = null;
let currentContentVideo = null;

function showScreen(name) {
  for (const key of ["uploadScreen", "loadingScreen", "arScreen"]) {
    els[key].hidden = key !== name;
  }
}

function setError(message) {
  if (!message) {
    els.errorMessage.hidden = true;
    els.errorMessage.textContent = "";
    return;
  }
  els.errorMessage.hidden = false;
  els.errorMessage.textContent = message;
}

function setLoading(text, percent) {
  els.loadingText.textContent = text;
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

// --- File previews -------------------------------------------------------

let imagePreviewUrl = null;
let videoPreviewUrl = null;

function updateStartEnabled() {
  els.startBtn.disabled = !(els.imageInput.files[0] && els.videoInput.files[0]);
}

els.imageInput.addEventListener("change", () => {
  const file = els.imageInput.files[0];
  setError(null);
  if (file) console.log("Selected image:", file.name, file.type, file.size, "bytes");
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  if (file) {
    imagePreviewUrl = URL.createObjectURL(file);
    els.imagePreviewImg.src = imagePreviewUrl;
    els.imagePreview.hidden = false;
  } else {
    els.imagePreview.hidden = true;
  }
  updateStartEnabled();
});

els.videoInput.addEventListener("change", () => {
  const file = els.videoInput.files[0];
  setError(null);
  if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
  if (file) {
    videoPreviewUrl = URL.createObjectURL(file);
    els.videoPreviewEl.src = videoPreviewUrl;
    els.videoPreview.hidden = false;
  } else {
    els.videoPreview.hidden = true;
  }
  updateStartEnabled();
});

// --- Helpers ---------------------------------------------------------------

// createImageBitmap decodes straight from the File/Blob (no object URL
// needed) and handles a wider range of real-world phone photos — including
// EXIF-rotated JPEGs and formats some browsers' <img> tag chokes on — more
// reliably than the <img>+object-URL route. It's supported in every current
// mobile browser, but we still fall back to <img> for older ones.
async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { img: bitmap, url: null };
    } catch (err) {
      console.warn("createImageBitmap failed, falling back to <img>:", err);
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      console.error("Image failed to decode:", file.type, file.name, event);
      reject(new Error(`Could not read that image (${file.type || "unknown type"}). Try a JPEG or PNG.`));
    };
    img.src = url;
  });
}

// Downscale onto a canvas so the compiler works on a reasonably sized
// image regardless of the original photo resolution. Returns the canvas
// (which the compiler can read via drawImage, same as an <img>) plus the
// final width/height used for the AR plane's aspect ratio.
function toProcessCanvas(img) {
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_TARGET_DIMENSION / Math.max(naturalWidth, naturalHeight));
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  if (typeof img.close === "function") img.close(); // release the ImageBitmap
  return { canvas, width, height };
}

function loadVideoElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";

    // Some mobile browsers barely load media elements that aren't attached
    // to the document — metadata events can stall indefinitely on a
    // detached <video>, which is what left this stuck on "Finishing up".
    // Kept out of the layout (not display:none, which itself can pause a
    // video used as a texture) rather than truly hidden.
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.appendChild(video);

    let settled = false;
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
      clearTimeout(timeoutId);
    };
    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ video, url });
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      video.remove();
      URL.revokeObjectURL(url);
      console.error("Video failed to load:", file.type, file.name, video.error);
      reject(new Error(`Could not read that video (${file.type || "unknown type"}). Try an MP4 (H.264) file.`));
    };
    const timeoutId = setTimeout(() => {
      if (settled) return;
      console.warn("Video metadata timed out after 15s, readyState:", video.readyState);
      onError();
    }, 15000);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);

    video.src = url;
    video.load();
  });
}

// --- Main flow ---------------------------------------------------------

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(null);

  const imageFile = els.imageInput.files[0];
  const videoFile = els.videoInput.files[0];
  if (!imageFile || !videoFile) return;

  els.startBtn.disabled = true;
  showScreen("loadingScreen");
  setLoading("Reading image…", 0);

  let compiledMindUrl = null;
  let video = null;
  let videoUrl = null;
  let loadedImageUrl = null;

  try {
    const { img, url: imgUrl } = await loadImage(imageFile);
    loadedImageUrl = imgUrl;
    const { canvas, width, height } = toProcessCanvas(img);
    const aspectHeight = height / width;

    setLoading("Analyzing image for tracking…", 2);
    const compiler = new Compiler();
    await compiler.compileImageTargets([canvas], (percent) => {
      setLoading("Analyzing image for tracking…", percent);
    });

    setLoading("Finishing up…", 100);
    const buffer = compiler.exportData();
    compiledMindUrl = URL.createObjectURL(new Blob([buffer]));

    const loaded = await loadVideoElement(videoFile);
    video = loaded.video;
    videoUrl = loaded.url;
    video.pause();

    await startAR({ imageTargetSrc: compiledMindUrl, video, aspectHeight });
  } catch (err) {
    console.error(err);
    if (compiledMindUrl) URL.revokeObjectURL(compiledMindUrl);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (video) video.remove();
    showScreen("uploadScreen");
    els.startBtn.disabled = false;
    setError(err && err.message ? err.message : "Something went wrong starting AR. Please try again.");
  } finally {
    if (loadedImageUrl) URL.revokeObjectURL(loadedImageUrl);
  }
});

async function startAR({ imageTargetSrc, video, aspectHeight }) {
  els.arHint.textContent = "Starting camera…";
  els.arHint.classList.remove("is-hidden");
  els.unmuteBtn.hidden = true;
  showScreen("arScreen");

  mindarThree = new MindARThree({
    container: els.arContainer,
    imageTargetSrc,
    uiLoading: "no",
    uiScanning: "no",
    uiError: "no"
  });

  const { renderer, scene, camera } = mindarThree;
  const anchor = mindarThree.addAnchor(0);
  currentContentVideo = video;

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geometry = new THREE.PlaneGeometry(1, aspectHeight);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(geometry, material);
  anchor.group.add(plane);

  anchor.onTargetFound = () => {
    els.arHint.classList.add("is-hidden");
    video.play().catch(() => {});
  };
  anchor.onTargetLost = () => {
    els.arHint.textContent = "Point the camera at your image";
    els.arHint.classList.remove("is-hidden");
    video.pause();
  };

  try {
    await mindarThree.start();
  } catch (err) {
    mindarThree = null;
    throw new Error("Camera access was denied or is unavailable. Allow camera access and try again.");
  }

  els.arHint.textContent = "Point the camera at your image";

  // Try to play with sound now that a camera stream is live; browsers may
  // still block unmuted autoplay if too much time has passed since the tap
  // that started this flow, so fall back to a muted loop plus a visible
  // "Unmute" button the user can tap (a fresh, guaranteed-valid gesture).
  video.muted = false;
  const playAttempt = video.play();
  if (playAttempt && typeof playAttempt.catch === "function") {
    playAttempt.catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      els.unmuteBtn.hidden = false;
    });
  }

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}

els.unmuteBtn.addEventListener("click", () => {
  if (currentContentVideo) {
    currentContentVideo.muted = false;
    currentContentVideo.play().catch(() => {});
  }
  els.unmuteBtn.hidden = true;
});

els.stopBtn.addEventListener("click", () => {
  // A full reload guarantees the camera stream, WebGL context and tracking
  // worker are all torn down cleanly instead of hand-rolling teardown.
  try {
    if (mindarThree) mindarThree.stop();
  } catch (err) {
    // ignore, we're reloading anyway
  }
  window.location.reload();
});
