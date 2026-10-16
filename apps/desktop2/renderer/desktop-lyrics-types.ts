export interface DesktopLyricsPayload {
  currentLine: string
  nextLine?: string
  fontSize: number
  opacity: number
  locked: boolean
  playing: boolean
  title?: string
  artist?: string
  align?: 'left' | 'center' | 'right'
  fontFamily?: string
  textColor?: string
  lineMode?: 'single' | 'double'
}

export type DesktopLyricsAction =
  | { type: 'toggle-lock' }
  | { type: 'toggle-play' }
  | { type: 'next-track' }
  | { type: 'prev-track' }
  | { type: 'set-font-size'; size: number }
  | { type: 'close' }
