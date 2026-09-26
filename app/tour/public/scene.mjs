/**
 * Reference implementation of the TourScene interface from CONTRACT.md.
 *
 * Two concentric inside-out spheres carry the panoramas so one can dissolve
 * into the next, plus an exterior mode that orbits the real photogrammetry GLB.
 * The director only ever calls the five contract methods, so the interactive
 * walkthrough can replace this wholesale once it exists.
 *
 * Axes: three.js X is the plan's +U, Z is its -V, Y is up. A heading of 0 looks
 * along +X and increases clockwise seen from above, matching targets.mjs.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { placeholderPanorama } from "./placeholder.mjs";

const SPHERE_RADIUS = 100;
const DEFAULT_FOV = 72;
const MAX_PITCH = 85;

const degToRad = (degrees) => (degrees * Math.PI) / 180;

/** Shortest signed turn from `a` to `b`, so a pan never takes the long way. */
function headingDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Unit vector for a heading and pitch, in the three.js frame described above. */
function direction(heading, pitch) {
  const h = degToRad(heading);
  const p = degToRad(pitch);
  return new THREE.Vector3(Math.cos(p) * Math.cos(h), Math.sin(p), Math.cos(p) * Math.sin(h));
}

/**
 * Rotates a model from the plan's axes into the scene's. OpenDroneMap output is
 * z-up with x and y horizontal, but the plan names its axes explicitly, so this
 * reads them rather than assuming. A negative determinant would mirror the
 * house, so the V row is flipped when the permutation comes out left-handed.
 */
function axisMatrix(plan) {
  const column = { x: 0, y: 1, z: 2 };
  const [uName, vName] = plan?.horizontal ?? ["x", "y"];
  const upName = plan?.up ?? "z";

  const row = (name, sign) => {
    const values = [0, 0, 0];
    values[column[name] ?? 0] = sign;
    return values;
  };

  const build = (vSign) => {
    const [u, up, v] = [row(uName, 1), row(upName, 1), row(vName, vSign)];
    // prettier-ignore
    return new THREE.Matrix4().set(
      u[0],  u[1],  u[2],  0,
      up[0], up[1], up[2], 0,
      v[0],  v[1],  v[2],  0,
      0,     0,     0,     1
    );
  };

  const matrix = build(-1);
  return matrix.determinant() < 0 ? build(1) : matrix;
}

export class PanoScene {
  /**
   * @param container element to render into
   * @param options.panoUrl  (roomId) => url of that room's equirectangular image
   * @param options.roomOf   (roomId) => room record from plan.json, for placeholders
   * @param options.targetsOf (roomId) => named targets, drawn on placeholders
   */
  constructor(container, { panoUrl, roomOf, targetsOf, plan } = {}) {
    this.container = container;
    this.panoUrl = panoUrl ?? (() => null);
    this.roomOf = roomOf ?? (() => null);
    this.targetsOf = targetsOf ?? (() => ({}));
    this.axes = axisMatrix(plan);
    this.bounds = plan?.bounds ?? null;

    this.mode = "room";
    this.heading = 0;
    this.pitch = 0;
    this.fov = DEFAULT_FOV;
    this.driftSpeed = 0;
    this.tween = null;
    this.interactive = false;
    this.roomId = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 5000);

    this.layers = [0, 1].map((index) => this.#createLayer(index));
    this.activeLayer = 0;
    this.fade = null;

    this.exterior = new THREE.Group();
    this.exterior.visible = false;
    this.scene.add(this.exterior);
    this.exteriorCentre = new THREE.Vector3();
    this.exteriorDistance = 30;

    this.textures = new Map();
    this.loader = new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath("/vendor/three/examples/jsm/libs/draco/")
    );

    this.#attachPointer();
    this.resize = this.resize.bind(this);
    addEventListener("resize", this.resize);
    this.resize();
  }

  #createLayer(index) {
    // Scaling x by -1 turns the sphere inside out without mirroring the image.
    // That also moves the texture's centre column to -X, so the mesh is spun
    // half a turn to bring it back to heading 0.
    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 40);
    geometry.scale(-1, 1, 1);

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: index === 0 ? 1 : 0,
      depthTest: false,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI;
    mesh.renderOrder = 10 + index;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, material };
  }

  #attachPointer() {
    const canvas = this.renderer.domElement;
    let dragging = null;

    canvas.addEventListener("pointerdown", (event) => {
      if (!this.interactive) return;
      dragging = { x: event.clientX, y: event.clientY, heading: this.heading, pitch: this.pitch };
      this.tween = null;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const scale = this.fov / this.container.clientHeight;
      this.heading = dragging.heading - (event.clientX - dragging.x) * scale;
      this.pitch = THREE.MathUtils.clamp(dragging.pitch + (event.clientY - dragging.y) * scale, -MAX_PITCH, MAX_PITCH);
    });

    const release = () => {
      dragging = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  async #textureFor(roomId) {
    if (this.textures.has(roomId)) return this.textures.get(roomId);

    const url = this.panoUrl(roomId);
    let texture = null;

    if (url) {
      texture = await new THREE.TextureLoader()
        .loadAsync(url)
        .catch(() => null);
    }
    if (!texture) {
      texture = new THREE.CanvasTexture(placeholderPanorama(this.roomOf(roomId), this.targetsOf(roomId)));
    }

    const image = texture.image;
    const ratio = image?.width && image?.height ? image.width / image.height : 2;
    // A real panorama is 2:1. The demo rooms are ordinary photos, so both the
    // click-to-walk tour and the automated tour must frame that same picture
    // instead of panning around a stretched sphere.
    texture.userData.equirect = Math.abs(ratio - 2) < 0.08;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.textures.set(roomId, texture);
    return texture;
  }

  /** True when this room is a flat photo that should stay centred in both tours. */
  isEquirect(roomId) {
    return this.textures.get(roomId)?.userData.equirect !== false;
  }

  #photoLocked() {
    const map = this.layers[this.activeLayer]?.material.map;
    return Boolean(map && map.userData.equirect === false);
  }

  /** Warms a room's texture so its crossfade does not stall. Optional extra. */
  prefetch(roomId) {
    return this.#textureFor(roomId).catch(() => null);
  }

  // ------------------------------------------------------------- contract

  async showRoom(roomId, { fade = 900 } = {}) {
    const texture = await this.#textureFor(roomId);
    const incoming = this.layers[1 - this.activeLayer];
    const outgoing = this.layers[this.activeLayer];

    incoming.material.map = texture;
    incoming.material.needsUpdate = true;
    incoming.material.opacity = fade > 0 ? 0 : 1;
    incoming.mesh.visible = true;

    this.roomId = roomId;
    this.mode = "room";
    this.activeLayer = 1 - this.activeLayer;

    if (texture.userData.equirect === false) {
      this.heading = 0;
      this.pitch = 0;
      this.driftSpeed = 0;
      this.tween = null;
    }

    if (fade > 0) {
      this.fade = { incoming, outgoing, elapsed: 0, duration: fade };
    } else {
      outgoing.mesh.visible = false;
      outgoing.material.opacity = 0;
      this.exterior.visible = false;
      this.fade = null;
    }
  }

  async showExterior(glbUrl) {
    this.mode = "exterior";
    this.exterior.visible = true;

    for (const layer of this.layers) {
      layer.material.opacity = 0;
      layer.mesh.visible = false;
    }
    this.fade = null;

    if (this.exterior.children.length > 0) return;

    this.exterior.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(1, 2, 1).multiplyScalar(40);
    this.exterior.add(sun);

    const gltf = glbUrl ? await this.loader.loadAsync(glbUrl).catch(() => null) : null;
    const model = gltf?.scene ?? this.#placeholderHouse();

    model.applyMatrix4(this.axes);
    this.exterior.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.exteriorCentre.copy(sphere.center);
    this.exteriorDistance = Math.max(sphere.radius * 2.4, 12);
    this.camera.far = this.exteriorDistance * 20;
    this.camera.updateProjectionMatrix();
  }

  lookAt({ heading, pitch, fov } = {}, { duration = 1200, ease = easeInOutCubic } = {}) {
    if (this.#photoLocked()) {
      heading = 0;
      pitch = 0;
    }
    const target = {
      heading: heading ?? this.heading,
      pitch: pitch ?? this.pitch,
      fov: fov ?? this.fov
    };

    if (duration <= 0) {
      this.heading = target.heading;
      this.pitch = target.pitch;
      this.fov = target.fov;
      this.tween = null;
      return;
    }

    this.tween = {
      from: { heading: this.heading, pitch: this.pitch, fov: this.fov },
      delta: headingDelta(this.heading, target.heading),
      to: target,
      elapsed: 0,
      duration,
      ease
    };
  }

  drift(degreesPerSecond) {
    this.driftSpeed = this.#photoLocked() ? 0 : degreesPerSecond;
  }

  setInteractive(enabled) {
    this.interactive = enabled;
    this.renderer.domElement.style.cursor = enabled ? "grab" : "default";
  }

  // ------------------------------------------------------------- frame

  update(dt) {
    if (this.tween) {
      this.tween.elapsed += dt * 1000;
      const k = this.tween.ease(Math.min(1, this.tween.elapsed / this.tween.duration));
      this.heading = this.tween.from.heading + this.tween.delta * k;
      this.pitch = THREE.MathUtils.lerp(this.tween.from.pitch, this.tween.to.pitch, k);
      this.fov = THREE.MathUtils.lerp(this.tween.from.fov, this.tween.to.fov, k);
      if (this.tween.elapsed >= this.tween.duration) {
        this.heading = this.tween.to.heading;
        this.tween = null;
      }
    } else if (this.driftSpeed !== 0) {
      this.heading += this.driftSpeed * dt;
    }

    if (this.fade) {
      this.fade.elapsed += dt * 1000;
      const k = Math.min(1, this.fade.elapsed / this.fade.duration);
      this.fade.incoming.material.opacity = k;
      this.fade.outgoing.material.opacity = 1 - k;
      if (k >= 1) {
        this.fade.outgoing.mesh.visible = false;
        if (this.mode === "room") this.exterior.visible = false;
        this.fade = null;
      }
    }

    const forward = direction(this.heading, this.pitch);
    if (this.mode === "exterior") {
      this.camera.position.copy(this.exteriorCentre).addScaledVector(forward, this.exteriorDistance);
      this.camera.lookAt(this.exteriorCentre);
    } else {
      this.camera.position.set(0, 0, 0);
      this.camera.lookAt(forward);
    }

    // The panorama spheres travel with the camera, so a room can dissolve in
    // over the exterior shot without the camera ever leaving its inside.
    for (const layer of this.layers) layer.mesh.position.copy(this.camera.position);

    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Stands in for the house until photogrammetry has produced a GLB. Sized
   * from the plan's own bounds so the opening shot frames the same volume the
   * real model will occupy, and is built in plan axes like a loaded GLB would
   * be, so the caller's axis transform applies to it unchanged.
   */
  #placeholderHouse() {
    const min = this.bounds?.min ?? [-9, -6, 0];
    const max = this.bounds?.max ?? [9, 6, 6];
    const width = Math.abs(max[0] - min[0]);
    const depth = Math.abs(max[1] - min[1]);
    const total = Math.abs(max[2] - min[2]);
    const wallHeight = total * 0.7;

    const group = new THREE.Group();

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(width, depth, wallHeight),
      new THREE.MeshStandardMaterial({ color: 0x8d8f96, roughness: 0.9 })
    );
    walls.position.z = min[2] + wallHeight / 2;

    // A four-sided cone is a hipped roof. Its base vertices sit on the
    // diagonals, so the radius is scaled up to reach the corners.
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry((Math.max(width, depth) / 2) * Math.SQRT2 * 0.62, total - wallHeight, 4),
      new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.85 })
    );
    roof.rotation.x = Math.PI / 2;
    roof.rotation.y = Math.PI / 4;
    roof.position.z = min[2] + wallHeight + (total - wallHeight) / 2;

    group.add(walls, roof);
    return group;
  }

  dispose() {
    removeEventListener("resize", this.resize);
    for (const texture of this.textures.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
