/**
 * The stylesheet for the map's own DOM.
 *
 * Injected once per document. Colours come through custom properties set on the map root, so a theme
 * change restyles the labels without touching any element, and an application can still override any
 * of it from its own stylesheet.
 */

const STYLE_ID = 'vectorglobe-styles';

const CSS = `
.vg-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.vg-root canvas {
  display: block;
  position: absolute;
  inset: 0;
}
.vg-root:focus-visible {
  outline: 2px solid var(--vg-point, #ffb347);
  outline-offset: -2px;
}
.vg-labels {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.vg-label {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 5px;
  border-radius: 3px;
  background: var(--vg-label-background, rgba(8, 16, 26, 0.72));
  color: var(--vg-label, #e8eef4);
  font: 500 11px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif;
  white-space: nowrap;
  will-change: transform;
}
.vg-label-tag {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.vg-label-title {
  font-weight: 400;
  font-size: 10px;
  opacity: 0.75;
}
.vg-label-extra-title {
  font-weight: 400;
  font-size: 10px;
  opacity: 0.55;
}
.vg-route-label {
  background: var(--vg-route-label-background, rgba(8, 16, 26, 0.72));
  color: var(--vg-route-label, #e8eef4);
}
`;

/** Add the stylesheet to the document if it is not already there. */
export function injectStyles(target: Document): void {
  if (target.getElementById(STYLE_ID)) {
    return;
  }
  const style = target.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  target.head.appendChild(style);
}
