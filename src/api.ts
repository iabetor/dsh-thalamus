/**
 * dsh-thalamus host JSON API + SSE channel.
 *
 * JSON API: /thalamus/api/<method> (list, mark-read, clear)
 * SSE:      /thalamus/events  (one open response; each push broadcasts)
 *
 * Trust fence mirrors the /api gateway and dsh-hippocampus: loopback hosts
 * and the webRuntime trusted list are accepted, everything else is 403.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ThalamusNotification } from './index.ts'

/** Body size bound of one JSON request. */
const MAX_BODY_BYTES = 1 << 20

/** One API failure with its wire code and HTTP status. */
export class ThalamusApiError extends Error {
  constructor(
    readonly code: 'bad-request' | 'not-found' | 'forbidden' | 'internal',
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new ThalamusApiError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ThalamusApiError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response. */
export function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

/** Write a success envelope. */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, value)
}

/** Write the shared error envelope. */
export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof ThalamusApiError) {
    writeJson(res, error.status, { ok: false, code: error.code, message: error.message })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, code: 'internal', message })
}

/** Browser-trust fence: loopback host or a configured trusted authority. */
export function isTrustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const authority = req.headers.host
  if (typeof authority !== 'string' || authority.length === 0) return false
  let url: URL
  try {
    url = new URL(`http://${authority}`)
  } catch {
    return false
  }
  const hostname = url.hostname
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  if (parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return true
  }
  return trustedHosts.some(entry => {
    try {
      const entryUrl = new URL(`http://${entry}`)
      return entryUrl.hostname === hostname
    } catch {
      return false
    }
  })
}

/** Structural face of the webRuntime service. */
interface WebRuntimeService {
  trustedHosts: string[]
}

/** Structural face of the webServer service. */
interface WebServerService {
  register(route: WebRoute): () => void
}

/** The host context: webServer/webRuntime for the API, notifications for reads. */
export type ThalamusHostContext = Context & {
  webServer: WebServerService
  webRuntime: WebRuntimeService
  notifications: {
    list(limit?: number): Promise<ThalamusNotification[]>
    markRead(id: string): Promise<void>
    clear(): Promise<void>
  }
}

/** SSE client registry: add/remove connected responses. */
export interface SseClients {
  add(client: ServerResponse): () => void
}

/** Register the /thalamus API routes + SSE channel on the webserver. */
export function registerThalamusApi(
  ctx: ThalamusHostContext,
  sse: SseClients,
): void {
  const trustedHosts = () => ctx.webRuntime.trustedHosts

  const apiRoute: WebRoute = {
    kind: 'prefix',
    path: '/thalamus/api',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = url.pathname.slice('/thalamus/api'.length + 1)
      try {
        if (!isTrustedRequest(req, trustedHosts())) {
          throw new ThalamusApiError('forbidden', 'request rejected by the thalamus trust fence', 403)
        }
        const body = (await readJsonBody(req)) as Record<string, unknown>
        switch (method) {
          case 'list': {
            const limit = typeof body.limit === 'number' ? body.limit : 100
            const notifications = await ctx.notifications.list(limit)
            writeOk(res, { notifications })
            return
          }
          case 'mark-read': {
            const id = typeof body.id === 'string' ? body.id : ''
            if (id === '') throw new ThalamusApiError('bad-request', 'id is required')
            await ctx.notifications.markRead(id)
            writeOk(res, { ok: true })
            return
          }
          case 'clear': {
            await ctx.notifications.clear()
            writeOk(res, { ok: true })
            return
          }
          default:
            throw new ThalamusApiError('not-found', `unknown method "${method}"`, 404)
        }
      } catch (error) {
        writeError(res, error)
      }
    },
  }

  const eventsRoute: WebRoute = {
    kind: 'exact',
    path: '/thalamus/events',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req, trustedHosts())) {
        writeError(res, new ThalamusApiError('forbidden', 'request rejected by the thalamus trust fence', 403))
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      const unsubscribe = sse.add(res)
      res.on('close', unsubscribe)
      res.on('error', unsubscribe)
    },
  }

  ctx.webServer.register(apiRoute)
  ctx.webServer.register(eventsRoute)
}
