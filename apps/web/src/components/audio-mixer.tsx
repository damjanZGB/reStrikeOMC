import { useEffect, useState } from 'react';
import type { InputState } from '@restrike/shared';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';
import { VuMeter } from '@/components/vu-meter';

export interface AudioMixerProps {
  inputs: InputState[];
  onMute: (inputName: string, muted: boolean) => void;
  onVolume: (inputName: string, volumeMul: number) => void;
}

export function AudioMixer({ inputs, onMute, onVolume }: AudioMixerProps): JSX.Element | null {
  if (inputs.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-2">
      <p className="text-xs uppercase text-muted-foreground">Audio</p>
      <div className="grid gap-3">
        {inputs.map((input) => (
          <AudioRow
            key={input.name}
            input={input}
            onMute={(muted) => onMute(input.name, muted)}
            onVolume={(mul) => onVolume(input.name, mul)}
          />
        ))}
      </div>
    </div>
  );
}

function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= -60) return '−∞';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

function AudioRow({
  input,
  onMute,
  onVolume,
}: {
  input: InputState;
  onMute: (muted: boolean) => void;
  onVolume: (mul: number) => void;
}): JSX.Element {
  // Local optimistic value while user drags; synced from server state on prop change
  const [localMul, setLocalMul] = useState(input.volumeMul);
  useEffect(() => {
    setLocalMul(input.volumeMul);
  }, [input.volumeMul]);

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
      <Button
        size="icon"
        variant={input.muted ? 'destructive' : 'ghost'}
        className="h-7 w-7"
        onClick={() => onMute(!input.muted)}
        aria-label={input.muted ? 'Unmute' : 'Mute'}
        title={input.muted ? 'Unmute' : 'Mute'}
      >
        {input.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </Button>
      <div className="grid gap-1">
        <div className="flex justify-between gap-2">
          <span className="font-medium truncate" title={input.name}>
            {input.name}
          </span>
          <span className="text-muted-foreground tabular-nums whitespace-nowrap">
            {Math.round(localMul * 100)}% · {formatDb(input.volumeDb)}
          </span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[localMul]}
          onValueChange={(v) => setLocalMul(v[0] ?? 0)}
          onValueCommit={(v) => onVolume(v[0] ?? 0)}
          disabled={input.muted}
        />
        <VuMeter levels={input.levels} muted={input.muted} />
      </div>
    </div>
  );
}
