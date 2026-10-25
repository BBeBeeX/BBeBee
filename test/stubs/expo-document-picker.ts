/**
 * A stand-in for `expo-document-picker` under Vitest.
 *
 * `core-fs-mobile` imports the picker at module scope, which is right for
 * Metro and impossible in Node. The pick itself is genuinely of the device —
 * a system sheet no stub can show — so unlike the `expo-file-system` stub
 * (real `node:fs` behind the SDK surface) there is nothing real to run here.
 * What the tests need is the *result shape*: the discriminated union the SDK
 * answers, `canceled: true` with `assets: null`, or `canceled: false` with
 * positional assets — and a lever to script both.
 */

export interface DocumentPickerAsset {
  uri: string
  name: string
  size?: number
  mimeType?: string
}

export interface DocumentPickerOptions {
  multiple?: boolean
  copyToCacheDirectory?: boolean
  type?: string | string[]
}

export type DocumentPickerResult =
  | { canceled: false; assets: DocumentPickerAsset[] }
  | { canceled: true; assets: null }

let scripted: DocumentPickerResult = { canceled: true, assets: null }

/** Script the next answer, and clear it with no argument. */
export function __setResultForTests(result?: DocumentPickerResult): void {
  scripted = result ?? { canceled: true, assets: null }
}

/** What `getDocumentAsync` was last called with. */
export const __lastOptions: { value: DocumentPickerOptions | undefined } = { value: undefined }

export function __resetForTests(): void {
  scripted = { canceled: true, assets: null }
  __lastOptions.value = undefined
}

export async function getDocumentAsync(
  options: DocumentPickerOptions = {},
): Promise<DocumentPickerResult> {
  __lastOptions.value = options
  return scripted
}
