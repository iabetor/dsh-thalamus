import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ThalamusService, type ThalamusNotification } from '../src/index.ts'
import { QUESTION_DEBOUNCE_MS, registerQuestionAlert } from '../src/question-alert.ts'

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach(() => {})
  vi.useRealTimers()
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
  it('broadcasts one alert per session after the debounce window', async () => {
    vi.useFakeTimers()
    const { ctx, service, seen } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)

    const next = vi.fn(() => Promise.resolve({ answers: [] }))
    dispatchQuestion(ctx, request('session-aaaaaaaa'), next)
    expect(seen).toHaveLength(0) // not yet — debounce pending

    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.source).toBe('question')
    expect(seen[0]?.sessionId).toBe('session-aaaaaaaa')
    expect(seen[0]?.detail).toContain('继续吗')
    dispose()
  })

  it('never stores the alert — the notification center stays clean', async () => {
    vi.useFakeTimers()
    const { ctx, service, seen } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)

    dispatchQuestion(ctx, request('session-aaaaaaaa'), () => Promise.resolve({ answers: [] }))
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    // The broadcast reached live clients…
    expect(seen).toHaveLength(1)
    // …but nothing was persisted or listed (no badge, no history entry).
    expect(await service.list()).toHaveLength(0)
    dispose()
  })

  it('still delegates to next() so the answer chain is never vetoed', async () => {
    const { ctx, service } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const answer = { answers: [{ id: 'q1', selected: ['是'] }] }
    const next = vi.fn(() => Promise.resolve(answer))

    const result = await dispatchQuestion(ctx, request('session-bbbbbbbb'), next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(result).toEqual(answer)
    dispose()
  })

  it('merges repeated questions of one session into a single alert', async () => {
    vi.useFakeTimers()
    const { ctx, service, seen } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, request('session-cccccccc'), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS / 2)
    dispatchQuestion(ctx, request('session-cccccccc', [{ question: '第二个问题？' }]), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.detail).toContain('共 2 个问题')
    dispose()
  })

  it('keeps different sessions on separate alerts', async () => {
    vi.useFakeTimers()
    const { ctx, service, seen } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, request('session-dddddddd'), next)
    dispatchQuestion(ctx, request('session-eeeeeeee'), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    expect(seen).toHaveLength(2)
    dispose()
  })

  it('tolerates a request with no session identity', async () => {
    vi.useFakeTimers()
    const { ctx, service, seen } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, { questions: [{ question: '无会话？' }] }, next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.sessionId).toBeUndefined()
    dispose()
  })
})
