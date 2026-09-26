/**
 * Captions that follow the narrator, using the per-word timings the build
 * resolved from ElevenLabs' character alignment.
 */

export function renderCaption(element, stop) {
  element.replaceChildren(
    ...stop.words.map((word) => {
      const span = document.createElement("span");
      span.textContent = word.text;
      span.dataset.start = String(word.start);
      span.dataset.end = String(word.end);
      return span;
    })
  );
}

/** Marks the word being spoken, and dims the ones still to come. */
export function highlightCaption(element, time) {
  for (const span of element.children) {
    const start = Number(span.dataset.start);
    const end = Number(span.dataset.end);
    span.classList.toggle("spoken", time >= end);
    span.classList.toggle("speaking", time >= start && time < end);
  }
}

export function clearCaption(element) {
  element.replaceChildren();
}
