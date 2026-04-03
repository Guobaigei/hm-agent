# hm-agent

基于 `AI SDK 6`、`TypeScript` 和 `Node.js 22+` 的海绵系统查询 Agent。

当前项目同时支持两种使用方式：

- `pnpm chat`：本地 CLI 对话
- `roll agent install hm-agent`：从 npm/Verdaccio 安装后作为 Roll subagent 使用

## 目录结构

```text
src/
  pages/
    core/ 配置、类型、运行时、模型适配
    hm/   海绵查询 Agent、Client、Session
  cli/    本地命令行对话入口
  mcp/    Roll subagent 的 MCP 入口与工具
```

## 功能

- 查询品牌、公司、门店、项目四类海绵实体
- 统一使用 `searchName` 作为搜索参数
- 通过 MCP `stdio` 对外暴露 `hm-query(message)`
- 发布包入口固定为 `dist/mcp/index.cjs`

## 环境变量

复制 `.env.example` 为 `.env`，只放 agent 运行时配置：

- `AI_API_KEY`
- `HM_BASE_URL`
- `HM_DULIDAY_TOKEN`

可选配置：

- `AI_BASE_URL`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL`，默认 `qwen3.5-plus`
- `HM_REQUEST_STRATEGY`，支持 `auto`、`post-json`、`post-form`

说明：

- `.env` 只负责 agent 运行时配置
- npm/Verdaccio 的 registry、登录 token 不放进 `.env`
- registry 相关配置放在 `.npmrc`

## 本地开发

安装依赖：

```bash
pnpm install
```

CLI 调试：

```bash
pnpm chat
```

构建：

```bash
pnpm build:dev
```

- `bundle + minify`
- 不做混淆
- 适合本地排查问题

```bash
pnpm build
```

- `bundle + minify + obfuscate`
- 适合发布到 Verdaccio 或接入 Roll

## 发布到 Verdaccio

### 1. 配置 registry

复制 `.npmrc.example` 为 `.npmrc`，将占位地址替换成你的 Verdaccio 地址。

示例：

```ini
registry=https://your-verdaccio.example/
always-auth=true
//your-verdaccio.example/:_authToken=${NPM_TOKEN}
```

也可以使用交互式登录：

```bash
npm login --registry https://your-verdaccio.example/
```

### 2. 构建并检查发布包

```bash
pnpm typecheck
pnpm build
npm pack
```

这里约定由你在发布前手动执行 `pnpm build`，`npm pack` 只负责检查最终发布包内容。

当前发布包只会包含：

- `dist/`
- `SKILL.md`
- `references/env.yaml`
- `README.md`
- `package.json`

不会包含：

- `src/`
- `.env`
- `.npmrc`
- 开发脚本和其他本地文件

### 3. 发布

```bash
pnpm build
npm publish --registry https://your-verdaccio.example/
```

## 在 Roll 中安装和使用

先确保安装机器的 `.npmrc` 也指向同一个 Verdaccio，然后执行：

```bash
roll agent install hm-agent
```

安装后可检查：

```bash
roll agent info hm-agent
```

显式调用：

```bash
roll run hm-agent hm-query --input-json '{"message":"帮我查一下肯德基这个品牌"}' --json
```

还需要在 `roll.config.yaml` 中注入与 `references/env.yaml` 一致的环境变量，例如：

- `AI_API_KEY`
- `HM_BASE_URL`
- `HM_DULIDAY_TOKEN`

## Roll 元数据

Roll 会读取 `package.json#rollAgent` 和 `SKILL.md`：

- `package.json#rollAgent`：定义运行时为 `stdio + on-demand`
- `SKILL.md`：声明 agent 描述与 `roll-env-file`
- `references/env.yaml`：声明运行所需环境变量

当前 MCP 启动入口固定为：

```json
{
  "start": {
    "command": "node",
    "args": ["dist/mcp/index.cjs"]
  }
}
```
