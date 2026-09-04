import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ThalamusService } from '../src/index.ts'
import { readNotifications } from '../src/store.ts'

const roots: string[] = []

afterEach(async () => {
  roots.splice(0).forEach(() => {})
})

async function makeService(): Promise<{ ctx: Context; service: ThalamusService }> {
  const root = await mkdtemp(join(tmpdir(), 'thalamus-test-'))
  roots.push(root)
  const ctx = new Context()
  const service = new ThalamusService(ctx, { memoryRoot: root })
  return { ctx, service }
}

describe('ThalamusService', () => {
  it('pushes a notification with identity/time/read defaults', async () => {
    const { service } = await makeService()
    const record = await service.push({
      source: 'hippocampus',
      kind: 'success',
      title: '记忆整理完成',
      detail: '清理 3 条记录',
    })
    expect(record.id).toBeTypeOf('string')
    expect(record.time).toBeTypeOf('number')
    expect(record.read).toBe(false)
    expect(record.source).toBe('hippocampus')
  })

  it('lists newest first', async () => {
    const { service } = await makeService()
    await service.push({ source: 'a', kind: 'info', title: 'first' })
    await service.push({ source: 'b', kind: 'info', title: 'second' })
    const list = await service.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.title).toBe('second')
  })

  it('marks one notification read', async () => {
    const { service } = await makeService()
    const record = await service.push({ source: 'a', kind: 'info', title: 'x' })
    await service.markRead(record.id)
    const list = await service.list()
    expect(list[0]?.read).toBe(true)
  })

  it('clears all notifications', async () => {
    const { service } = await makeService()
    await service.push({ source: 'a', kind: 'info', title: 'x' })
    await service.clear()
    expect(await service.list()).toHaveLength(0)
  })

  it('carries a preview artifact', async () => {
    const { service } = await makeService()
    await service.push({
      source: 'hippocampus',
      kind: 'info',
      title: '方案就绪',
      preview: { name: 'implementation-plan.md', text: '# plan', language: 'md' },
    })
    const listed = await service.list()
    expect(listed[0]?.preview?.text).toBe('# plan')
  })

  it('persists across service instances (same root)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thalamus-persist-'))
    roots.push(root)
    const first = new ThalamusService(new Context(), { memoryRoot: root })
    await first.push({ source: 'a', kind: 'info', title: 'persisted' })
    const second = new ThalamusService(new Context(), { memoryRoot: root })
    const list = await second.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('persisted')
    // File content check.
    const onDisk = await readNotifications(root)
    expect(onDisk).toHaveLength(1)
  })

  it('caps stored notifications at the file limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thalamus-cap-'))
    roots.push(root)
    const service = new ThalamusService(new Context(), { memoryRoot: root })
    for (let index = 0; index < 250; index += 1) {
      await service.push({ source: 'a', kind: 'info', title: `n${index}` })
    }
    const list = await service.list()
    expect(list.length).toBeLessThanOrEqual(200)
    // The newest survive.
    expect(list[0]?.title).toBe('n249')
  })
})
