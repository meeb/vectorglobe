/**
 * A small typed event emitter.
 *
 * Handlers are isolated from each other: one throwing does not stop the rest or break the frame that
 * dispatched it.
 */

import type { GlobeEventHandler, GlobeEventMap, GlobeEventName } from '../types.ts';

type HandlerSet = Set<(payload: unknown) => void>;

export class Emitter {
  private handlers = new Map<GlobeEventName, HandlerSet>();

  on<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
  }

  off<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as (payload: unknown) => void);
  }

  emit<E extends GlobeEventName>(event: E, payload: GlobeEventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    // Copied so a handler that unsubscribes during dispatch cannot disturb the iteration.
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`vectorglobe: error in "${event}" handler`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
