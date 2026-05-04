/**
 * Math helpers for the VU meter. The Canvas drawing itself can't be
 * meaningfully tested in jsdom — these tests pin the conversions and the
 * peak-decay logic, which is where the off-by-one / wrong-direction bugs
 * historically hide.
 */
import { describe, it, expect } from 'vitest';
import { mulToDb, dbToPosition, decayPeak, DB_FLOOR } from './vu-meter';

describe('mulToDb', () => {
  it('1.0 → 0 dB (unity gain)', () => {
    expect(mulToDb(1.0)).toBeCloseTo(0, 2);
  });

  it('0.5 → ~-6.02 dB (-6 dB is half-power, half-amplitude is 0.5×)', () => {
    expect(mulToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('0.001 → ~-60 dB (the floor)', () => {
    expect(mulToDb(0.001)).toBeCloseTo(-60, 0);
  });

  it('clamps zero to the floor (avoids -Infinity)', () => {
    expect(mulToDb(0)).toBe(DB_FLOOR);
  });

  it('clamps negative input to the floor (defensive — should never happen)', () => {
    expect(mulToDb(-0.5)).toBe(DB_FLOOR);
  });

  it('clamps very small values to the floor', () => {
    expect(mulToDb(1e-10)).toBe(DB_FLOOR);
  });
});

describe('dbToPosition', () => {
  it('0 dB (top) → 1.0', () => {
    expect(dbToPosition(0)).toBeCloseTo(1.0, 2);
  });

  it('-60 dB (floor) → 0', () => {
    expect(dbToPosition(-60)).toBeCloseTo(0, 2);
  });

  it('-30 dB (middle of scale) → 0.5', () => {
    expect(dbToPosition(-30)).toBeCloseTo(0.5, 2);
  });

  it('clamps positive (over-unity) input to 1.0', () => {
    expect(dbToPosition(6)).toBe(1.0);
  });

  it('clamps below-floor input to 0', () => {
    expect(dbToPosition(-100)).toBe(0);
  });
});

describe('decayPeak', () => {
  it('takes the higher of incoming sample vs prev peak', () => {
    expect(decayPeak(-12, -8, 0.5)).toBe(-8);
  });

  it('decays prev peak by dbPerFrame when incoming is much lower', () => {
    expect(decayPeak(-8, -20, 0.5)).toBe(-8.5);
  });

  it('does not decay below the incoming sample (peak hugs the rising signal)', () => {
    expect(decayPeak(-8, -7.9, 0.5)).toBe(-7.9);
  });

  it('decays toward the floor over many frames', () => {
    let p = -3;
    for (let i = 0; i < 200; i++) p = decayPeak(p, -60, 0.5);
    expect(p).toBe(-60);
  });
});
