# hm-agent

基于 `AI SDK 6`、`TypeScript` 和 `Node.js 22+` 的海绵系统查询 Agent。

当前项目同时支持两种使用方式：

- `pnpm chat`：本地 CLI 对话
- `roll agent install hm-agent`：从 npm/Verdaccio 安装后作为 Roll subagent 使用

## 目录结构

```text
src/
  pages/
    core/     配置、运行时、模型适配
    hm-query/ 海绵查询 Agent、Client、Session
  cli/    本地命令行对话入口
  mcp/    Roll subagent 的 MCP 入口与工具
```

## 功能

- 查询品牌、公司、门店、项目四类海绵实体
- 查询岗位、新建岗位、编辑岗位
- 统一使用 `searchName` 作为搜索参数
- 通过 MCP `stdio` 对外暴露 `hm-query(message)` 和 `position(message, sessionId?)`
- 发布包入口固定为 `dist/mcp/index.cjs`

## hm-query 输出格式

查询命中结果时，`reply` 会按 Markdown 表格输出：

| 实体类型 | ID | 名称 | 摘要 | 来源 |
| --- | --- | --- | --- | --- |
| 品牌/公司/门店/项目 | 业务 ID | 业务名称 | 关键字段摘要 | 接口来源 |

当命中多个候选项且需要用户澄清时，`reply` 会提示用户确认，并返回候选项表格。

结构化字段仍会保留：

- `results`：完整查询结果，包含 `entityType`、`id`、`name`、`summary`、`source`
- `candidates`：需要澄清时的候选项
- `citations`：引用信息
- `usedTools`：本次使用过的内部查询工具

## position 岗位管理

`position(message, sessionId?)` 支持：

- 查询岗位：按岗位 ID、项目、品牌、城市、岗位名称、状态搜索
- 新建岗位：自然语言或 JSON 字段生成岗位预览
- 继承新建：拉取已有岗位详情作为模板，再叠加用户修改并生成新建预览
- 编辑岗位：先拉取岗位详情，再合并用户修改并生成差异预览
- 确认提交：用户确认后执行保存或保存并发布

写入行为：

- 新建/编辑不会直接提交，都会先返回预览和 `draftId`
- 同一个 `sessionId` 只保留最近一条待确认岗位预览
- 默认确认动作是保存；只有用户明确说发布时才发布
- 发布前必须明确是否通知供应商，例如“通知供应商并发布”或“不通知供应商并发布”
- 支持从已有岗位继承新建，但不直接调用 HM 复制岗位接口；首版不支持草稿箱管理、批量编辑和本地图片上传

常见示例：

```bash
roll run hm-agent position --input-json '{"sessionId":"demo","message":"查询岗位 ID 123 已发布岗位"}' --json
roll run hm-agent position --input-json '{"sessionId":"demo","message":"新建服务员岗位，兼职小时工，月结，薪资20元/时，综合薪资4000-6000元/月，18到45岁，男女不限，无试工，无培训，招聘3人，阈值1.5倍"}' --json
roll run hm-agent position --input-json '{"sessionId":"demo","message":"照着岗位 ID 1909 新建，把招聘人数改为 5 人"}' --json
roll run hm-agent position --input-json '{"sessionId":"demo","message":"确认保存"}' --json
```

岗位接口复用 `HM_BASE_URL` 和 `HM_DULIDAY_TOKEN`。岗位模块按 HM2.0 的 `newhm` 语义请求去掉前缀后的路径，例如 `/job/jobList`、`/job/detail`、`/job/create`、`/job/update`。

## 环境变量

复制 `.env.example` 为 `.env`，只放 agent 运行时配置：

- `AI_API_KEY`
- `HM_BASE_URL`
- `HM_DULIDAY_TOKEN`

可选配置：

- `AI_BASE_URL`，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL`，默认 `qwen3.6-plus`
- `AI_FALLBACK_MODEL`，默认 `deepseek-v4-pro`
- `AI_FALLBACK_BASE_URL`，默认 `https://api.deepseek.com`
- `DEEPSEEK_API_KEY`，DeepSeek 备用模型鉴权 key；不配置时不会启用 DeepSeek 备用模型
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

测试：

```bash
pnpm test
```

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
roll run hm-agent position --input-json '{"sessionId":"demo","message":"查询已发布服务员岗位"}' --json
```

还需要在 `roll.config.yaml` 中注入与 `references/env.yaml` 一致的环境变量，例如：

- `AI_API_KEY`
- `AI_FALLBACK_MODEL`
- `AI_FALLBACK_BASE_URL`
- `DEEPSEEK_API_KEY`
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
