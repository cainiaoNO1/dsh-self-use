# dsh-self-use

个人自用的 DSH（DeepSeek Harness）Web 插件：把一批日常用得到的小功能集中到设置里的「自用插件」分区。

所有能力都可以单独开关，关掉即恢复 DSH 原生行为，不改动 DSH 源码。

## 功能

### 1. 新会话默认完全权限

打开开关后，把 DSH 官方配置里的 `permission.defaultPreset` 写成 `danger-full-access`，新建会话不再弹审批。
关闭时写回开启前记录的原值，不会把你的配置改乱。

### 2. 提示词置顶

在聊天区顶部吸附当前正在浏览的那条提问。

- 取「最后一条已滚过视口顶部的用户提问」，没有则退化为最后一条可见提问
- 点击可跳回原消息并高亮
- 旁边的展开按钮：不展开时和置顶图标一样灰，点击变蓝，框体从单行省略变成多行完整显示

### 3. 提示词查询（Ctrl/Cmd + F）

接管浏览器原生查找，改为对**本会话全部用户提问**做模糊检索。

- 子序列匹配，子串优先，命中高亮
- 不再呼出浏览器的查找框

### 4. 空会话清理

扫描并删除「从未收到任何用户提问」的空会话。

- 手动勾选删除，或后台自动清理超过 N 分钟的空会话
- 删除前需确认

### 5. @ 提及隐藏子代理会话

打开后，`@` 候选列表过滤掉全部 `origin=subagent` 的子代理会话。子代理会话仍可在侧栏打开。

### 6. 自动附带 Skill

在设置中多选 skill，之后每次真实对话都会在 `agent/pre-step` 追加一条 `/skill` 指令。

- 只在「用户刚发消息」的那一步注入，续跑和 goal 唤醒不注入，上下文不会自己增长
- 被选中的 skill 同时从 `/` 菜单中隐藏，避免重复调用

### 7. 模型自定义

- **默认强度**：给每个模型设一个默认推理强度，输入框选中该模型时自动套用
- **隐藏模型**：模型行右侧的眼睛按钮，切换后该模型不在下拉框显示
- **隐藏模型组**：模型组标题旁的眼睛按钮，整组隐藏
- 卸载 model-manager 插件后可用它隐藏残留的模型组

### 8. 文件管理增强

在右侧「文件」标签上叠加一层增强，**不破坏原生预览**。

- **目录导航**：点文件夹进入该目录；顶部路径变成面包屑，点 `Users` 就跳到 `/Users`
- **行内操作**：每行右侧三个图标 —— 复制路径、下载、删除
- **文件大小**：靠右显示，不换行
- **实时刷新**：可设 关闭 / 2 / 5 / 10 / 30 秒，默认 5 秒
- **删除确认**：弹确认框，确认后永久删除

### 9. 切会话保留已粘贴图片

复制图片到输入框后切到别的会话再切回来，图片还在。

- 内存缓存，每会话最多 10 张，单张 ≤ 8MB
- 只在本进程内有效，刷新页面即清空

## 跨平台

文件管理增强同时支持 macOS / Linux / Windows：

| 场景 | 支持 |
| --- | --- |
| POSIX 路径 | `/Users/ymj/Desktop` |
| Windows 盘符 | `C:\\Users\\ymj`、`C:/Users/ymj` |
| UNC 路径 | `\\\\server\\share` |

路径工具全部走 `path.resolve` / `path.dirname`，不使用硬编码的 `/` 分割。

## 安装

```bash
# 在插件目录打包
npm pack

# 安装到 web profile
dsh plugin --profile web add ./dsh-self-use-1.0.0.tgz --force
```

安装后重启 `dsh web`，打开 设置 → 自用插件。

## 文件布局

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：ESM，无构建步骤，无第三方依赖。注册 HTTP 路由、pre-step 钩子、清理定时器。 |
| `client.js` | 浏览器半：单文件 DSH client module（`window.__ModuleLoader__`），只用 `require("react")`。 |
| `cordis.patch.yml` | bundle patch，把插件以 `dsh-self-use` 注册进 profile。 |
| `package.json` | 包清单，含 `dsh.bundle` / `dsh.client` 元数据。 |

## Host API

所有响应为 `application/json; charset=utf-8` + `cache-control: no-store`。前缀 `/api/dsh-self-use`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回版本 |
| GET | `/prompts?sessionId=<id>` | 该会话的全部用户提问 |
| GET | `/empty-sessions` | 列出空会话 |
| POST | `/empty-sessions/delete` | 删除指定空会话 |
| GET/POST | `/auto-skills` | 读写自动附带的 skill 列表 |
| GET/POST | `/model-custom` | 读写模型默认强度与隐藏配置 |
| GET/POST | `/question-wait` | 读写提问等待时长 |
| GET/POST | `/prefs` | 读写跨源偏好 |
| GET/POST | `/auto-cleanup` | 读写自动清理配置 |
| GET | `/files?path=<abs>` | 列出目录 |
| POST | `/files/delete` | 永久删除文件或目录树 |
| GET | `/files/download?path=<abs>` | 下载文件 |

偏好与配置统一存在 `~/.dsh/dsh-self-use/` 下，因此 127.0.0.1 与局域网地址共享同一份设置。

## 权限说明

文件管理增强按「整台机器完全放开」设计：可浏览、下载、永久删除文件系统上任意路径。

- 删除有二次确认，且拒绝删除根目录
- 仅建议在自己的机器上使用

## 兼容性

- 依赖 DSH 官方插件 `@deepseek-ai/dsh-client-ui-sidebar-files` 的 DOM 标记（`data-files-state` / `data-files-path` 等）
- 官方升级若改动这些标记，文件管理增强可能失效，其余功能不受影响
- 不修改 DSH 官方源码，所有覆盖在插件 dispose 时还原

## License

MIT
