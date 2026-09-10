import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ThalamusService } from '../src/index.ts'
import { QUESTION_DEBOUNCE_MS, registerQuestionAlert } from '../src/question-alert.ts'

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach(() => {})
  vi.useRealTimers()
})

async function makeService(): Promise<{ ctx: Context; service: ThalamusService }> {
  const root = await mkdtemp(join(tmpdir(), 'thalamus-q-'))
  roots.push(root)
  const ctx = new Context()
  const service = new ThalamusService(ctx, { memoryRoot: root })
  return { ctx, service }
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
  it('pushes one notification per session after the debounce window', async () => {
    vi.useFakeTimers()
    const { ctx, service } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)

    // Simulate the waterfall dispatch: listener receives (request, next).
    const next = vi.fn(() => Promise.resolve({ answers: [] }))
    dispatchQuestion(ctx, request('session-aaaaaaaa'), next)
    expect(await service.list()).toHaveLength(0) // not yet — debounce pending

    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.source).toBe('question')
    expect(list[0]?.sessionId).toBe('session-aaaaaaaa')
    expect(list[0]?.detail).toContain('继续吗')
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

  it('merges repeated questions of one session into a single notification', async () => {
    vi.useFakeTimers()
    const { ctx, service } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, request('session-cccccccc'), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS / 2)
    dispatchQuestion(ctx, request('session-cccccccc', [{ question: '第二个问题？' }]), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    const list = await service.list()
    expect(list).toHaveLength(1)
    // Two questions counted in the merged alert.
    expect(list[0]?.detail).toContain('共 2 个问题')
    dispose()
  })

  it('keeps different sessions on separate notifications', async () => {
    vi.useFakeTimers()
    const { ctx, service } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, request('session-dddddddd'), next)
    dispatchQuestion(ctx, request('session-eeeeeeee'), next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    expect(await service.list()).toHaveLength(2)
    dispose()
  })

  it('tolerates a request with no session identity', async () => {
    vi.useFakeTimers()
    const { ctx, service } = await makeService()
    const dispose = registerQuestionAlert(ctx, service)
    const next = () => Promise.resolve({ answers: [] })

    dispatchQuestion(ctx, { questions: [{ question: '无会话？' }] }, next)
    await vi.advanceTimersByTimeAsync(QUESTION_DEBOUNCE_MS + 10)

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.sessionId).toBeUndefined()
    dispose()
  })
})
