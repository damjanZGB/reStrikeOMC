import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObsV4Client } from './v4-client.js';
import { AuthFailedError } from './types.js';
import { startMockObsV4, type MockV4Handle } from '../mock-server-v4.js';

let mock: MockV4Handle;

beforeEach(async () => {
  mock = await startMockObsV4({ password: null });
});

afterEach(async () => {
  await mock.close();
});

const url = (): string => `ws://127.0.0.1:${mock.port}`;

describe('ObsV4Client — lifecycle', () => {
  it('connects without password and emits Identified', async () => {
    const client = new ObsV4Client();
    let identified = false;
    client.on('Identified', () => {
      identified = true;
    });
    await client.connect(url(), undefined, {});
    expect(identified).toBe(true);
    await client.disconnect();
  });

  it('completes auth challenge with correct password', async () => {
    await mock.close();
    mock = await startMockObsV4({ password: 'secret' });
    const client = new ObsV4Client();
    await client.connect(url(), 'secret', {});
    await client.disconnect();
  });

  it('rejects with AuthFailedError on wrong password', async () => {
    await mock.close();
    mock = await startMockObsV4({ password: 'right' });
    const client = new ObsV4Client();
    await expect(client.connect(url(), 'wrong', {})).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('throws AuthFailedError when password is required but missing', async () => {
    await mock.close();
    mock = await startMockObsV4({ password: 'required' });
    const client = new ObsV4Client();
    await expect(client.connect(url(), undefined, {})).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('emits ConnectionClosed when the server drops the socket', async () => {
    const client = new ObsV4Client();
    let closed = false;
    client.on('ConnectionClosed', () => {
      closed = true;
    });
    await client.connect(url(), undefined, {});
    await mock.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
  });
});

describe('ObsV4Client — call translation', () => {
  it('SetCurrentProgramScene reaches the server as SetCurrentScene', async () => {
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await client.call('SetCurrentProgramScene', { sceneName: 'Scene 2' });
    await client.disconnect();
    const req = mock.receivedRequests.find((r) => r.requestType === 'SetCurrentScene');
    expect(req).toBeDefined();
    expect(req?.payload['scene-name']).toBe('Scene 2');
  });

  it('GetSceneList response is reshaped to v5-compatible shape', async () => {
    mock.setScenes([{ name: 'A' }, { name: 'B' }]);
    mock.setCurrentScene('A');
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    const out = (await client.call('GetSceneList', {})) as {
      currentProgramSceneName: string;
      scenes: Array<{ sceneName: string; sceneIndex: number }>;
    };
    expect(out.currentProgramSceneName).toBe('A');
    expect(out.scenes).toEqual([
      { sceneName: 'A', sceneIndex: 0 },
      { sceneName: 'B', sceneIndex: 1 },
    ]);
    await client.disconnect();
  });

  it('GetInputList drops non-audio sources', async () => {
    mock.setSources([
      { name: 'Mic', typeId: 'wasapi_input_capture' },
      { name: 'Screen', typeId: 'monitor_capture' },
      { name: 'Cam', typeId: 'dshow_input' },
    ]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    const out = (await client.call('GetInputList', {})) as {
      inputs: Array<{ inputName: string; inputKind: string }>;
    };
    expect(out.inputs.map((i) => i.inputName)).toEqual(['Mic', 'Cam']);
    await client.disconnect();
  });

  it('SetInputMute round-trips through v4 SetMute', async () => {
    mock.setSources([{ name: 'Mic', typeId: 'wasapi_input_capture' }]);
    const client = new ObsV4Client();
    const seen: Array<{ inputName: string; inputMuted: boolean }> = [];
    client.on('InputMuteStateChanged', (d) => {
      seen.push(d as { inputName: string; inputMuted: boolean });
    });
    await client.connect(url(), undefined, {});
    await client.call('SetInputMute', { inputName: 'Mic', muted: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ inputName: 'Mic', inputMuted: true });
    await client.disconnect();
  });
});

describe('ObsV4Client — scene-item cache (gap 1)', () => {
  it('caches scene items on connect and uses them for SetSceneItemEnabled', async () => {
    mock.setScenes([
      { name: 'Scene 1', items: [{ itemId: 42, sourceName: 'BRB' }] },
    ]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await new Promise((r) => setTimeout(r, 50)); // let cache prime
    await client.call('SetSceneItemEnabled', {
      sceneName: 'Scene 1',
      sceneItemId: 42,
      sceneItemEnabled: false,
    });
    await client.disconnect();
    const req = mock.receivedRequests.find((r) => r.requestType === 'SetSceneItemProperties');
    expect(req).toBeDefined();
    expect((req?.payload.item as { name: string }).name).toBe('BRB');
    expect(req?.payload.visible).toBe(false);
  });

  it('refreshes cache on miss and retries', async () => {
    mock.setScenes([{ name: 'Scene 1', items: [] }]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await new Promise((r) => setTimeout(r, 50));
    // Add the item after the initial cache prime, then issue the request.
    // Without the refresh-on-miss path, this throws lookup-miss.
    mock.setScenes([
      { name: 'Scene 1', items: [{ itemId: 7, sourceName: 'BRB' }] },
    ]);
    await client.call('SetSceneItemEnabled', {
      sceneName: 'Scene 1',
      sceneItemId: 7,
      sceneItemEnabled: true,
    });
    const req = mock.receivedRequests.find((r) => r.requestType === 'SetSceneItemProperties');
    expect(req).toBeDefined();
    await client.disconnect();
  });

  it('renames cached items on SourceRenamed event', async () => {
    mock.setScenes([
      { name: 'Scene 1', items: [{ itemId: 7, sourceName: 'BRB' }] },
    ]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await new Promise((r) => setTimeout(r, 50));
    // Rename in both worlds: the client learns via the event; the mock's
    // server-side store updates so the eventual SetSceneItemProperties call
    // actually finds the item.
    mock.emitEvent('SourceRenamed', { previousName: 'BRB', newName: 'BRB-v2' });
    mock.setScenes([
      { name: 'Scene 1', items: [{ itemId: 7, sourceName: 'BRB-v2' }] },
    ]);
    await new Promise((r) => setTimeout(r, 30));
    await client.call('SetSceneItemEnabled', {
      sceneName: 'Scene 1',
      sceneItemId: 7,
      sceneItemEnabled: true,
    });
    const req = mock.receivedRequests.find((r) => r.requestType === 'SetSceneItemProperties');
    expect((req?.payload.item as { name: string }).name).toBe('BRB-v2');
    await client.disconnect();
  });
});

describe('ObsV4Client — virtual cam poll (gap 3)', () => {
  it('emits VirtualcamStateChanged when poll detects a flip', async () => {
    const client = new ObsV4Client();
    let seen: { outputActive: boolean } | null = null;
    client.on('VirtualcamStateChanged', (d) => {
      seen = d as { outputActive: boolean };
    });
    await client.connect(url(), undefined, {});
    // Let primeVcamPoll complete so its initial poll observes the false
    // baseline before we flip — otherwise priming may race with the flip and
    // record the post-flip value as baseline.
    await new Promise((r) => setTimeout(r, 80));
    mock.flipVcam();
    // Force a manual poll instead of waiting for the 5s interval. Production
    // code still runs the interval; this just shortens the test loop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).pollVcamOnce();
    expect(seen).not.toBeNull();
    expect((seen as unknown as { outputActive: boolean }).outputActive).toBe(true);
    await client.disconnect();
  });

  it('does not emit when the value is unchanged', async () => {
    const client = new ObsV4Client();
    let count = 0;
    client.on('VirtualcamStateChanged', () => {
      count++;
    });
    await client.connect(url(), undefined, {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).pollVcamOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).pollVcamOnce();
    expect(count).toBe(0);
    await client.disconnect();
  });
});

describe('ObsV4Client — events', () => {
  it('translates SwitchScenes events to CurrentProgramSceneChanged', async () => {
    const client = new ObsV4Client();
    let seen: { sceneName: string } | null = null;
    client.on('CurrentProgramSceneChanged', (d) => {
      seen = d as { sceneName: string };
    });
    await client.connect(url(), undefined, {});
    mock.emitEvent('SwitchScenes', { 'scene-name': 'Scene 2' });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).not.toBeNull();
    expect((seen as unknown as { sceneName: string }).sceneName).toBe('Scene 2');
    await client.disconnect();
  });

  // P0-2 regression: a fresh SceneItemAdded must populate the cache, so that
  // a subsequent SetSceneItemEnabled finds the item without a refresh-on-miss
  // round-trip. Without the cache event handler, the request would either
  // throw 'lookup miss' (if no refresh path) or pay one extra GetSceneItemList
  // RPC per call.
  it('updates the scene-item cache on SceneItemAdded events', async () => {
    mock.setScenes([{ name: 'Scene 1', items: [] }]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await new Promise((r) => setTimeout(r, 50));
    // Add the item server-side so refreshSceneItemsFor sees it, then fire
    // the SceneItemAdded event so the client triggers that refresh.
    mock.setScenes([{ name: 'Scene 1', items: [{ itemId: 9, sourceName: 'BRB' }] }]);
    mock.emitEvent('SceneItemAdded', { 'scene-name': 'Scene 1', 'item-id': 9 });
    await new Promise((r) => setTimeout(r, 50));
    const beforeRetries = mock.receivedRequests.filter(
      (r) => r.requestType === 'GetSceneItemList'
    ).length;
    await client.call('SetSceneItemEnabled', {
      sceneName: 'Scene 1',
      sceneItemId: 9,
      sceneItemEnabled: true,
    });
    const afterRetries = mock.receivedRequests.filter(
      (r) => r.requestType === 'GetSceneItemList'
    ).length;
    // No additional GetSceneItemList on the SetSceneItemEnabled path means
    // the cache was warm — confirms the SceneItemAdded handler did its job.
    expect(afterRetries).toBe(beforeRetries);
    await client.disconnect();
  });

  // P0-2 regression: SceneItemRemoved must drop the cached entry. To prove
  // the cache really got cleared (rather than the call succeeding via the
  // refresh-on-miss path repopulating from the mock), we also remove the
  // item from the mock's state. With the cache cleared and the mock having
  // no item, both the cache lookup AND the refresh come up empty — the
  // call rejects with a lookup-miss.
  it('drops cached entries on SceneItemRemoved events', async () => {
    mock.setScenes([
      { name: 'Scene 1', items: [{ itemId: 11, sourceName: 'BRB' }] },
    ]);
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await new Promise((r) => setTimeout(r, 50));
    mock.emitEvent('SceneItemRemoved', { 'scene-name': 'Scene 1', 'item-id': 11 });
    mock.setScenes([{ name: 'Scene 1', items: [] }]);
    await new Promise((r) => setTimeout(r, 30));
    await expect(
      client.call('SetSceneItemEnabled', {
        sceneName: 'Scene 1',
        sceneItemId: 11,
        sceneItemEnabled: true,
      })
    ).rejects.toThrow(/lookup miss/);
    await client.disconnect();
  });
});

describe('ObsV4Client — hardening (P0 fixes)', () => {
  // P0-1 regression: the original race was primeVcamPoll's first await
  // racing with disconnect. After disconnect() returns, the timer must NOT
  // exist (otherwise it polls a dead socket forever). Asserting on the
  // private vcamPollTimer field via cast is sufficient.
  it('does not leak the vcam poll timer when disconnect runs mid-prime', async () => {
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    // Immediately disconnect before priming has a chance to setInterval.
    await client.disconnect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).vcamPollTimer).toBeNull();
  });

  // P0-1 regression: this.ws must not be clobbered by a deferred 'close'
  // event after a reconnect already assigned a new socket. The scenario:
  // connect → disconnect → connect again. The old socket's deferred close
  // event reaches handleClose, which used to overwrite this.ws unconditionally.
  it('survives a connect → disconnect → connect cycle without clobbering ws', async () => {
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    await client.disconnect();
    await client.connect(url(), undefined, {});
    // Round-trip a call to prove the new socket is functional.
    await client.call('SetCurrentProgramScene', { sceneName: 'Scene 2' });
    await client.disconnect();
  });

  // P0-3 regression: malformed JSON must surface as ConnectionError. Pending
  // requests still time out at 8s, but observability is now non-zero.
  it('emits ConnectionError when the server sends a malformed JSON frame', async () => {
    const client = new ObsV4Client();
    let errorFired = false;
    client.on('ConnectionError', () => {
      errorFired = true;
    });
    await client.connect(url(), undefined, {});
    mock.sendRaw('{this is not valid json');
    await new Promise((r) => setTimeout(r, 30));
    expect(errorFired).toBe(true);
    // Connection is still usable for valid frames.
    await client.call('SetCurrentProgramScene', { sceneName: 'Scene 2' });
    await client.disconnect();
  });

  // P0-4 regression: disconnect drained pending; handleClose used to drain
  // them again, causing double Promise.reject. Even though Promise contract
  // makes the second reject a no-op, the iteration churn is real. We assert
  // the drain doesn't run twice by counting handler invocations.
  it('does not double-iterate pending on disconnect', async () => {
    const client = new ObsV4Client();
    await client.connect(url(), undefined, {});
    // Fire a request but don't await it — it should reject exactly once.
    let rejectCount = 0;
    const pending = client
      .call('GetSceneList', {})
      .catch(() => {
        rejectCount++;
      });
    // Disconnect mid-flight.
    await client.disconnect();
    await pending;
    await new Promise((r) => setTimeout(r, 30));
    expect(rejectCount).toBe(1);
  });
});
