/**
 * Standalone artwork extraction worker process.
 * Forked by core-codec-desktop for batch cover extraction, so CPU-intensive
 * music-metadata parsing does not block the sidecar's main event loop.
 *
 * Protocol (via fork IPC):
 *   parent -> child: { id: number, filePath: string }
 *   child -> parent: { id: number, artwork: string | null }  // base64 or null
 *   parent -> child: { cmd: 'shutdown' }
 */

import { parseFile } from 'music-metadata'

interface WorkItem {
  id: number
  filePath: string
}

interface ResultItem {
  id: number
  artwork: string | null
}

function selectCover(pictures: Array<{ data: Uint8Array }> | undefined): Uint8Array | null {
  if (!pictures || pictures.length === 0) return null
  // Prefer front cover, else first
  const front = (pictures as Array<{ type?: string; data: Uint8Array }>).find(
    (p) => p.type === 'Cover (front)',
  )
  return (front ?? pictures[0]!).data ?? null
}

async function processItem(item: WorkItem): Promise<ResultItem> {
  try {
    // Per-file timeout: a corrupted file can hang the parser; don't let it
    // block the whole batch.
    const timeoutMs = 10000
    const metadata = await Promise.race([
      parseFile(item.filePath, { duration: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parse timeout')), timeoutMs),
      ),
    ])
    const data = selectCover(metadata.common.picture as Array<{ data: Uint8Array }> | undefined)
    if (!data) return { id: item.id, artwork: null }
    return { id: item.id, artwork: Buffer.from(data).toString('base64') }
  } catch {
    return { id: item.id, artwork: null }
  }
}

if (process.send) {
  process.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const m = msg as { cmd?: string } & Partial<WorkItem>
    if (m.cmd === 'shutdown') {
      process.exit(0)
      return
    }
    if (typeof m.id === 'number' && typeof m.filePath === 'string') {
      void processItem({ id: m.id, filePath: m.filePath }).then((result) => {
        process.send!(result)
      })
    }
  })
} else {
  console.error('[artwork-worker] No IPC channel; exiting')
  process.exit(1)
}
