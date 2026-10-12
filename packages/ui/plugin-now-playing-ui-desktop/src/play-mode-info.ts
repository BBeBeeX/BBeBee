import type { PlayMode } from '@BBeBee/protocol'

export const PLAY_MODE_INFO: Record<PlayMode, { label: string; next: string }> = {
  sequence: { label: 'Sequential', next: 'Switch to list loop' },
  'list-loop': { label: 'List loop', next: 'Switch to single loop' },
  'single-loop': { label: 'Single loop', next: 'Switch to shuffle' },
  shuffle: { label: 'Shuffle', next: 'Switch to sequential' },
}

export function getLocalizedPlayModeLabel(t: (k: string) => string, mode: PlayMode): string {
  switch (mode) {
    case 'sequence':
      return t('nowPlaying:nowPlaying.sequential')
    case 'list-loop':
      return t('nowPlaying:nowPlaying.listLoop')
    case 'single-loop':
      return t('nowPlaying:nowPlaying.singleLoop')
    case 'shuffle':
      return t('nowPlaying:nowPlaying.shuffle')
    default:
      return (PLAY_MODE_INFO as Record<string, { label: string } | undefined>)[mode]?.label ?? String(mode)
  }
}
