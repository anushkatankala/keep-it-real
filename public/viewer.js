import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const AXIS = { x: 0, y: 1, z: 2 };
const dom = new Proxy({}, { get: (_, id) => document.getElementById(id) });

const meta = await fetch("/meta").then((response) => response.json());
const upIndex = AXIS[meta.up];
const [uName, vName] = meta.horizontal;
const uIndex = AXIS[uName];
const vIndex = AXIS[vName];

const min = new THREE.Vector3().fromArray(meta.bounds.min);
const max = new THREE.Vector3().fromArray(meta.bounds.max);
const centre = min.clone().add(max).multiplyScalar(0.5);
const upVector = new THREE.Vector3().setComponent(upIndex, 1);
const groundPlane = new THREE.Plane(upVector.clone(), -min.getComponent(upIndex));
const span = Math.max(max.getComponent(uIndex) - min.getComponent(uIndex), max.getComponent(vIndex) - min.getComponent(vIndex));

dom.model.textContent = `${meta.name} · ${meta.triangles.toLocaleString()} triangles · ${(meta.bytes / 1e6).toFixed(1)} MB`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
dom.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c0f);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.copy(centre).addScaledVector(upVector, span);
scene.add(sun);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -span * 20, span * 20);
camera.up.copy(upVector);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.copy(centre);

// OrbitControls zooms an orthographic camera via camera.zoom, so the frustum
// here only tracks the window's aspect ratio.
function resize() {
  const half = (span * 1.12) / 2;
  camera.left = -half * (innerWidth / innerHeight);
  camera.right = half * (innerWidth / innerHeight);
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize);

const vVector = new THREE.Vector3().setComponent(vIndex, 1);

/**
 * Straight down, with the v axis pointing up the screen.
 *
 * The camera cannot sit exactly on the pole: OrbitControls keeps camera.up
 * aligned to the model's vertical so orbiting feels right, and lookAt is
 * degenerate when up is parallel to the view direction, which leaves the roll
 * arbitrary. Nudging a hair along v fixes the roll; the resulting 0.006 degree
 * tilt moves a 13 m rooftop by under 2 mm.
 */
function topView() {
  camera.position
    .copy(centre)
    .addScaledVector(upVector, span * 2)
    .addScaledVector(vVector, -span * 1e-4);
  camera.lookAt(centre);
  controls.target.copy(centre);
  controls.update();
}

/** Degrees between the view direction and straight down. */
function tiltDegrees() {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return THREE.MathUtils.radToDeg(forward.angleTo(upVector.clone().negate()));
}

// ---------------------------------------------------------------- model

const loader = new GLTFLoader().setDRACOLoader(
  new DRACOLoader().setDecoderPath("/vendor/three/examples/jsm/libs/draco/")
);
let current = null;

function show(object) {
  if (current) {
    scene.remove(current);
    current.traverse((child) => {
      child.geometry?.dispose();
      for (const material of [child.material].flat().filter(Boolean)) {
        material.map?.dispose();
        material.dispose();
      }
    });
  }
  current = object;
  scene.add(object);
}

async function loadOriginal() {
  status("Loading model…");
  const gltf = await loader.loadAsync("/model");
  show(gltf.scene);
  status("");
}

// ---------------------------------------------------------------- selection

let region = null;
let rotation = 0;
let outline = null;

/** The four corners of the region at a given height, turned by its rotation. */
function regionCorners(level) {
  const centreU = (region.minU + region.maxU) / 2;
  const centreV = (region.minV + region.maxV) / 2;
  const halfU = (region.maxU - region.minU) / 2;
  const halfV = (region.maxV - region.minV) / 2;
  const radians = THREE.MathUtils.degToRad(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return [
    [-halfU, -halfV],
    [halfU, -halfV],
    [halfU, halfV],
    [-halfU, halfV]
  ].map(([du, dv]) => {
    const point = new THREE.Vector3();
    point.setComponent(uIndex, centreU + du * cos - dv * sin);
    point.setComponent(vIndex, centreV + du * sin + dv * cos);
    point.setComponent(upIndex, level);
    return point;
  });
}

function drawOutline() {
  if (outline) {
    scene.remove(outline);
    outline.geometry.dispose();
    outline.material.dispose();
    outline = null;
  }
  if (!region) return;

  const floor = regionCorners(min.getComponent(upIndex));
  const roof = regionCorners(max.getComponent(upIndex));
  const points = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    points.push(floor[i], floor[next], roof[i], roof[next], floor[i], roof[i]);
  }

  outline = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x4f9dff })
  );
  scene.add(outline);
}

function setRegion(next) {
  region = next;
  drawOutline();
  for (const id of ["crop", "clear", "grow", "shrink"]) dom[id].disabled = !region;

  dom.readout.innerHTML = region
    ? `<dt>${uName}</dt><dd>${region.minU.toFixed(1)} → ${region.maxU.toFixed(1)}</dd>` +
      `<dt>${vName}</dt><dd>${region.minV.toFixed(1)} → ${region.maxV.toFixed(1)}</dd>` +
      `<dt>size</dt><dd>${(region.maxU - region.minU).toFixed(1)} × ${(region.maxV - region.minV).toFixed(1)} m</dd>` +
      `<dt>angle</dt><dd>${rotation.toFixed(0)}°</dd>`
    : `<dt>model</dt><dd>${(max.getComponent(uIndex) - min.getComponent(uIndex)).toFixed(1)} × ` +
      `${(max.getComponent(vIndex) - min.getComponent(vIndex)).toFixed(1)} m</dd>`;
}

function setRotation(degrees) {
  rotation = ((degrees + 180) % 360 + 360) % 360 - 180;
  dom.rotate.value = String(rotation);
  dom.rotateValue.textContent = `${rotation.toFixed(0)}°`;
  setRegion(region);
}

const raycaster = new THREE.Raycaster();
const hit = new THREE.Vector3();

/** Screen pixel to a point on the model's ground plane. */
function groundPoint(x, y) {
  const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -((y / innerHeight) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit.clone() : null;
}

/**
 * The ground region covered by a screen rectangle. All four corners are
 * projected, not just two, because from a tilted view the rectangle covers a
 * trapezoid on the ground and its bounding box is what actually gets cropped.
 */
function regionFromPixels(a, b) {
  const corners = [
    groundPoint(a.x, a.y),
    groundPoint(b.x, a.y),
    groundPoint(a.x, b.y),
    groundPoint(b.x, b.y)
  ].filter(Boolean);
  if (corners.length < 2) return null;

  // Measure the drag in the turned frame, so a box drawn while the slider is
  // set stays square to the building rather than to the world axes.
  const radians = THREE.MathUtils.degToRad(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const originU = centre.getComponent(uIndex);
  const originV = centre.getComponent(vIndex);

  const along = [];
  const across = [];
  for (const point of corners) {
    const du = point.getComponent(uIndex) - originU;
    const dv = point.getComponent(vIndex) - originV;
    along.push(du * cos + dv * sin);
    across.push(-du * sin + dv * cos);
  }

  const halfAlong = (Math.max(...along) - Math.min(...along)) / 2;
  const halfAcross = (Math.max(...across) - Math.min(...across)) / 2;
  const midAlong = (Math.max(...along) + Math.min(...along)) / 2;
  const midAcross = (Math.max(...across) + Math.min(...across)) / 2;

  const centreU = originU + midAlong * cos - midAcross * sin;
  const centreV = originV + midAlong * sin + midAcross * cos;

  return {
    minU: centreU - halfAlong,
    maxU: centreU + halfAlong,
    minV: centreV - halfAcross,
    maxV: centreV + halfAcross
  };
}

let drawing = false;
let anchorPixel = null;

/**
 * Draw mode puts orbiting on the right button so a box can be drawn and the
 * model inspected without switching modes. Orbit mode is the familiar mapping.
 */
function setMode(mode) {
  drawing = mode === "draw";
  dom.draw.classList.toggle("active", drawing);
  dom.orbit.classList.toggle("active", !drawing);
  controls.mouseButtons.LEFT = drawing ? null : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = drawing ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = drawing ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY;
  dom.hint.textContent = drawing
    ? "Left-drag to draw a box · right-drag to rotate · middle-drag to pan · scroll to zoom"
    : "Left-drag to rotate · right-drag to pan · scroll to zoom";
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!drawing || event.button !== 0) return;
  anchorPixel = { x: event.clientX, y: event.clientY };
  dom.marquee.style.display = "block";
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!anchorPixel) return;
  const style = dom.marquee.style;
  style.left = `${Math.min(anchorPixel.x, event.clientX)}px`;
  style.top = `${Math.min(anchorPixel.y, event.clientY)}px`;
  style.width = `${Math.abs(event.clientX - anchorPixel.x)}px`;
  style.height = `${Math.abs(event.clientY - anchorPixel.y)}px`;

  const live = regionFromPixels(anchorPixel, { x: event.clientX, y: event.clientY });
  if (live) setRegion(live);
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!anchorPixel) return;
  const moved = Math.hypot(event.clientX - anchorPixel.x, event.clientY - anchorPixel.y);
  const start = anchorPixel;
  anchorPixel = null;
  dom.marquee.style.display = "none";

  if (moved < 6) return;
  const next = regionFromPixels(start, { x: event.clientX, y: event.clientY });
  if (!next) return;
  setRegion(next);
  status(`Selected ${(next.maxU - next.minU).toFixed(1)} × ${(next.maxV - next.minV).toFixed(1)} m — press Crop`);
});

// ---------------------------------------------------------------- actions

let croppedBlob = null;

function status(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle("error", isError);
}

async function crop() {
  if (!region) return;
  dom.crop.disabled = true;
  status("Cropping…");

  try {
    const response = await fetch("/crop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        region: { ...region, rotation },
        select: dom.overlapping.checked ? "overlapping" : "centroid"
      })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);

    const kept = Number(response.headers.get("x-kept-triangles"));
    const total = Number(response.headers.get("x-total-triangles"));
    croppedBlob = await response.blob();

    const gltf = await loader.parseAsync(await croppedBlob.arrayBuffer(), "");
    show(gltf.scene);
    dom.download.disabled = false;
    dom.reset.disabled = false;
    status(`Kept ${kept.toLocaleString()} of ${total.toLocaleString()} triangles (${((kept / total) * 100).toFixed(1)}%)`);
  } catch (error) {
    status(error.message, true);
  } finally {
    dom.crop.disabled = false;
  }
}

function resizeRegion(metres) {
  if (!region) return;
  const next = {
    minU: region.minU - metres,
    maxU: region.maxU + metres,
    minV: region.minV - metres,
    maxV: region.maxV + metres
  };
  if (next.maxU - next.minU < 0.5 || next.maxV - next.minV < 0.5) return;
  setRegion(next);
}

function updateTilt() {
  const degrees = tiltDegrees();
  const square = degrees < 2;
  dom.tilt.classList.toggle("warn", !square);
  dom.tilt.textContent = square
    ? ""
    : `View is ${degrees.toFixed(0)}° off vertical — a box drawn now covers its full ground area. Use Top view for a tight fit.`;
}

dom.draw.onclick = () => setMode("draw");
dom.orbit.onclick = () => setMode("orbit");
dom.top.onclick = topView;
dom.grow.onclick = () => resizeRegion(1);
dom.shrink.onclick = () => resizeRegion(-1);
dom.rotate.oninput = (event) => setRotation(Number(event.target.value));
dom.clear.onclick = () => {
  setRegion(null);
  status("");
};

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const step = event.shiftKey ? 5 : 1;
  if (event.key === "[") setRotation(rotation - step);
  else if (event.key === "]") setRotation(rotation + step);
  else if (event.key === "t") topView();
  else return;
  event.preventDefault();
});
dom.crop.onclick = crop;
dom.download.onclick = () => {
  const url = URL.createObjectURL(croppedBlob);
  const anchorElement = document.createElement("a");
  anchorElement.href = url;
  anchorElement.download = meta.name.replace(/\.glb$/i, "") + "-cropped.glb";
  anchorElement.click();
  URL.revokeObjectURL(url);
};
dom.reset.onclick = async () => {
  await loadOriginal();
  dom.download.disabled = true;
  dom.reset.disabled = true;
};

controls.addEventListener("change", updateTilt);

resize();
topView();
setMode("draw");
setRegion(null);
updateTilt();
await loadOriginal();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
