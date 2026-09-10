import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ThalamusService, type ThalamusNotification } from '../src/index.ts'
import { registerQuestionAlert } from '../src/question-alert.ts'

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach(() => {})
})

/** A service plus a recorder of every broadcast notification. */
async function makeService(): Promise<{
  ctx: Context
  service: ThalamusService
  seen: ThalamusNotification[]
}> {
  const root = await mkdtemp(join(tmpdir(), 'thalamus-q-'))
  roots.push(root)
  const ctx = new Context()
  const service = new ThalamusService(ctx, { memoryRoot: root })
  const seen: ThalamusNotification[] = []
  service.onPush(notification => { seen.push(notification) })
  return { ctx, service, seen }
}

/** One question request payload with a session identity. */
function request(sessionId: string, questions: Array<{ question: string }> = [{ question: '继续吗？' }]) {
  return {
    questions,
    agent: { session: { id: sessionId } },
  }
}

/**
 * Dispatch the scoped question waterfall through the real cordis path.
 * The event name is not declared in this package's Events map (thalamus does
 * not depend on dsh-user-questions types), so the call goes through a
 * structurally-typed face — the runtime behavior is the real dispatch.
 */
function dispatchQuestion(ctx: Context, payload: unknown, next: () => unknown): unknown {
  const waterfall = (ctx as unknown as {
    waterfall(name: string, ...args: unknown[]): unknown
  }).waterfall.bind(ctx)
  return waterfall('user-questions/request', payload, next)
}

describe('registerQuestionAlert', () => {
  it('broadcasts immediately — no debounce delay', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)

    const next = vi.fn(() => Promise.resolve({ answers: [] }))
    dispatchQuestion(ctx, request('session-aaaaaaaa'), next)

    // Synchronous broadcast: the alert is out before the waterfall returns.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.source).toBe('question')
    expect(seen[0]?.sessionId).toBe('session-aaaaaaaa')
    expect(seen[0]?.detail).toContain('继续吗')
  })

  it('never stores the alert — the notification center stays clean', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)

    dispatchQuestion(ctx, request('session-aaaaaaaa'), () => Promise.resolve({ answers: [] }))

    // The broadcast reached live clients…
    expect(seen).toHaveLength(1)
    // …but nothing was persisted or listed (no badge, no history entry).
    expect(await service.list()).toHaveLength(0)
  })

  it('still delegates to next() so the answer chain is never vetoed', async () => {
    const { ctx, service } = await makeService()
    registerQuestionAlert(ctx, service)
    const answer = { answers: [{ id: 'q1', selected: ['是'] }] }
    const next = vi.fn(() => Promise.resolve(answer))

    const result = await dispatchQuestion(ctx, request('session-bbbbbbbb'), next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(result).toEqual(answer)
  })

  it('broadcasts one alert per session when several sessions ask', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, request('session-dddddddd'), next)
    dispatchQuestion(ctx, request('session-eeeeeeee'), next)

    expect(seen).toHaveLength(2)
    expect(seen.map(item => item.sessionId).sort()).toEqual(['session-dddddddd', 'session-eeeeeeee'])
  })

  it('counts multiple questions of one request in a single alert', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)

    dispatchQuestion(
      ctx,
      request('session-ffffffff', [{ question: '第一个？' }, { question: '第二个？' }]),
      () => Promise.resolve({ answers: [] }),
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]?.detail).toContain('共 2 个问题')
  })

  it('tolerates a request with no session identity', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)

    dispatchQuestion(ctx, { questions: [{ question: '无会话？' }] }, () => Promise.resolve({ answers: [] }))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.sessionId).toBeUndefined()
  })

  it('ignores a request with no questions', async () => {
    const { ctx, service, seen } = await makeService()
    registerQuestionAlert(ctx, service)

    dispatchQuestion(ctx, { questions: [] }, () => Promise.resolve({ answers: [] }))

    expect(seen).toHaveLength(0)
  })
})
