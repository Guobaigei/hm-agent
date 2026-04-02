# agent-hm

基于 `AI SDK 6`、`TypeScript` 和 `Node.js 22+` 的海绵系统查询 Agent。

当前使用方式：

- **CLI**：本地交互式对话（`pnpm chat`）
- **Roll Subagent**：通过 MCP `stdio` 暴露 `hm-query(message)`（需先 `pnpm build`，由 Roll 启动 `dist/mcp/index.cjs`）

## 目录结构

```text
src/
  pages/
    core/ 配置、类型、运行时、模型适配
    hm/   海绵查询 Agent、Client、Session
  cli/    本地命令行对话入口
  mcp/    Roll Subagent 的 MCP 入口与工具
```

## 功能

- 查询品牌、公司、门店、项目四类海绵实体
- 统一使用 `searchName` 作为搜索参数
- 使用 AI SDK 工具循环能力调度海绵接口

## 环境变量

复制 `.env.example` 为 `.env`，至少配置：

- `AI_API_KEY`
- `HM_BASE_URL`
- `HM_DULIDAY_TOKEN`

可选配置：

- `AI_BASE_URL`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL`，默认 `qwen3.5-plus`
- `HM_REQUEST_STRATEGY`，支持 `auto`、`post-json`、`post-form`

## CLI 对话

```bash
pnpm install
pnpm chat
```

也可以指定一个固定会话 ID，连续重启 CLI 后复用同一上下文：

```bash
pnpm chat -- local-study
```

## Roll Subagent

当前项目可作为 `roll-agent` 的本地 subagent 接入。Roll 会读取 `package.json#rollAgent`，启动构建产物：

```json
{
  "start": {
    "command": "node",
    "args": ["dist/mcp/index.cjs"]
  }
}
```

更新或首次接入前先构建：

```bash
pnpm build
```

构建分成两种模式：

```bash
pnpm build:dev
```

- `bundle + minify`
- 不做混淆
- 适合本地排查问题

`pnpm build`：

- `bundle + minify + obfuscate`
- 适合接入 Roll 或对外分发

如果你要临时覆盖默认行为，也可以这样执行：

```bash
BUILD_OBFUSCATE=0 pnpm build
```

在 `roll-agent` 中注册本地目录：

```bash
roll agent add /path/to/agent-hm
```

显式调用示例：

```bash
roll run hm-agent hm-query --input-json '{"message":"帮我查一下肯德基这个品牌"}' --json
```

注册前请确认 `roll.config.yaml` 中存在与环境说明 [references/env.yaml](references/env.yaml) 一致的变量注入。

`hm-agent` 的能力说明：

- [SKILL.md](SKILL.md)
- [package.json](package.json)
- [references/env.yaml](references/env.yaml)

## 检查

```bash
pnpm typecheck
pnpm build
```

## 关于 `.ts` 里引用 `.ts`

源码里很多 TypeScript 文件会写成下面这种形式：

```ts
import { getConfig } from '../pages/core/config.ts';
```

现在项目已经统一成显式 `.ts` 扩展名，并在 `tsconfig.json` 中开启了 `allowImportingTsExtensions`。
这样源码阅读时更直观，构建阶段再由 `tsx + esbuild + obfuscator` 处理这些 TypeScript 入口与依赖。
