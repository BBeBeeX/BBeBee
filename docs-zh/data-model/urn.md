# 实体 URN 标识符与身份关联

> **历史章节映射：** 原 `docs-zh/07-data-model.md §1`。

> **本文回答的问题。** 实体如何被标识、URN 语法、为什么同一实体跨音源对应多行，以及导出的 URN 辅助函数。

本文所讲的一切都存放在 [`ctx.db`](../services/contracts.md#5-ctxdb--sql) 背后的同一个 SQLite 数据库中，两个平台上完全一致。

---

## 1. 身份标识：URN

```
BBeBee:<sourceId>:<kind>:<id>
       │          │       └── source-local id, opaque, never parsed
       │          └────────── track | album | artist | playlist | genre
       └───────────────────── source id, derived from sourceUrl (sources/authoring.md §1.2)
```

示例：

```
BBeBee:local:track:9f2c8a1e
BBeBee:music-example-org-35be9fe2:album:41af02
BBeBee:jellyfin-nas-local-1bb03370:playlist:7c11
```

### 为什么是音源，而不是后端类型

两台 Navidrome 服务器就是两个命名空间，而在字符串模型下，它们不过是两份被导入的文档、两个 `sourceUrl`（[authoring.md §1.2](../sources/authoring.md#12-身份源-id)）。如果 URN 以任何更粗的粒度为键 —— 某个协议、某个"插件" —— 用户添加第二台服务器的瞬间 id 就会冲突，而移除一台会破坏另一台的行。

这一段从插件时代走到字符串时代原封未动，而这正是当初把它定义为"哪个命名空间拥有这个 id"而非"哪个包产出了它"的意义所在。

### 为什么同一首歌对应多行

Navidrome 服务器上的一个 FLAC 与磁盘上同一录音的一个 MP3 是**两行、两个 URN**，由一行 `track_links` 关联 —— 而不是一行合并记录。

这是本文档中影响最深远的一个建模决策，因此值得把理由说清楚：

- 它们在真正重要的维度上确实不同 —— 比特率、可用性、精确到毫秒的时长、封面图、能否拖动进度（seek）。
- 合并意味着要决定*哪一份*元数据胜出，而任何这类决定都会对某些用户是错的。
- 一次错误的自动匹配之后再"拆开"，远比按需合并困难，而模糊匹配出错的频率足以保证坏匹配必然发生（[authoring.md §11](../sources/authoring.md#11-跨源身份与故障转移)）。
- 一个从应用中移除的音源，应当恰好带走它自己的那些行。

统一曲库在*展示*时把互相关联的曲目呈现为同一个条目。存储层保持忠实。

### URN 辅助函数

在 `@BBeBee/protocol`（`packages/protocol/src/urn.ts`）中声明：

```ts
export const URN_SCHEME = 'BBeBee' as const

export type UrnKind = 'track' | 'album' | 'artist' | 'playlist' | 'genre'

export interface Urn {
  sourceId: string
  kind: UrnKind
  id: string
}

export class UrnError extends Error {
  readonly value: string
  // ...
}

export function isUrnKind(value: string): value is UrnKind
export function parseUrn(urn: string): Urn
export function tryParseUrn(urn: string): Urn | undefined
export function formatUrn(urn: Urn): string
export function sourceOf(urn: string): string
export function kindOf(urn: string): UrnKind
```

`parseUrn` 只按前三个冒号切分，因此音源本地的 id 中可以出现冒号。
`tryParseUrn` 在输入格式错误时不抛出异常，直接返回 `undefined`。
`formatUrn` 严格校验 `sourceId` 不含冒号与空白字符、`kind` 为合法 `UrnKind` 且 `id` 非空。

---


