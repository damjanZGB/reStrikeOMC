import { useEffect, useRef } from 'react';
import type { InputState } from '@restrike/shared';

/**
 * Linear OBS-multiplier → dBFS, clamped to a usable display range.
 *
 * obs-websocket emits per-channel values as linear amplitude multipliers
 * (`inputLevelsMul`), where 1.0 == unity (the fader at 100%, no headroom)
 * and 0 == silence. dB = 20·log10(mul). Below DB_FLOOR a meter is just
 * "silent" visually so we clamp instead of returning -Infinity.
 */
export const DB_FLOOR = -60;
export const DB_CEILING = 0;

export function mulToDb(mul: number): number {
  if (mul <= 0) return DB_FLOOR;
  const db = 20 * Math.log10(mul);
  return Math.max(DB_FLOOR, db);
}

/** Map a dB value into [0, 1] across the [DB_FLOOR, DB_CEILING] window. */
export function dbToPosition(db: number): number {
  const clamped = Math.max(DB_FLOOR, Math.min(DB_CEILING, db));
  return (clamped - DB_FLOOR) / (DB_CEILING - DB_FLOOR);
}

/**
 * Peak-hold with frame-rate decay. Whichever is higher between the previous
 * peak (minus a fixed dB-per-frame decrement) and the incoming sample wins.
 * This produces the floating peak line that lingers above a falling signal —
 * the same behavior OBS's own mixer exhibits, and what users will visually
 * expect.
 */
export function decayPeak(
  prevPeakDb: number,
  sampleDb: number,
  dbPerFrame: number
): number {
  return Math.max(sampleDb, prevPeakDb - dbPerFrame);
}

// IEC-style breakpoints used by OBS's internal mixer too.
const ZONE_GREEN_TOP_DB = -20;
const ZONE_YELLOW_TOP_DB = -9;
const PEAK_DECAY_DB_PER_FRAME = 0.5;

interface VuMeterProps {
  levels: InputState['levels'];
  muted?: boolean;
  /** Total CSS pixel height of the meter (channels stack inside this). */
  height?: number;
}

/**
 * Canvas-based audio meter with green/yellow/red dB zones and peak hold.
 *
 * Why Canvas + rAF rather than CSS bars: meter samples arrive ~30×/sec, with
 * potentially many channels across many tiles. A CSS bar that changes width
 * triggers a layout pass per channel per frame; Canvas is one paint per frame
 * regardless. The component reads the latest levels through a ref (updated on
 * each prop change) so the render loop never re-creates listeners.
 */
export function VuMeter({ levels, muted = false, height = 6 }: VuMeterProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestLevelsRef = useRef(levels);
  const peaksDbRef = useRef<number[]>([]);

  // Keep the ref in sync with prop changes — the rAF loop reads from the ref.
  latestLevelsRef.current = levels;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let stopped = false;

    function readZoneColors(): { green: string; yellow: string; red: string; track: string } {
      const styles = getComputedStyle(canvas!);
      const get = (name: string, fallback: string): string => {
        const v = styles.getPropertyValue(name).trim();
        return v.length > 0 ? `hsl(${v})` : fallback;
      };
      return {
        green: get('--vu-green', 'hsl(145 65% 45%)'),
        yellow: get('--vu-yellow', 'hsl(45 95% 55%)'),
        red: get('--vu-red', 'hsl(0 75% 55%)'),
        track: get('--vu-track', 'hsl(220 14% 14%)'),
      };
    }

    function draw(): void {
      if (stopped) return;
      frame += 1;

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas!.clientWidth;
      const cssH = canvas!.clientHeight;
      if (cssW === 0 || cssH === 0) {
        // Element not laid out yet — try again next frame.
        requestAnimationFrame(draw);
        return;
      }
      // Resize backing store only if needed (cheap when dimensions stable).
      const targetW = Math.floor(cssW * dpr);
      const targetH = Math.floor(cssH * dpr);
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW;
        canvas!.height = targetH;
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, cssW, cssH);

      const colors = readZoneColors();
      const channels = latestLevelsRef.current;
      const channelCount = Math.max(1, channels.length);
      const gap = channelCount > 1 ? 1 : 0;
      const channelH = (cssH - gap * (channelCount - 1)) / channelCount;

      // Pre-build the IEC-zoned gradient — the colors stay anchored to dB
      // positions, so the green→yellow boundary is always at -20 dB regardless
      // of bar width. Doubled stops produce a sharp segment edge, not a blend.
      const greenEnd = dbToPosition(ZONE_GREEN_TOP_DB);
      const yellowEnd = dbToPosition(ZONE_YELLOW_TOP_DB);
      const gradient = ctx!.createLinearGradient(0, 0, cssW, 0);
      gradient.addColorStop(0, colors.green);
      gradient.addColorStop(greenEnd, colors.green);
      gradient.addColorStop(greenEnd, colors.yellow);
      gradient.addColorStop(yellowEnd, colors.yellow);
      gradient.addColorStop(yellowEnd, colors.red);
      gradient.addColorStop(1, colors.red);

      ctx!.globalAlpha = muted ? 0.3 : 1.0;

      // Ensure the peak buffer has one slot per channel.
      while (peaksDbRef.current.length < channelCount) {
        peaksDbRef.current.push(DB_FLOOR);
      }
      peaksDbRef.current.length = channelCount;

      for (let i = 0; i < channelCount; i++) {
        const y = Math.round(i * (channelH + gap));
        const ch = channels[i];
        const sampleMul = ch?.current ?? 0;
        const sampleDb = mulToDb(sampleMul);
        const peakDb = decayPeak(
          peaksDbRef.current[i] ?? DB_FLOOR,
          sampleDb,
          PEAK_DECAY_DB_PER_FRAME
        );
        peaksDbRef.current[i] = peakDb;

        // Track (unfilled background)
        ctx!.fillStyle = colors.track;
        ctx!.fillRect(0, y, cssW, channelH);

        if (sampleDb > DB_FLOOR) {
          // Filled portion of the gradient
          const w = Math.round(dbToPosition(sampleDb) * cssW);
          ctx!.save();
          ctx!.beginPath();
          ctx!.rect(0, y, w, channelH);
          ctx!.clip();
          ctx!.fillStyle = gradient;
          ctx!.fillRect(0, y, cssW, channelH);
          ctx!.restore();
        }

        if (peakDb > DB_FLOOR) {
          // Peak hold marker — single vertical pixel column.
          const px = Math.min(cssW - 1, Math.max(0, Math.round(dbToPosition(peakDb) * cssW)));
          ctx!.fillStyle = colors.red;
          ctx!.fillRect(px, y, 1, channelH);
        }
      }

      ctx!.globalAlpha = 1.0;
      requestAnimationFrame(draw);
    }

    draw();
    return () => {
      stopped = true;
    };
  }, [muted]);

  return (
    <canvas
      ref={canvasRef}
      className="vu-meter w-full block"
      style={{ height: `${height}px` }}
      aria-hidden
    />
  );
}
