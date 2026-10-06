/**
 * Dot labels, drawn as DOM elements over the canvas.
 *
 * Text stays crisp at any pixel ratio, inherits the page's font rendering and can be restyled with
 * ordinary CSS, none of which is true of text baked into a GPU texture. The cost is one element per
 * visible label, which at the scale this map is built for is nothing.
 *
 * Elements are reused between frames and only their transform is touched, so a label that has not
 * moved costs one style write per frame and no layout.
 */

import { lonLatToVec3 } from '../math/geo.ts';
import type { Vec3 } from '../math/vec3.ts';
import { LAYER_RADIUS, type Renderer, type Scene } from '../render/renderer.ts';
import type { ResolvedPoint } from '../types.ts';
import { fadeMultiplier } from '../util/fade.ts';

interface LabelEntry {
  element: HTMLElement;
  tag: HTMLElement;
  title: HTMLElement;
  extraTitle: HTMLElement;
  /** Cached measurement, refreshed only when the text changes. */
  width: number;
  height: number;
  text: string;
  visible: boolean;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class LabelLayer {
  readonly element: HTMLElement;
  private entries = new Map<string, LabelEntry>();
  private routeEntries = new Map<string, LabelEntry>();
  private document: Document;

  constructor(document: Document) {
    this.document = document;
    this.element = document.createElement('div');
    this.element.className = 'vg-labels';
  }

  /** Reposition every label for the current frame. */
  update(scene: Scene, renderer: Renderer): void {
    if (!scene.config.labels.enabled) {
      this.hideAll();
      return;
    }

    const placed: Rect[] = [];
    const seen = new Set<string>();
    const offset = scene.config.labels.offset;

    for (const point of scene.points) {
      if (!point.labelVisible || (!point.label && !point.title && !point.extraTitle)) {
        continue;
      }
      seen.add(point.id);

      const position = lonLatToVec3(point.lon, point.lat, LAYER_RADIUS.point);
      const projected = renderer.project(position, scene);
      const entry = this.entryFor(point);
      const opacity = fadeMultiplier(point.fade, point.fadeStart, scene.time);

      if (!projected.visible || opacity <= 0) {
        this.setVisible(entry, false);
        continue;
      }

      const left = projected.x + point.size + offset;
      const top = projected.y - entry.height / 2;

      if (scene.config.labels.collide) {
        const rect: Rect = { left, top, right: left + entry.width, bottom: top + entry.height };
        if (placed.some((other) => overlaps(other, rect))) {
          this.setVisible(entry, false);
          continue;
        }
        placed.push(rect);
      }

      this.setVisible(entry, true);
      this.setOpacity(entry, point.fade ? opacity : null);
      entry.element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }

    // Drop labels belonging to points that have gone away.
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        entry.element.remove();
        this.entries.delete(id);
      }
    }

    const seenRoutes = new Set<string>();

    for (const prepared of scene.routes) {
      const { route } = prepared;
      if (!route.labelVisible || (!route.label && !route.title && !route.extraTitle)) {
        continue;
      }
      seenRoutes.add(route.id);

      const position = midpoint(prepared.positions);
      const projected = renderer.project(position, scene);
      const entry = this.labelEntry(
        this.routeEntries,
        route.id,
        route.label,
        route.title,
        route.extraTitle,
        'vg-route-label',
      );
      const opacity = fadeMultiplier(route.fade, route.fadeStart, scene.time);

      if (!projected.visible || opacity <= 0) {
        this.setVisible(entry, false);
        continue;
      }

      // Centred directly on the midpoint, unlike a dot label offset to one side - there is no dot
      // here to sit next to, just a point along the line.
      const left = projected.x - entry.width / 2;
      const top = projected.y - entry.height / 2;

      if (scene.config.labels.collide) {
        const rect: Rect = { left, top, right: left + entry.width, bottom: top + entry.height };
        if (placed.some((other) => overlaps(other, rect))) {
          this.setVisible(entry, false);
          continue;
        }
        placed.push(rect);
      }

      this.setVisible(entry, true);
      this.setOpacity(entry, route.fade ? opacity : null);
      entry.element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }

    for (const [id, entry] of this.routeEntries) {
      if (!seenRoutes.has(id)) {
        entry.element.remove();
        this.routeEntries.delete(id);
      }
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.element.remove();
    }
    this.entries.clear();
    for (const entry of this.routeEntries.values()) {
      entry.element.remove();
    }
    this.routeEntries.clear();
    this.element.remove();
  }

  private entryFor(point: ResolvedPoint): LabelEntry {
    return this.labelEntry(this.entries, point.id, point.label, point.title, point.extraTitle);
  }

  /** Shared by point and route labels, which differ only in which map they are tracked in. */
  private labelEntry(
    store: Map<string, LabelEntry>,
    id: string,
    label: string | undefined,
    title: string | undefined,
    extraTitle: string | undefined,
    extraClass?: string,
  ): LabelEntry {
    let entry = store.get(id);
    const text = `${label ?? ''} ${title ?? ''} ${extraTitle ?? ''}`;

    if (!entry) {
      const element = this.document.createElement('div');
      element.className = extraClass ? `vg-label ${extraClass}` : 'vg-label';
      const tag = this.document.createElement('span');
      tag.className = 'vg-label-tag';
      const titleElement = this.document.createElement('span');
      titleElement.className = 'vg-label-title';
      const extraTitleElement = this.document.createElement('span');
      extraTitleElement.className = 'vg-label-extra-title';
      element.append(tag, titleElement, extraTitleElement);
      this.element.appendChild(element);
      entry = {
        element,
        tag,
        title: titleElement,
        extraTitle: extraTitleElement,
        width: 0,
        height: 0,
        text: '',
        visible: true,
      };
      store.set(id, entry);
    }

    if (entry.text !== text) {
      entry.text = text;
      entry.tag.textContent = label ?? '';
      entry.title.textContent = title ?? '';
      entry.extraTitle.textContent = extraTitle ?? '';
      entry.tag.hidden = !label;
      entry.title.hidden = !title;
      entry.extraTitle.hidden = !extraTitle;
      // Measured once per text change; reading these every frame would force a layout each time.
      entry.width = entry.element.offsetWidth;
      entry.height = entry.element.offsetHeight;
    }

    return entry;
  }

  private setVisible(entry: LabelEntry, visible: boolean): void {
    if (entry.visible !== visible) {
      entry.visible = visible;
      entry.element.style.display = visible ? '' : 'none';
    }
  }

  /** Pass `null` for a label with no fade. Only writes the style when the value actually changed. */
  private setOpacity(entry: LabelEntry, opacity: number | null): void {
    const value = opacity === null ? '' : String(opacity);
    if (entry.element.style.opacity !== value) {
      entry.element.style.opacity = value;
    }
  }

  private hideAll(): void {
    for (const entry of this.entries.values()) {
      this.setVisible(entry, false);
    }
    for (const entry of this.routeEntries.values()) {
      this.setVisible(entry, false);
    }
  }
}

/** Position at the curve's midpoint, i.e. halfway through its samples. */
function midpoint(positions: Float32Array): Vec3 {
  const index = Math.floor(positions.length / 3 / 2);
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

function overlaps(a: Rect, b: Rect): boolean {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}
