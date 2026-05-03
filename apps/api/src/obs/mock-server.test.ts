import { describe, it, expect } from 'vitest';
import { OBSWebSocket } from 'obs-websocket-js';
import { startMockObs } from './mock-server.js';

describe('mock obs-websocket server', () => {
  it('completes handshake and answers GetVersion', async () => {
    const mock = await startMockObs({ password: null });
    const obs = new OBSWebSocket();
    try {
      await obs.connect(`ws://127.0.0.1:${mock.port}`);
      const v = await obs.call('GetVersion');
      expect(v.obsVersion).toBeDefined();
    } finally {
      await obs.disconnect();
      await mock.close();
    }
  });

  it('rejects connection with wrong password', async () => {
    const mock = await startMockObs({ password: 'pw' });
    const obs = new OBSWebSocket();
    try {
      await expect(
        obs.connect(`ws://127.0.0.1:${mock.port}`, 'wrong')
      ).rejects.toThrow();
    } finally {
      await mock.close();
    }
  });

  it('emits CurrentProgramSceneChanged when triggered', async () => {
    const mock = await startMockObs({ password: null });
    const obs = new OBSWebSocket();
    try {
      await obs.connect(`ws://127.0.0.1:${mock.port}`);
      const got = new Promise<string>((resolve) => {
        obs.on('CurrentProgramSceneChanged', (e) => resolve(e.sceneName));
      });
      mock.changeProgramScene('Scene 2');
      expect(await got).toBe('Scene 2');
    } finally {
      await obs.disconnect();
      await mock.close();
    }
  });
});
