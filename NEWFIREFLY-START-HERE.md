# 新后台上线前：小白操作说明

## 先分清三个东西

- 旧后台保持不动，不需要删除或覆盖。
- 新后台编辑的是你自己的 `mei-ou/newfirefly` 博客仓库。
- 当前浏览器的 `127.0.0.1:4322` 是模拟预览：不会把文章写入 GitHub，也不会真的上传图片。重启服务后模拟文章会清空。

目前完成的是代码适配和本地验收，不是线上部署。不要把模拟预览里的文章当成正式备份。

## 已经为你准备好

本地配置：`E:\mycode\houtai\firefly-admin\wrangler.newfirefly.jsonc`。

已经填写新 Worker 名、博客仓库、暂定分支 `main`、文章目录、新后台域名和图床地址。原来的 `wrangler.jsonc` 未改动。

这个新配置已被 Git 忽略，避免误提交你的账号配置。仓库里保留不含真实账号信息的 `wrangler.newfirefly.example.jsonc` 模板，换电脑时需要重新准备本地配置。

## 还缺四项非密码信息

| 配置项 | 需要什么 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | 你的 Access 团队域名，形如 `团队名.cloudflareaccess.com`，不要带 `https://` |
| `ACCESS_AUDIENCE` | 保护新后台的 Access 应用 Audience，不是应用名称 |
| `ACCESS_ALLOWED_EMAILS` | 你允许登录后台的邮箱；多个邮箱用英文逗号分隔 |
| D1 的 `database_id` | 为新后台新建的独立 D1 数据库 ID，不要填旧数据库的 ID |

这些字段现在保留 `REPLACE_WITH_...`，不是已配置完成。若需要我帮你填写，可以提供这四项信息，或提供遮住密码和 Token 的对应界面截图。不要把 Token 发到聊天里。

## 两个 Token 另行设置

- `GITHUB_TOKEN`：供新后台读写你自己的目标博客仓库。
- `IMAGEBED_API_TOKEN`：供新后台调用你搭建的图床。

不要写进以上 JSONC 配置，也不要粘贴到聊天、文章或 Git。应通过交接文档中的 Secret 设置命令在你自己的终端输入；这一步尚未执行。

本地配置检查不会读取 Token，因此“检查通过”不等于 Token 有效、Access 已保护新域名、数据库已迁移或前台已自动部署。

## 填好后怎样检查

在项目目录打开 PowerShell，再运行：

```powershell
Set-Location E:\mycode\houtai\firefly-admin
pnpm check:newfirefly
```

这个命令只检查本地配置，不会联网、不写文章、不迁移数据库、不部署。未填完整时会列出缺项，这是正常的保护行为。

配置通过后，使用新后台专用构建命令：

```powershell
pnpm build:newfirefly
```

它会依次检查配置、明确选择新后台配置构建、检查编辑器体积、核对构建产物。任何一步失败都会停止。它仍然不会部署，不会修改旧后台配置，也不会改变当前终端的环境变量。

不要用旧的 `pnpm deploy` 给新后台上线。真实数据库迁移、Secret、域名与 Access 配置，以及最后的部署，需要单独核对和执行；详细步骤见 `E:\mycode\houtai\firefly-admin\NEWFIREFLY-HANDOFF.md`。

## 真正上线后还要验收

先备份博客仓库，并在测试目标中确认：登录 → 创建中文分类文章 → 真正上传图片 → 保存并重开 → 编辑 → 删除 → 邻接文章仍在。最后确认博客前台监听同一分支且构建成功。未经确认，不向真实博客写入测试文章。

未来更换后台域名时，检查器允许新 HTTPS 域名，不会把当前域名写死；需要同时更新配置中的 `ADMIN_ORIGIN` 和实际域名/Access 设置，并重新构建。图床域名和博客前台域名是独立配置，不要混为一个。
