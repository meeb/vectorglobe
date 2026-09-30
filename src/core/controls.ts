/**
 * Input handling.
 *
 * This translates pointer, wheel, touch and keyboard input into intent, and hands that to the map.
 * It deliberately knows nothing about the camera model or the projection, so the same gestures work
 * in both 3D and 2D.
 *
 * Gestures:
 *   drag                     spin the globe, or pan the 2D map
 *   shift drag, right drag   tilt and turn
 *   wheel, pinch             zoom
 *   arrow keys               spin, with shift to tilt and turn
 *   plus and minus           zoom
 */

export interface ControlsDelegate {
  /** Drag distance in CSS pixels. */
  rotate(deltaX: number, deltaY: number): void;
  /** Tilt and bearing drag distance in CSS pixels. */
  tilt(deltaX: number, deltaY: number): void;
  /** Multiplicative zoom, below 1 moves closer. */
  zoom(factor: number): void;
  /** Pointer moved to a position relative to the container. */
  pointerMove(x: number, y: number, event: PointerEvent): void;
  /** Pointer left the map. */
  pointerLeave(): void;
  /** A click that was not part of a drag. */
  click(x: number, y: number, event: MouseEvent): void;
  /** Any deliberate interaction, used to pause idle rotation. */
  interact(): void;
}

/** Drag shorter than this many pixels still counts as a click rather than a drag. */
const CLICK_SLOP = 4;

/** Degrees of rotation applied per key press. */
const KEY_STEP = 6;

/** A +/- keypress zooms by this many wheel notches worth of `zoomSpeed`, applied at once. */
const KEY_ZOOM_NOTCHES = 4;

interface ActivePointer {
  x: number;
  y: number;
}

export class Controls {
  private element: HTMLElement;
  private delegate: ControlsDelegate;
  private enabled: boolean;
  private zoomSpeed: number;

  private pointers = new Map<number, ActivePointer>();
  private dragging = false;
  private tilting = false;
  private moved = 0;
  private pinchDistance = 0;
  private lastX = 0;
  private lastY = 0;

  private readonly listeners: Array<() => void> = [];

  constructor(
    element: HTMLElement,
    delegate: ControlsDelegate,
    enabled: boolean,
    zoomSpeed: number,
  ) {
    this.element = element;
    this.delegate = delegate;
    this.enabled = enabled;
    this.zoomSpeed = zoomSpeed;
    this.attach();
  }

  setZoomSpeed(zoomSpeed: number): void {
    this.zoomSpeed = zoomSpeed;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointers.clear();
      this.dragging = false;
      this.tilting = false;
    }
    this.element.style.cursor = enabled ? 'grab' : '';
    this.element.tabIndex = enabled ? 0 : -1;
  }

  destroy(): void {
    for (const remove of this.listeners) {
      remove();
    }
    this.listeners.length = 0;
    this.pointers.clear();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K | string,
    handler: (event: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    const wrapped = handler as EventListener;
    target.addEventListener(type, wrapped, options);
    this.listeners.push(() => target.removeEventListener(type, wrapped, options));
  }

  private attach(): void {
    this.element.style.touchAction = 'none';
    this.setEnabled(this.enabled);

    this.listen(this.element, 'pointerdown', (event: PointerEvent) => this.onPointerDown(event));
    this.listen(this.element, 'pointermove', (event: PointerEvent) => this.onPointerMove(event));
    this.listen(this.element, 'pointerup', (event: PointerEvent) => this.onPointerUp(event));
    this.listen(this.element, 'pointercancel', (event: PointerEvent) => this.onPointerUp(event));
    this.listen(this.element, 'pointerleave', () => this.delegate.pointerLeave());
    this.listen(this.element, 'wheel', (event: WheelEvent) => this.onWheel(event), {
      passive: false,
    });
    this.listen(this.element, 'keydown', (event: KeyboardEvent) => this.onKeyDown(event));
    // Right dragging is a tilt gesture, so the browser menu would only get in the way.
    this.listen(this.element, 'contextmenu', (event: MouseEvent) => {
      if (this.enabled) {
        event.preventDefault();
      }
    });
  }

  private localPosition(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.enabled) {
      return;
    }
    const position = this.localPosition(event);
    this.pointers.set(event.pointerId, position);
    this.element.setPointerCapture?.(event.pointerId);

    if (this.pointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance();
      this.dragging = false;
      return;
    }

    this.dragging = true;
    this.tilting = event.shiftKey || event.button === 2 || event.button === 1;
    this.moved = 0;
    this.lastX = position.x;
    this.lastY = position.y;
    this.element.style.cursor = 'grabbing';
    this.delegate.interact();
  }

  private onPointerMove(event: PointerEvent): void {
    const position = this.localPosition(event);

    if (!this.enabled) {
      this.delegate.pointerMove(position.x, position.y, event);
      return;
    }

    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, position);
    }

    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        this.delegate.zoom(this.pinchDistance / distance);
        this.delegate.interact();
      }
      this.pinchDistance = distance;
      return;
    }

    if (!this.dragging) {
      this.delegate.pointerMove(position.x, position.y, event);
      return;
    }

    const deltaX = position.x - this.lastX;
    const deltaY = position.y - this.lastY;
    this.lastX = position.x;
    this.lastY = position.y;
    this.moved += Math.abs(deltaX) + Math.abs(deltaY);

    if (this.tilting) {
      this.delegate.tilt(deltaX, deltaY);
    } else {
      this.delegate.rotate(deltaX, deltaY);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const wasDragging = this.dragging;
    const moved = this.moved;
    this.pointers.delete(event.pointerId);
    this.element.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size < 2) {
      this.pinchDistance = 0;
    }
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.tilting = false;
      this.element.style.cursor = this.enabled ? 'grab' : '';
    }

    if (this.enabled && wasDragging && moved < CLICK_SLOP) {
      const position = this.localPosition(event);
      this.delegate.click(position.x, position.y, event);
    }
  }

  private onWheel(event: WheelEvent): void {
    if (!this.enabled) {
      return;
    }
    event.preventDefault();
    // deltaMode 1 is lines and 2 is pages; normalise both to something close to a pixel scroll.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const amount = (event.deltaY * scale) / 100;
    this.delegate.zoom(this.zoomSpeed ** amount);
    this.delegate.interact();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.enabled) {
      return;
    }
    // Keyboard steps are expressed as an equivalent drag distance in pixels.
    const step = KEY_STEP * 4;
    const nudge = (x: number, y: number): void => {
      if (event.shiftKey) {
        this.delegate.tilt(x, y);
      } else {
        this.delegate.rotate(-x, -y);
      }
    };
    let handled = true;

    switch (event.key) {
      case 'ArrowLeft':
        nudge(-step, 0);
        break;
      case 'ArrowRight':
        nudge(step, 0);
        break;
      case 'ArrowUp':
        nudge(0, -step);
        break;
      case 'ArrowDown':
        nudge(0, step);
        break;
      case '+':
      case '=':
        // A single keypress is one deliberate action, not a continuous gesture like the wheel, so
        // it is worth several wheel notches rather than the bare per-notch speed.
        this.delegate.zoom(1 / this.zoomSpeed ** KEY_ZOOM_NOTCHES);
        break;
      case '-':
      case '_':
        this.delegate.zoom(this.zoomSpeed ** KEY_ZOOM_NOTCHES);
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      this.delegate.interact();
    }
  }

  private currentPinchDistance(): number {
    const [a, b] = Array.from(this.pointers.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
