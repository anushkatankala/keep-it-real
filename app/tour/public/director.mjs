/**
 * Plays a built tour against anything implementing the TourScene interface.
 *
 * The clock is the narration's own playback position rather than a timer, so
 * pausing, resuming and skipping stay in sync for free. When a tour was built
 * without an ElevenLabs key there is no audio, and the same loop runs on a
 * virtual clock using the estimated timings instead.
 */

const DEFAULT_FADE_MS = 900;

export class Director {
  /**
   * @param scene   object implementing showExterior, showRoom, lookAt, drift, setInteractive
   * @param tour    parsed tour.json
   * @param options.audioBase  prefix for stop.audio paths
   * @param options.modelUrl   GLB for the exterior stop
   */
  constructor(scene, tour, { audioBase = "", modelUrl = null, onChange } = {}) {
    this.scene = scene;
    this.tour = tour;
    this.stops = tour.stops ?? [];
    this.audioBase = audioBase;
    this.modelUrl = modelUrl;
    this.onChange = onChange ?? (() => {});

    this.index = -1;
    this.time = 0;
    this.playing = false;
    this.finished = false;
    this.fired = new Set();
    this.audio = new Map();

    // Silent tours have no audio to read a position from, so they are timed
    // against the wall clock. Accumulating per-frame deltas would lose time
    // whenever a frame runs long, and frames run very long in a background tab.
    this.clockStart = 0;
    this.clockOffset = 0;
  }

  get stop() {
    return this.stops[this.index] ?? null;
  }

  get elapsedBefore() {
    return this.stops.slice(0, Math.max(this.index, 0)).reduce((sum, stop) => sum + stop.duration, 0);
  }

  /** Fetches the narration up front so a stop never begins with silence. */
  preload() {
    for (const stop of this.stops) {
      if (!stop.audio || this.audio.has(stop.id)) continue;
      const element = new Audio(`${this.audioBase}${stop.audio}`);
      element.preload = "auto";
      this.audio.set(stop.id, element);
    }
  }

  async goTo(index, { autoplay = this.playing } = {}) {
    const clamped = Math.max(0, Math.min(index, this.stops.length - 1));
    this.#stopAudio();

    this.index = clamped;
    this.time = 0;
    this.fired.clear();
    this.finished = false;
    this.clockOffset = 0;
    this.clockStart = performance.now();

    const stop = this.stop;
    this.scene.drift(0);

    if (stop.kind === "exterior") {
      await this.scene.showExterior(this.modelUrl);
    } else {
      await this.scene.showRoom(stop.roomId, { fade: clamped === 0 ? 0 : DEFAULT_FADE_MS });
    }

    // Warm the next room's texture so its crossfade does not stall.
    const next = this.stops[clamped + 1];
    if (next?.roomId) this.scene.prefetch?.(next.roomId);

    this.#applyDue();
    this.onChange(this);

    if (autoplay) this.play();
  }

  play() {
    if (this.stops.length === 0) return;
    if (this.index === -1) {
      this.playing = true;
      this.goTo(0, { autoplay: true });
      return;
    }
    if (this.finished) {
      this.playing = true;
      this.goTo(0, { autoplay: true });
      return;
    }

    this.playing = true;
    this.clockStart = performance.now();
    this.scene.setInteractive(false);
    const element = this.audio.get(this.stop?.id);
    if (element) element.play().catch(() => {});
    this.onChange(this);
  }

  pause() {
    this.playing = false;
    this.clockOffset = this.time;
    this.audio.get(this.stop?.id)?.pause();
    this.scene.setInteractive(true);
    this.onChange(this);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next() {
    if (this.index >= this.stops.length - 1) {
      this.#finish();
      return;
    }
    this.goTo(this.index + 1);
  }

  previous() {
    // Restart the current stop first, the way a scrub-back button usually behaves.
    if (this.time > 2 || this.index === 0) this.goTo(this.index);
    else this.goTo(this.index - 1);
  }

  restart() {
    this.goTo(0, { autoplay: true });
  }

  tick() {
    if (!this.playing || !this.stop) return;

    const element = this.audio.get(this.stop.id);
    if (element && !element.paused && element.currentTime > 0) {
      this.time = element.currentTime;
    } else {
      this.time = this.clockOffset + (performance.now() - this.clockStart) / 1000;
    }

    this.#applyDue();
    this.onChange(this);

    if (this.time >= this.stop.duration) this.next();
  }

  /** Fires every camera keyframe whose moment has arrived, exactly once. */
  #applyDue() {
    const stop = this.stop;
    if (!stop) return;

    stop.camera.forEach((keyframe, index) => {
      if (this.fired.has(index) || keyframe.at > this.time) return;
      this.fired.add(index);

      if (keyframe.type === "drift") {
        this.scene.drift(keyframe.speed);
        return;
      }

      if (keyframe.type === "orbit") {
        // One long sweep spanning the rest of the stop, so the exterior is
        // still turning as the narration ends.
        this.scene.lookAt(
          { heading: keyframe.from, pitch: keyframe.elevation, fov: keyframe.fov },
          { duration: 0 }
        );
        this.scene.lookAt(
          { heading: keyframe.to, pitch: keyframe.elevation, fov: keyframe.fov },
          { duration: Math.max((stop.duration - keyframe.at) * 1000, 1) }
        );
        return;
      }

      this.scene.lookAt(
        { heading: keyframe.heading, pitch: keyframe.pitch, fov: keyframe.fov },
        { duration: keyframe.duration ?? 1200 }
      );
    });
  }

  #finish() {
    this.playing = false;
    this.finished = true;
    this.#stopAudio();
    this.scene.drift(1.2);
    this.scene.setInteractive(true);
    this.onChange(this);
  }

  #stopAudio() {
    const element = this.audio.get(this.stop?.id);
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  }
}
