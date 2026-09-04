# dsh-thalamus 实现方案

> 丘脑（Thalamus）—— 大脑的感觉信号中继站：所有感官输入先汇聚于此，再分发到皮层。
> 本项目 = DeepSeek Harness 的信息中心：**通用通知**（各插件事件/结果投递）+ **文件预览**（产物/文档在 dsh 内查看），由它统一呈现给用户。

## 1. 定位与边界

### 1.1 是什么
一个**通用通知服务 + 文件预览器 + 浏览器信息中心 UI** 的独立插件：
- 任何插件可调用 `ctx.notifications.push(...)` 发通知
- 浏览器右下角的通知中心（抽屉）统一展示、回顾、处理通知
- 通知可携带/关联内容，点开在**文件预览器**里查看（不再跳到本地 ima）
- 通知有持久历史（刷新页面不丢）、未读状态

### 1.2 能力归类（为什么通知+预览放一起）
| 能力 | 本质 | 归类 | 归属 |
|---|---|---|---|
| 通知中心 | 被动接收事件流（全局） | 信息呈现层 | **dsh-thalamus** |
| 文件预览 | 被动查看产物/文档（全局） | 信息呈现层 | **dsh-thalamus** |
| git 面板 | 主动操作仓库（有状态/有风险） | 专属操作层 | 未来独立插件 |
| outline | 当前文档导航 | 编辑器伴侣 | 未来进 dsh-ide |
| 文件树/编辑/终端 | 编辑工作台 | 已有 | dsh-ide |

**判断标准**：被动消费信息的放一起（dsh-thalamus）；主动操作/有状态/绑定当前上下文的单独放或进已有工作台。

### 1.3 不是什么
- **不是 harness 的 jobs**（jobs 是会话绑定的后台任务，见 6.1）
- **不是 hippo 的审计日志**（审计是记忆插件的内部记录；通知是跨插件的通用事件）
- **不是 dsh-ide 的 workbench**（那是文件/编辑/终端，会话绑定）
- **不是 git/outline**（专属操作层，见 1.2）

### 1.4 脑区命名宇宙
| 项目 | 脑区 | 隐喻 |
|---|---|---|
| dsh-hippocampus | 海马体 | 记忆 |
| **dsh-thalamus** | **丘脑** | **信号中继（通知 + 内容呈现）** |
| （未来）git/outline | 待定 | 待定 |

## 2. 架构总览

```
┌───────────────────────── Host（Node）──────────────────────────┐
│                                                                │
│  dsh-hippocampus ──push()──┐                                   │
│  （未来）git ──push()─────┤                                   │
│  （未来）outline ──push()─┼─► ctx.notifications (Service)      │
│                           │      │ 持久化（JSONL，类 hippo）    │
│                           │      ▼                            │
│                           │   /thalamus/api/*  JSON API        │
│                           │      ├─ notifications（list/read） │
│                           │      └─ preview（按内容读文本）     │
│                           │   /thalamus/events  SSE 广播       │
└───────────────────────────┴────────────────────────────────────┘
                                    │ HTTP + SSE
┌──────────────────────── Browser ──▼────────────────────────────┐
│  ThalamusDrawer（shell.overlay 浮层抽屉，右下）                  │
│   ├─ Tab: 通知（列表/未读/清空）                                 │
│   ├─ Tab: 文件预览（产物/文档，markdown/代码高亮/滚动）           │
│   └─ 通知点开 detail → 可切换到预览 tab 显示全文                  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 宿主侧设计

### 3.1 通知服务（cordis Service）

对外 API（供其他插件 inject `notifications` 后调用）：

```ts
interface ThalamusNotification {
  id: string                // uuid
  source: string            // 来源插件：'hippocampus' | 'git' | ...
  kind: 'info' | 'success' | 'error'   // 呈现基调
  title: string             // 一行标题
  detail?: string           // 可选详情（短摘要，列表内展示）
  preview?: {               // 可选：关联的"产物"，点开在预览 tab 看全文
    name: string            // 展示名（如 "implementation-plan.md"）
    text: string            // 全文内容
    language?: string       // 提示高亮语言（md/ts/json/…）
  }
  time: number              // epoch ms
  read: boolean
}

class ThalamusService extends Service {
  static provide = 'notifications'   // 服务名
  push(input: Omit<ThalamusNotification, 'id' | 'time' | 'read'>): ThalamusNotification
  list(limit?: number): ThalamusNotification[]   // 时间倒序
  markRead(id: string): void
  clear(): void
}
```

- `declare module '@deepseek-ai/cordis'` 把 `notifications` 挂到 Context（类型合并，与其他 Service 一致）
- 消费者插件只需在 `export const inject = ['notifications', ...]` 声明即可使用
- **preview 文本随通知持久化**：内容通常 ≤ 几十 KB（方案文档、审计报告）；超大内容未来改引用路径

### 3.2 存储
- 位置：`~/.dsh/thalamus/notifications.jsonl`（用户级根，跨项目）
- 每条通知一行 JSON，原子追加
- 容量：上限 200 条，超出截断留最新（参考 hippo audit 的 trim 模式）
- preview.text 计入单条大小上限（如 64KB/条，超长截断并注明）
- 可选：按 `source` 分文件？—— 先不分，单文件足够（200 条量级）

### 3.3 传输层（复用 hippo 已验证模式）

**JSON API**（`/thalamus/api/<method>`，POST + 浏览器信任围栏）：
- `list` —— 拉历史（打开抽屉时）
- `mark-read` —— 单条标记已读
- `clear` —— 清空

**SSE 通道**（`/thalamus/events`，GET）：
- 打开即保持连接（`Set<ServerResponse>` 广播，heartbeat 帧）
- 新通知推 `{ type: 'notification', notification }` 给所有浏览器标签
- 参考：hippo `/memory/api/events`（439 行附近）、harness HMR `/plugins/events`

### 3.4 信任围栏
- 复用 hippo 的 `isTrustedRequest`（loopback/trustedHosts 校验）
- 只允许本机浏览器访问

## 4. 浏览器侧设计

### 4.1 挂载点
- 注册进 `shell.overlay`（list 槽，与 hippo toast 并列）——hippo 已验证该槽可用
- 右下角抽屉（`position: fixed; right/bottom`），不占布局（hippo toast 同款定位）

### 4.2 UI 组件结构（两个 tab 的抽屉）
```
ThalamusHost（shell.overlay 条目）
└─ 触发胶囊（右下角常驻，有未读显示数字高亮）
└─ 抽屉（宽 ~420px，两 tab）
   ├─ Tab「通知」：
   │  头部：全部已读 + 清空
   │  列表（时间倒序，可滚动）
   │   每项：来源徽标 + title + 时间 + 未读圆点
   │   有 preview 的通知 → 「查看全文」→ 切到预览 tab
   ├─ Tab「预览」：
   │  头部：文件名 + 返回
   │  正文：markdown 渲染 / 代码高亮 / 纯文本，可滚动
   │  （不跳到本地 ima，dsh 内直接看）
```

### 4.3 交互
- 新通知到达（SSE）→ 若抽屉关着：胶囊高亮 + 短暂 toast 提示（可选）
- 点胶囊 → 抽屉开，拉 `list`，未读自动标记已读（或点开才标记？——先打开即标记）
- 点某条 → 展开 detail（内联展开）；有 preview → 可切预览 tab 看全文
- 清空 → `clear` API

### 4.4 文件预览器（第一版范围）
- 只预览**通知携带的 preview.text**（虚拟内容），不接文件系统
- 渲染：markdown（复用 harness 的 markdown 渲染器？先简单 text + <pre>）→ 逐步加高亮
- 未来扩展：接文件系统路径（git diff、outline 文档）→ 那时再评估独立成 preview 服务

## 5. 消费者接入：hippocampus 迁移

### 5.1 现状
hippo 自己实现了 toast（`toast.ts` + `ToastHost.ts`，8 秒自动消失）+ `/memory/api/events` SSE，广播 `maintain/done`。

### 5.2 迁移
1. hippo 的 `registerMemoryApi` 里，maintain 完成后改调 `ctx.notifications.push(...)`
2. hippo 删除自己的 `toast.ts`/`ToastHost.ts`/events SSE，改注入 `notifications`
3. 过渡期：两套共存（先加推送，确认通知中心稳定后删 toast）

### 5.3 通知内容映射
```ts
// maintain 完成
notifications.push({
  source: 'hippocampus',
  kind: removed > 0 ? 'success' : 'info',
  title: '记忆整理完成',
  detail: removed > 0 ? `清理 ${removed} 条记录` : '无需清理',
})
```

## 6. 关键决策记录（ADR）

### 6.1 为什么不用 harness 的 ctx.jobs
- jobs 是**会话绑定**的（owner = agent，session 关 = job 取消）
- web 部署下 controller 只在 agent scope（tool-jobs 被 web-app disable，preset 内加载）
- `servesOwner(undefined)` 只看 global layer → **unowned job 在 web 无法 start**（实测 hippo 接入失败，已回退）
- 结论：**全局维护/通知任务 ≠ harness job**，通知中心走自己的 SSE + JSONL

### 6.2 为什么新项目而不是塞进 hippo / dsh-ide
- 通知是**通用能力**，未来 git/outline/任何插件都要用
- hippo 保持纯粹（记忆）；dsh-ide 是会话绑定 workbench，不适合全局通知
- 独立插件 + cordis Service = 插件间共享的标准方式

### 6.3 shell.overlay vs harness details 栏
- details 栏是 `single` + `scope: session`，被 ui-chat 独占（工具调用详情）
- 第三方无法使用 → 通知中心用 shell.overlay 浮层抽屉（hippo toast 已验证）

## 7. 里程碑

1. **M1 骨架**：项目结构 + 宿主 Service（push/list/markRead/clear）+ JSONL 存储 + 测试
2. **M2 传输**：`/thalamus/api/*` + `/thalamus/events` SSE + 信任围栏
3. **M3 UI-通知**：shell.overlay 抽屉-通知 tab（列表/展开/已读/清空/未读胶囊）
4. **M4 UI-预览**：抽屉-预览 tab（preview.text 展示，markdown/高亮渐进）+ 通知↔预览联动
5. **M5 接入**：hippo 迁移 push（携带 preview），删 toast；端到端验证
6. **M6 发布**：GitHub Release + README

## 8. 风险与开放问题

- **多标签页**：SSE 广播已支持多客户端；未读状态跨标签同步靠每次 list 拉取（足够）
- **preview 体积**：随通知持久化（上限 64KB/条），超大内容未来改"引用宿主文件路径"
- **markdown 渲染器**：优先复用 harness 的渲染器；不可用则 <pre> 兜底
- **通知去重**：同一来源同内容短时间内多次 → 合并？先不做（hippo 维护有并发守卫）
- **preview 未来接文件系统**：git diff / outline 文档可能直接引用路径 —— 到那时评估是否把 preview 抽成独立服务（可能演进为 dsh-files 类项目）
