/**
 * dsh-thalamus — 提问提醒（question alert）。
 *
 * 监听 agent 作用域的 `user-questions/request` 瀑布事件：agent 通过
 * ask_user_question 提问时推送一条通知（source: 'question'），浏览器端据此
 * 在页面不可见/失焦时发系统通知。
 *
 * **关键约束**：cordis 瀑布事件里不调用 `next()` 会否决整条链（含内置行为），
 * 所有提问都将无人应答。因此监听器必须 `return next()`；副作用先行但不
 * await，避免拖慢问答。参考 vendor/cordis/src/events.ts 的 waterfall 语义。
 *
 * debounce：同一会话短时间内的多次提问合并为一条（计数累加），避免模型连问
 * 时刷屏系统通知。
 *
 * @module dsh-thalamus/question-alert
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ThalamusService } from './index.ts'

/** 一个提问项（与 @deepseek-ai/dsh-user-questions 的 AskUserQuestionItem 结构面一致）。 */
export interface QuestionItemLike {
  readonly id?: string
  readonly question?: string
  readonly header?: string
  readonly detail?: string
  readonly options?: readonly { readonly label?: string }[]
}

/** `user-questions/request` 的事件载荷结构面（只声明我们读取的字段）。 */
export interface QuestionRequestLike {
  readonly questions?: readonly QuestionItemLike[]
  readonly agent?: {
    readonly session?: { readonly id?: string }
    readonly id?: string
  }
}

/** 单条通知里问题摘要的截断长度。 */
const SUMMARY_LIMIT = 120

/** 通知里最多列出多少个问题（超出只报数量）。 */
const PREVIEW_QUESTION_LIMIT = 8

/** 会话标识：优先 session.id，退回 agent.id，都没有则 undefined。 */
function sessionIdOf(request: QuestionRequestLike): string | undefined {
  const sessionId = request.agent?.session?.id
  if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
  const agentId = request.agent?.id
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : undefined
}

/** 会话展示标签：取 id 尾部短码，便于多会话时区分。 */
function sessionLabel(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) return undefined
  const tail = sessionId.slice(-8)
  return tail.length === 0 ? undefined : tail
}

/** 第一个问题的摘要（截断），用于通知 detail。 */
function summarize(questions: readonly QuestionItemLike[], count: number): string {
  const first = questions[0]
  const text = typeof first?.question === 'string' && first.question.trim() !== ''
    ? first.question.trim()
    : (typeof first?.header === 'string' ? first.header : '')
  const head = text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text
  const more = count > 1 ? `（共 ${count} 个问题）` : ''
  return `${head}${more}`.trim() === '' ? `共 ${count} 个问题待回答` : `${head}${more}`
}

/** 全部问题的 markdown 预览体。 */
function formatQuestions(questions: readonly QuestionItemLike[]): string {
  const lines: string[] = ['## 待回答的问题', '']
  questions.slice(0, PREVIEW_QUESTION_LIMIT).forEach((item, index) => {
    const header = typeof item.header === 'string' && item.header !== '' ? `**${item.header}** ` : ''
    const question = typeof item.question === 'string' ? item.question : '(无题面)'
    lines.push(`${String(index + 1)}. ${header}${question}`)
    if (typeof item.detail === 'string' && item.detail.trim() !== '') {
      lines.push('', `   ${item.detail.trim()}`, '')
    }
    const options = item.options ?? []
    for (const option of options) {
      if (typeof option.label === 'string' && option.label !== '') lines.push(`   - ${option.label}`)
    }
    lines.push('')
  })
  if (questions.length > PREVIEW_QUESTION_LIMIT) {
    lines.push(`…另有 ${questions.length - PREVIEW_QUESTION_LIMIT} 个问题`)
  }
  return lines.join('\n')
}

/**
 * 注册提问提醒：监听 `user-questions/request` 并即时广播通知。
 *
 * 每次提问立即广播一条（无 debounce）：同一会话不可能并发提问——工具
 * `ask_user_question` 的 execute 会 await 用户回答，agent 回合卡在那里，
 * 用户答完才会继续。一次调用的多个问题本来就在同一条通知里（见
 * {@link formatQuestions}）。多会话可同时提问，各自一条通知。
 *
 * 监听器**始终** `return next()`——这是不破坏问答链路的硬约束。
 * @param ctx - 插件上下文（用于 ctx.on 注册，随 fiber 自动清理）。
 * @param service - 通知服务（广播失败不影响问答）。
 */
export function registerQuestionAlert(
  ctx: Context,
  service: Pick<ThalamusService, 'broadcastOnly'>,
): void {
  // 瀑布事件监听器：副作用先行、始终委托 next()。
  const onRequest = (request: QuestionRequestLike, next: () => unknown): unknown => {
    try {
      const questions = Array.isArray(request?.questions) ? request.questions : []
      if (questions.length > 0) {
        const sessionId = sessionIdOf(request)
        const label = sessionLabel(sessionId)
        // broadcastOnly（非 push）：提问提醒只做实时提醒，不进通知中心列表、
        // 不占未读角标、不落盘——用户回到页面看会话树的 pending 指示即可。
        service.broadcastOnly({
          source: 'question',
          kind: 'info',
          title: label === undefined ? '有提问待回答' : `有提问待回答 · ${label}`,
          detail: summarize(questions, questions.length),
          preview: {
            name: 'question.md',
            text: formatQuestions(questions),
            language: 'md',
          },
          // 会话标识随通知下发，供浏览器端点击跳转。
          ...(sessionId === undefined ? {} : { sessionId }),
        })
      }
    } catch {
      // 提醒逻辑的任何故障都不能影响问答。
    }
    // 必须委托：否则整条问答链被否决。
    return next()
  }

  ctx.on('user-questions/request' as never, onRequest as never)
}
