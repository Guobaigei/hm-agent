# agent-hm

基于 `AI SDK 6`、`TypeScript` 和 `Node.js 22+` 的海绵系统查询 Agent。

当前支持两种使用方式：

- 本地服务：提供 `POST /chat`、`GET /health`、`GET /ready`
- Roll Subagent：通过 MCP `stdio` 暴露 `query_hm(message)`

## 目录结构

```text
src/
  core/   业务核心、配置、运行时、海绵接口适配
  services/ HTTP 服务入口与路由装配
  cli/    本地命令行对话入口
  mcp/    Roll Subagent 的 MCP 入口与工具
```

## 功能

- 查询品牌、公司、门店、项目四类海绵实体
- 统一使用 `searchName` 作为搜索参数
- 提供 `POST /chat` 聊天入口
- 提供 `GET /health` 与 `GET /ready` 检查
- 使用 AI SDK 工具循环能力调度海绵接口

## 环境变量

复制 `.env.example` 为 `.env`，至少配置：

- `AI_API_KEY`
- `HM_BASE_URL`
- `HM_DULIDAY_TOKEN`

可选配置：

- `AI_BASE_URL`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL`，默认 `qwen3.5-plus`
- `HM_REQUEST_STRATEGY`，支持 `auto`、`get`、`post-json`、`post-form`

## 启动

```bash
pnpm install
pnpm dev
```

服务默认运行在 `http://localhost:3000`。

## CLI 对话

如果你不想每次手动发 `curl`，可以直接启动本地交互式 CLI：

```bash
pnpm chat
```

也可以指定一个固定会话 ID，这样连续重启 CLI 后还能复用同一个上下文：

```bash
pnpm chat -- local-study
```

## Roll Subagent

当前项目也可以作为 `roll-agent` 的本地 subagent 接入。

开发时直接启动 MCP stdio 入口：

```bash
pnpm mcp
```

Roll 运行时会读取 `package.json#rollAgent`，实际启动构建产物：

```json
{
  "start": {
    "command": "node",
    "args": ["dist/mcp/index.cjs"]
  }
}
```

所以在注册或更新到 Roll 之前，先构建一次：

```bash
pnpm build
```

`pnpm build` 现在使用 `esbuild` 对 `services`、`cli`、`mcp` 三个入口做 `bundle + minify`。产物会比 `tsc` 直出更难读，但它不是安全机制，只是降低可读性。

在 `roll-agent` 中注册本地目录：

```bash
roll agent add /Users/gt/baigei/play
```

显式调用：

```bash
roll run hm-agent query_hm --input-json '{"message":"帮我查一下肯德基这个品牌"}' --json
```

注册前请确认 `roll.config.yaml` 中存在：

```yaml
agents:
  env:
    hm-agent:
      AI_API_KEY: ${DASHSCOPE_API_KEY}
      AI_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1
      AI_MODEL: qwen3.5-plus
      HM_BASE_URL: https://test-gateway.duliday.com/sponge/admin
      HM_DULIDAY_TOKEN: ${DULIDAY_TOKEN}
```

`hm-agent` 的运行时事实源如下：

- [SKILL.md](/Users/gt/baigei/play/SKILL.md)
- [package.json](/Users/gt/baigei/play/package.json)
- [references/env.yaml](/Users/gt/baigei/play/references/env.yaml)

## 接口

### `POST /chat`

```json
{
  "sessionId": "local-debug",
  "message": "查一下门店 星巴克",
  "userId": "demo-user"
}
```

### `GET /health`

返回进程状态。

### `GET /ready`

返回模型与海绵相关配置是否完整。

## 检查

```bash
pnpm typecheck
pnpm build
```
