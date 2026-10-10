# @BBeBee/source-rules

Layer 4（feature）— BBeBee「音乐源规则语言」（legado 书源模式的音频版）的**纯逻辑实现**：解析、求值、模板展开、JSONPath、正则防护。

## 概述

> Pure logic: no Cordis, no platform SDK, and no I/O of any kind. It takes a rule and a scope and returns a value; every fetch belongs to `plugin-source-runtime`.

纯粹性的回报：真实源文档语料可以在**无网络**的情况下对录制的 HTTP fixture 回放。ESLint 在此包内专门禁了 `cordis` 与 `@BBeBee/kernel`；唯一依赖是 `@BBeBee/protocol`（只取 `RuleError`）。

**消费者**：唯一的 I/O 上下文是同层的 `plugin-source-runtime`（规则的求值者、网络与沙箱的提供者）。

**成熟度**：部分实现（M1 切片）。`=` 模板、JSONPath、regex、`@js:` 已可用；`css` 与 `xpath` 引擎的标记解析器尚未落地，使用时抛 `RuleEngineUnavailableError`（能力推导因此不会给出一个会失败的按钮）。

## 设计哲学

一条贯穿每个文件的主线：**作者在手机上、对着一个昨天改版的后端调试规则**。因此——缺席与空串分离；坏规则大声失败并携带文档摘录与归属（block/field/sourceId）；语法错误精确到字符并给出修法提示；误打的操作符被识别为笔误而非静默吞掉；来自陌生人的正则被验伤并双向设界；求值可逐原子追踪。

## 源文件

### `src/parse.ts` — 规则解析

把一行规则解析为求值管道。文法优先级：**`||` 最松，其次 `%%`，最紧 `&&`**（legado 的优先级，`a && b || c` 意为「先 a 再 b，否则 c」）：

```
rule        := alternative ( '||' alternative )*      // 第一个非空者胜
alternative := concat ( '%%' concat )*                // 交错
concat      := atom ( '&&' atom )*                    // 拼接
atom        := ( '@put:{…}' | '@get:{…}' )* engine-selector replacement*
replacement := '##' pattern ( '##' replacement )? '###'?
```

- **`parseRule(rule): ParsedRule`** — 主入口。"Pure and total: an unparseable rule is still a rule that fails"（解析失败也是确定性行为，抛 `RuleSyntaxError`）。
- **`inferEngine(selector)`** — 无前缀时推断：`=` → `template`；`$.`/`$[` → `json`；`//` → `xpath`；`:` → `regex`；**其余一律 `css`**。裸常量因此是**选择器**而非字面量（字面量必须写 `=`），解释器会拒绝而不是悄悄返回文本。
- 内部细节：`scanRegions` 先保护 `##…##` 正则体与 `{…}` 指令体（**未闭合的 `##` 吞掉操作符是语法错误**而非静默截断）；`matchBrace` 用计数配花括号（体内容纳嵌套模板）；`takeReplacements` 处理 `###`（只替换第一个匹配）后缀与尾部奇数段（= 删除）；`<js>…</js>` 是 `@js:` 的块形式，两端锚定；空原子 → `engine: 'empty'`（求值时贡献零值，让 `||` 链穿过它）；误打操作符的残留（如 `$.a|||$.b` 切出 `|$.b`）明确报错并提示「若真是选择器请写 `@css:`」。
- 类型：`Engine`、`Replacement`、`Atom`、`Concat`、`Interleave`、`ParsedRule`（`source` 保留原文供报错与 tracer 用）。

### `src/template.ts` — `=` 模板与 `{{ }}` 展开

- **`TemplateScope`** — `{{ }}` 能看到的**纯数据快照**（刻意不做活对象图，规则无法触回运行时）：`{ source?, track?, album?, prefs?, key?, page?, baseUrl?, item? }`；`item` 是列表规则求值字段时的当前行元素。
- **`JsEvaluator`** — 沙箱的**函数抽象**而非 realm 本体；无沙箱的调用方传 `undefined` 即可，得到的是文档化的拒绝。
- **`isTemplate(rule)`** — 是否以 `=` 开头。
- **`evaluateRule(rule, scope, site, js?)`** — 求值一条字段规则。非 `=` 规则一律抛 `RuleError`——**拒绝而非当作字面量放过**（「把不认识的规则当文本」是最难排查的失败模式）。
- **`evaluateUrlTemplate(rule, scope, site, js?)`** — 求值 **URL 模板字段**（`searchUrl`/`exploreUrl`）。它们不是规则：不从文档中选择，而是**构造取文档的请求**，所以 `{{ }}` 直接插值、**前导 `=` 可选**。
- **`renderTemplate(template, scope, site, js?)`** — 核心渲染：
  - `{{@js:expr}}` 是**唯一不是路径的占位符**，无沙箱时抛 `RuleError`；
  - 路径是**点分路径 + 数组下标**，不是 JavaScript 求值；只走**自有属性**（`{{track.constructor.name}}` 解析为空而不是立足点）；
  - 解析为空 / 得到对象 → `RuleError`——流 URL 少一个 id 会三步之后变成没人能诊断的 404，宁可在此报错；
  - 两遍处理（先收集占位符逐个 await，再拼回——`String.replace` 不能接异步回调）；
  - **不平衡的 `{{ }}` 抛错**，且只检查**模板本身**（剥掉合法占位符后）——远端歌名真叫 `Live {{2019}}` 不能反过来使正确的模板失败；
  - ⚠️ 插值逐字、不做 URL 编码（编码过滤器 `{{x|url}}` 属于完整语言）。

### `src/evaluate.ts` — 求值器

两条总法则：**「缺席」与「空串」是两回事**（选择器匹配零个节点 → 返回零个值；匹配到空串 → 返回 `''`，由调用方判断哪个算失败）；**坏规则必须大声失败**（不可解析的选择器是带规则名的错误，绝不静默空结果——那与「有效但过期的规则」无法事后区分）。

- **`RuleContext`** — `{ document, scope, site, vars?, js?, trace? }`。`document` 是已解析文档（今天是 JSON；标记引擎落地后是 DOM）；`vars` 供 `@put`/`@get`；`js` 缺失时 `@js:` 规则失败为**引擎问题**而非规则问题——「这个 app 跑不了你的源」和「你的源坏了」是两种话。
- **`engineAvailable(engine, { js? })`** — `template/json/regex/empty` 恒可用；`js` 仅当有沙箱；`css`/`xpath` 当前不可用。
- **`evaluate(rule, ctx): Promise<string[]>`** / **`evaluateNodes`**（保留原始值，列表规则选元素用）/ **`evaluateParsed`**（复用已 parse 的规则，省去 N 次重解析）。
- **求值管道**：`runParsed` 按序试各 `alternative`，**第一个产出非空结果者胜**（「后端改了字段名，文档里新旧两条规则都带着」能继续工作的机制）；`runInterleave` **顺序执行而非 `Promise.all`**（前一个 atom 可能 `@put` 后一个要 `@get` 的变量），之后按下标轮转交错；`runAtom` 中 `@put` 先跑、`@get` **必须穿过替换管道**（曾有 bug 返回了未变换的值——「本语言最坏的失败」：看起来工作、产出错误文本）。
- **引擎分派**：`json` → 文档必须是对象，否则 `RuleError` 消息用 `describe()` 说清文档到底是什么（`an HTML page`/`text`/…）——后端用 200 回 HTML 登录页时，若 JSONPath 对文本「匹配不到就返回空」，搜索就显示成空后端；`js` → 文档绑定为 **`result`**（legado 里 `@js:` 是后处理器，跑在上一个 atom 选出的东西上）；`regex` → 全局匹配，优先捕获组 1、无则整体匹配，零长匹配立即 break，产出上限 `MAX_REGEX_MATCHES`；`css`/`xpath` → `RuleEngineUnavailableError`。
- **`toText(value)`** — 对象 → `JSON.stringify`：选错了子树时看到 JSON 比 `[object Object]` 更能让人立刻发现错误。
- **`asRuleError`** — 携带 block/field、sourceId、**文档摘录**（先截断到 4096 再序列化），并**按来源脱敏**：只要 `scope.source.var` 存在就把它加进 secrets。

### `src/jsonpath.ts` — 刻意的 JSONPath 子集

不是通用实现：真实文档只用几种形状，而完整 JSONPath 的 filter 表达式会在本该**声明式**的一半语言里塞进一个脚本面——计算属于 `@js:`、属于沙箱后面。

```
$                 根
.name  ['name']   属性（单引号或双引号）
[0] [-1]          下标，负数从尾部数
[*]  .*           全部元素/值
..name            所有具名后代
```

其余一律**解析期**抛 `RuleSyntaxError`（dialect `'JSONPath'`）——「无结果」正是有效但写错的路径的返回，事后无从区分。明确拒绝：`..*`、filter、切片、并集、前导零下标。

- **`parseJsonPath(path): Step[]`** — 一次词法化，求值变成走步；**`queryJsonPath(root, path)`** — 文档序输出全部匹配。
- 安全细节：属性名字符白名单 `[A-Za-z0-9_\-@:+~]`（`-`/`@` 在内——真实文档有 `subsonic-response`、`@attributes`；`| & # $ { }` 在外——`$.a|b` 是漏打的 `||`，不是名为 `a|b` 的属性）；property 步只走自有属性（`$.constructor` 不能从解析后的 JSON 摸出 `Object`）；wildcard 用循环而非 spread（`push(...huge)` 在 10 万+ 元素时爆栈）；`..name` 递归限深 512（陌生后端的深嵌套文档曾打爆栈）。

### `src/regex-guard.ts` — ReDoS 防护

规则模式来自**导入的文档**，而 JS 正则引擎是回溯式且**不可中断**的（没有定时器、worker 或信号能让它停下；实测 24 字符输入耗 372ms，50,000 字符永不返回）。这是**诚实的部分方案**——拒绝能爆炸的模式 + 限制喂给模式的文本量；自我定位准确：**「这是一个界，不是一个证明」**。

- **`isUnsafeRegex(pattern)`** — **小状态机而非正则**（「用一个正则去检测危险正则是被咬两次的绝妙方式」）。检测：量词作用在自身含量词的组上（`(a+)+`）、或量词作用在含顶层轮换的组上（`(a|aa)+`）。细节：`?` 单独不算；`{n}` 在**组上关闭时**算乘法（`(.*a){20}b` ≙ `(.*a)+`）、在体内行内不算（`(a{2})+` 真安全）；字符类内跳过。
- **`compileRuleRegex(pattern, flags)`** — 先验伤再编译；不安全或编译抛错都归一为 `UnsafeRegexError`（拒绝发生在作者能改的地方，而不是在别人手机上把 app 冻住）。
- **`boundInput(text)`** — 截到 `MAX_REGEX_INPUT`（256 KiB）；单规则匹配上限 `MAX_REGEX_MATCHES`（10,000）。

### `src/syntax-error.ts` — 统一语法错误

`RuleSyntaxError extends Error { rule, dialect }`，`dialect: 'rule' | 'JSONPath'` 保留「哪个文法拒绝了这个串」这个真实区分。头注记录了存在**两个**同名类的往事（parse.ts 一个、jsonpath.ts 一个）：`e instanceof RuleSyntaxError` 能处理坏路径、却在坏规则上静默漏过——同名不同身份、编译器不报。

### `src/index.ts` — 公开导出面

按模块全量 re-export（该包 API 的权威清单）：`engineAvailable`、`evaluate`、`evaluateNodes`、`evaluateParsed`、`toText`、`parseJsonPath`、`queryJsonPath`、`parseRule`、`inferEngine`、`evaluateRule`、`evaluateUrlTemplate`、`isTemplate`、`renderTemplate`、`compileRuleRegex`、`isUnsafeRegex`、`boundInput`、`RuleSyntaxError`、`RuleEngineUnavailableError`、`UnsafeRegexError`、`MAX_REGEX_INPUT`、`MAX_REGEX_MATCHES` 及各类型。

## 规则语言语法速查（以本包现状为准）

| 前缀 | 引擎 | 现状 |
|---|---|---|
| `@css:` | CSS 选择器 | **不可用**（抛 `RuleEngineUnavailableError`） |
| `@json:` / `$.`/`$[` | JSONPath | 可用 |
| `@xpath:` / `//` | XPath | **不可用** |
| `@js:` / `<js>…</js>` | 沙箱脚本 | 可用（需 `JsEvaluator`；文档绑定为 `result`） |
| `=` | 模板 | 可用 |
| `:` | 正则 | 可用（全局匹配、取捕获组 1） |
| 无前缀 | 推断 | 其余 → css（裸常量是选择器不是字面量） |

| 组合符 | 语义 |
|---|---|
| `\|\|` | 备选，第一个非空结果者胜 |
| `%%` | 交错合并（按序求值、按下标轮转） |
| `&&` | 拼接 |
| `##pat##repl##` | 正则替换；替换文本为**字面量**（`$1` 不解释）；`###` 后缀只替换第一个匹配 |
| `@put:{key:rule}` / `@get:{key}` | 求值内变量（`@get` 会穿过替换管道） |

`{{dotted.path}}`（自有属性路径）与 `{{@js:expr}}`（唯一非路径占位符）是模板占位符。**legado 风格的 `@text`/`@attr:` 等属性提取函数尚不存在**（随标记引擎一起到来）。

## 相关文档

- `docs/06-music-sources.md` §3/§8：规则语言、沙箱宿主面
- `packages/feature/plugin-source-runtime/README.md`：唯一的 I/O 上下文
- `packages/feature/plugin-source-runtime/`：规则语言的真实测试语料与运行上下文
