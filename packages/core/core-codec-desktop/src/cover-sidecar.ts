/**
 * Cover Sidecar — dedicated Node.js process for artwork extraction.
 *
 * Runs as a standalone JSON-RPC 2.0 server over stdio (NDJSON), exposing only:
 *   - `codec/readArtwork(uri)` → base64 string | null
 *   - `codec/readArtworkBatch(uris)` → (base64 string | null)[]
 *
 * It has no DB, no Cordis app, no other services — pure extraction via the
 * artwork worker pool. Running in a separate process (and separate bridge)
 * means cover batches can never starve the main sidecar's bridge calls
 * (player readMetadata, audio.load, DB reads, etc.).
 *
 * Protocol (same framing as the main sidecar):
 *   → {"jsonrpc":"2.0","id":1,"method":"BBeBee:call","params":["codec","readArtworkBatch",[[uris]],token]}
 *   ← {"jsonrpc":"2.0","id":1,"result":[...]}
 *   ← {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"..."}}
 *
 * All diagnostics go to stderr; stdout is strictly NDJSON responses.
 */

import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import readline from 'node:readline'
import process from 'node:process'

// ---------------------------------------------------------------------------
// URI → file path (mirrors core-codec-desktop/src/index.ts uriToFilePath)
// ---------------------------------------------------------------------------

function uriToFilePath(uri: string): string | null {
  try {
    // bbebee-file:// URIs from the scanner
    if (uri.startsWith('bbebee-file:')) {
      uri = uri.replace(/^bbebee-file:/, 'file:')
    }
    const url = new URL(uri)
    if (url.protocol !== 'file:') return null
    let p = fileURLToPath(url)
    // Windows: fileURLToPath gives \C:\... or /C:/..., normalize
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Worker pool (mirrors CodecNode.readArtworkBatchViaWorker)
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const workerPath = join(here, 'artwork-worker.mjs')
const POOL_SIZE = Math.min(Math.max(cpus().length, 2), 4)

async function readArtworkBatchViaWorker(filePaths: string[]): Promise<Array<string | null>> {
  if (!existsSync(workerPath)) {
    throw new Error('artwork worker not found')
  }

  const results: Array<string | null> = new Array(filePaths.length)
  // Distribute round-robin, but track the global index for each file.
  // Worker w gets files at global indices w, w+POOL_SIZE, w+2*POOL_SIZE, ...
  const chunks: Array<Array<{ filePath: string; globalIndex: number }>> = Array.from(
    { length: POOL_SIZE },
    () => [],
  )
  filePaths.forEach((fp, i) => {
    chunks[i % POOL_SIZE]!.push({ filePath: fp, globalIndex: i })
  })

  const workerPromises = chunks.map((chunkFiles, w) => {
    if (chunkFiles.length === 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const child: ChildProcess = fork(workerPath)
      let pending = chunkFiles.length
      let nextId = 0
      const idToGlobal = new Map<number, number>()

      const cleanup = () => {
        try {
          child.send({ cmd: 'shutdown' })
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
        }, 1000).unref()
      }

      child.on('message', (msg: unknown) => {
        const m = msg as { id: number; artwork: string | null }
        const globalIdx = idToGlobal.get(m.id)
        if (globalIdx !== undefined) {
          results[globalIdx] = m.artwork
          idToGlobal.delete(m.id)
          if (--pending === 0) {
            cleanup()
            resolve()
          }
        }
      })

      child.on('error', (err: Error) => {
        cleanup()
        reject(err)
      })

      child.on('exit', (code: number | null) => {
        if (pending > 0) {
          reject(new Error(`artwork worker ${w} exited early (code ${code}), ${pending} pending`))
        }
      })

      for (let l = 0; l < chunkFiles.length; l++) {
        const id = nextId++
        idToGlobal.set(id, chunkFiles[l]!.globalIndex)
        child.send({ id, filePath: chunkFiles[l]!.filePath })
      }

      setTimeout(() => {
        if (pending > 0) {
          cleanup()
          reject(new Error(`artwork worker ${w} timeout`))
        }
      }, 60000).unref()
    })
  })

  await Promise.all(workerPromises)
  return results
}

async function handleReadArtworkBatch(uris: string[]): Promise<Array<string | null>> {
  const paths = uris.map((u) => uriToFilePath(u))
  if (paths.some((p) => p === null)) {
    throw new Error('non-local URI in batch')
  }
  return readArtworkBatchViaWorker(paths as string[])
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio (NDJSON)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string
  id: number | string
  method: string
  params: unknown[]
}

async function handleRequest(req: JsonRpcRequest): Promise<unknown> {
  if (req.method !== 'BBeBee:call') {
    throw new Error(`unsupported method: ${req.method}`)
  }
  const [service, method, args] = req.params as [string, string, unknown[][]]
  if (service !== 'codec') {
    throw new Error(`unsupported service: ${service}`)
  }
  if (method === 'readArtworkBatch') {
    const uris = (args[0] ?? []) as string[]
    return handleReadArtworkBatch(uris)
  }
  if (method === 'readArtwork') {
    const uri = args[0] as unknown as string
    const results = await handleReadArtworkBatch([uri])
    return results[0] ?? null
  }
  throw new Error(`unsupported codec method: ${method}`)
}

function sendResponse(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(id: number | string, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } }) + '\n',
  )
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req: JsonRpcRequest
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest
  } catch {
    return
  }
  // Notifications (no id) are ignored
  if (req.id === undefined || req.id === null) return
  handleRequest(req).then(
    (result) => sendResponse(req.id as number | string, result),
    (err: unknown) => sendError(req.id as number | string, err instanceof Error ? err.message : String(err)),
  )
})

// Graceful shutdown on stdin close
rl.on('close', () => process.exit(0))

console.error('[cover-sidecar] ready')
