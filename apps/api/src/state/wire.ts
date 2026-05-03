import type { ConnectionManager } from '../obs/connection-manager.js';
import type { StateStore } from './state-store.js';
import type { EventCoalescer } from './event-coalescer.js';

export function wireOBSToState(
  mgr: ConnectionManager,
  store: StateStore,
  coalescer: EventCoalescer
): void {
  mgr.on('status', (e) => {
    store.upsertConnection(e.connId);
    coalescer.applySnapshot(e.connId, { status: e.status });
  });
  mgr.on('snapshot', (snap) => {
    store.upsertConnection(snap.connId);
    coalescer.applySnapshot(snap.connId, {
      currentProgramScene: snap.currentProgramScene,
      currentPreviewScene: snap.currentPreviewScene,
      scenes: snap.scenes,
      inputs: snap.inputs.map((i) => ({
        name: i.name,
        kind: i.kind,
        muted: false,
        volumeDb: 0,
        volumeMul: 1,
        syncOffsetMs: 0,
        levels: [],
      })),
    });
  });
  mgr.on('obsEvent', (e) => coalescer.handle(e.connId, e.eventType, e.eventData));
}
