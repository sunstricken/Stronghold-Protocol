# 定制服：Debian / Docker 自动发布

本阶段适用于 Debian、Docker、x86-64（`uname -m` 为 `x86_64`）、2 核 2 GB 左右的 HTTP 部署。
支持直接公开 HTTP 端口，也支持现有 Nginx 代理至本机回环端口。账号和聊天不在本阶段范围内。

## 发布行为

- `master` 的 **push CI 完整成功**后，`.github/workflows/deploy.yml` 构建代码镜像并上传 GHCR。
  不从 PR 的测试结果发布，不从上游自动合并代码，不下载或发布游戏美术。
- 镜像使用 `sha-<完整提交SHA>` 标签，部署使用不可变 digest；镜像 revision 与 `/healthz.release` 用于核验。
- Repository Variable `DEPLOY_ENABLED=true` 才连接生产服务器；未配置时只发布镜像。
- 自动发布与手动回滚共用一个并发组，运行中的部署不被新提交取消。服务器通过 `flock` 防止并行脚本。
- 候选容器没有公开端口、插件只读，先检查页面、前端模块、素材清单和 WebSocket hello。
- 切换前通过 `docker exec` 调用容器内部接口，暂停新开局，已有对局和重连继续。
  每 15 秒续期并检查对局数，默认最多等 10 分钟。超时以 **75** 退出并恢复新开局，旧容器不变；
  此后需要稍后重跑 Deploy，不会后台无限等待。
- 对局数归零后保留旧容器，启动新版。新版检查失败尝试恢复旧容器，恢复失败明确报错。
  每个容器限 768 MB、1 核，限制候选与线上并行时的资源占用；这不是容量测试结论。
- 这是**等对局结束后短暂停服切换**，未实现新旧实例同时接待玩家，也不能恢复机器故障丢失的内存对局。
  切换时大厅短暂重连，旧房间可能结束，但浏览器不因版本检测自动刷新。

参考 GitHub [官方镜像发布文档](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
和[并发控制文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
工作流固定官方 Actions 的提交 SHA。

## 服务器准备

服务器需要 Docker、Bash、`flock`（Debian `util-linux`）和 OpenSSL，无需 Node.js。
准备固定目录，例如 `/opt/stronghold`，由有 Docker 权限的部署 SSH 用户持有：

```text
/opt/stronghold/
  server.env                 # 私有运行配置，不进入 Git
  shared/
    site-config.json         # 可选：首页导航与联系渠道；未挂载时使用镜像默认配置
    assets/                  # 现有 public/assets
    fonts/                   # 现有 public/fonts
    plugins/                 # 现有插件、配置和工作台钥匙
    assets.json              # 与素材对应的 data/assets.json，推荐保留
    local-assets.json        # 可选，本地素材清单
    local-fx.json            # 可选，本地特效清单
  deploy-<run>-<attempt>/     # 工作流上传的部署工具
```

复制现有的完整素材及其清单，不能只创建空目录就认为素材迁移完成。只挂载三个美术清单，
不挂载整个 `data/`，否则会遮住新版游戏数据。容器的 `node` 用户（UID 1000）需要插件目录的读写权限。

把 `scripts/deploy/server.env.example` 复制为服务器上的 `server.env`，运行 `openssl rand -hex 32`
生成 `SP_DEPLOY_TOKEN`，保持 64 位小写十六进制，将配置权限设为 `600`。真实配置不进 Git、不发到聊天。
内部端口固定为 3000，对外端口可配置。示例关闭工作台与代理信任，适用于直接公开端口。

镜像可设为 public 或保持 private。Actions 构建使用 `packages: write`，部署任务使用 `packages: read`。
部署时通过加密 SSH 标准输入把本次任务的 `GITHUB_TOKEN` 交给服务器的临时 Docker 登录目录，退出时清理，
无需额外长期包令牌；镜像通过 OCI source 标签关联本仓库，由该仓库工作流读取。
手动从服务器首次拉取私有镜像时仍需只读包凭据，或使用已配置上述临时认证的 Actions 发布。
已保留在服务器的 digest 镜像直接使用本地缓存，因此手动回滚不依赖过期的工作流令牌。
参考 [GitHub Container registry 认证说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## 首次迁移现有容器

旧版没有部署控制接口或 `io.stronghold.managed` 标签，脚本会拒绝替换这样的同名容器。
首次迁移安排在无人游玩的维护时段：

1. 核实当前容器名、端口映射和挂载；复制上面的文件，备份插件。
2. 关闭 `DEPLOY_ENABLED`，先把代码合入自己的 `master`，等完整 CI 与镜像构建成功。
3. 上传 `scripts/deploy/` 至服务器，例如 `/opt/stronghold/deploy/`。若旧容器占用正式名称和端口，
   在维护时段停止并重命名保留备份，不要删除。旧版无法自动验证禁止新开局，因此该步骤不自动执行。
4. 用本次镜像 digest 和提交 SHA 安装；验收素材、房间和真人开局后再启用生产自动发布。

```bash
SP_DEPLOY_ROOT=/srv/stronghold/managed SP_PUBLIC_PORT=3000 SP_BIND_ADDRESS=127.0.0.1 \
  bash /srv/stronghold/managed/deploy/deploy.sh deploy \
  ghcr.io/sunstricken/stronghold-protocol@sha256:<镜像digest> <完整提交SHA>
```

占位符须替换为真实值，不能使用 `latest`。首次安装没有受管旧容器，因此没有自动回滚对象；失败时使用
手动迁移备份。后续成功发布会把受管旧容器保留为 `stronghold-previous`。

## GitHub 配置

创建 `production` Environment。是否需要审批由服主选择，本方案不强制每次审批。
配置以下 **Repository Variables**，开关不能只放在 Environment：

| Variable | 内容 |
|---|---|
| `DEPLOY_ENABLED` | 验收后设 `true`，其他值只构建镜像 |
| `DEPLOY_HOST` | 服务器 IPv4 或主机名，不带协议和路径 |
| `DEPLOY_USER` | 有 Docker 权限、能写部署目录的 SSH 用户 |
| `DEPLOY_PORT` | SSH 端口，默认 `22` |
| `DEPLOY_PATH` | 默认 `/opt/stronghold`；限英文、数字、斜杠、下划线、连字符 |
| `DEPLOY_CONTAINER` | 正式容器名，默认 `stronghold` |
| `DEPLOY_PUBLIC_PORT` | 宿主机 HTTP 端口，默认 `3000`；Nginx 代理场景沿用其后端端口 |
| `DEPLOY_BIND_ADDRESS` | `0.0.0.0`（默认，直接公开）或 `127.0.0.1`（仅供本机代理访问） |

在 `production` Environment 设置两个 Secrets：

| Secret | 内容 |
|---|---|
| `DEPLOY_SSH_KEY` | 专用于部署的私钥，公钥放进服务器部署用户的 `authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | 核对过指纹的 SSH 主机公钥记录；非 22 端口用 `[主机]:端口` 格式 |

密钥仅写入 GitHub Secrets，可通过设置界面或下方 CLI 配置。不要禁用主机校验。fork 的 Actions 若尚未启用，需要启用一次。

也可从本机文件通过 GitHub CLI 设置 Secret，避免在命令行参数或聊天中暴露私钥。
PowerShell 示例（占位路径替换为实际文件）：

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git --hostname github.com
Get-Content -Raw <专用部署私钥文件> | gh secret set DEPLOY_SSH_KEY --repo sunstricken/Stronghold-Protocol --env production
Get-Content -Raw <核验过的known_hosts文件> | gh secret set DEPLOY_KNOWN_HOSTS --repo sunstricken/Stronghold-Protocol --env production
```

Windows 已安装但找不到 `gh` 时，检查安装目录是否在用户 PATH，并重开终端；用 `gh auth status`
核验实际登录账号。不要将访问令牌写入 Git remote。

2026-10-27 已核验本服入口为 Nginx 公网 80 → `127.0.0.1:3000`，旧容器 `stronghold-game-1` 由 Compose 管理。
对应变量为 `DEPLOY_HOST=47.101.63.122`、`DEPLOY_USER=root`、`DEPLOY_PORT=22`、
`DEPLOY_PATH=/srv/stronghold/managed`、`DEPLOY_CONTAINER=stronghold`、`DEPLOY_PUBLIC_PORT=3000`、
`DEPLOY_BIND_ADDRESS=127.0.0.1`。Nginx 已重写转发头，运行配置沿用 `TRUST_PROXY=auto`。
首次迁移前核对容器名、目录和端口，`DEPLOY_ENABLED` 保持 `false`，验收后再设 `true`。

阿里云控制台以 `admin` 登录时，Docker 命令可能需要 `sudo`。先做只读核对：

```bash
uname -m
sudo docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}'
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# 将实际游戏容器名填入下面命令；只打印挂载，不打印环境变量或令牌。
sudo docker inspect --format '{{json .Mounts}}' <实际游戏容器名>
```

控制台 `admin` 与 SSH `root` 是不同账号。为自动部署创建专用 SSH 密钥，通过已登录的控制台或
现有 root 会话安装公钥，保留原有授权密钥。主机公钥必须与可信控制台显示的指纹一致；不要关闭严格校验。

本服的准备目录与旧 Compose 分离。`shared/assets`、`shared/fonts` 通过符号链接复用
`/srv/stronghold/bundles/v0.3.3/Stronghold-Protocol/public/` 下的原素材，所以更换代码镜像后仍须保留该目录。
美术清单已复制，插件从原 Docker volume 复制到独立目录；正式迁移前再次核对有无插件更新。
首次切换需要先有通过 CI 的镜像，再在维护时段停止 `stronghold-game-1`，由新受管容器接管同一个回环端口。
保留旧容器与原 Compose 文件；首次安装失败且新容器已移除时，可用 `docker start stronghold-game-1` 恢复。
不要在新受管容器运行时执行旧 Compose 的启动命令，两者会争用同一端口。

## 首页公开导航与联系渠道

维护者身份和 fork / 上游来源链接集中在 `shared/project.js`。本版本的仓库和问题反馈指向
`sunstricken/Stronghold-Protocol`；原项目历史引用、署名和许可证保留。

修改 [public/site-config.json](../public/site-config.json) 可以更新首页名称、联系渠道和导航列表。
它是公开配置，不能写入密钥、密码或其他私密信息。当前联系邮箱为 `strickensun@qq.com`；
后续可在 `contacts` 数组追加 QQ 群公开链接，不需要修改页面组件。每项包含 `label` 和 `url`，
支持 HTTP、HTTPS 和不带查询参数的 `mailto:`；没有联系项时隐藏入口。

`servers` 是手动维护的有序数组，每项包含 `name`、`url`，可选 `description`、`maintainer` 和 `enabled`。
删除条目或将 `enabled` 设为 `false` 即可停用。未知的维护者和运行状态不要编造。
`currentServerName` 是本站显示名；当前访问地址从浏览器读取，同源条目不重复展示。
`showOnFirstVisit: false` 可关闭首次提示，首页入口仍保留。首次弹窗的关闭、Escape 或“继续使用当前服务器”
均在此站点记住已读状态，后续可手动打开。

导航仅出现在标题首页；大厅、房间和对局均不显示。其他服务器在新标签页打开，不迁移身份、房间或对局。
页面说明列表为自发整理、各服独立运营且无合作关系；不向其他服务器探测状态、不做自动负载均衡。
列表加载失败不影响开始游戏，玩家可手动重试。

Docker 部署可将该文件复制到部署目录的 `shared/site-config.json`（本服为 `/srv/stronghold/managed/shared/site-config.json`），部署脚本会只读挂载到客户端。
没有此文件时使用镜像中的默认配置。挂载配置不会被代码发布或回滚覆盖；原地编辑后重新打开页面即可读取。
若编辑器替换整个文件 inode，需要重新创建容器，使单文件挂载指向新文件。

本阶段保留 HTTP；域名、HTTPS、Cloudflare 代理和证书配置另行实施。

## 手动发布和回滚

Actions → Deploy → Run workflow，分支选 `master`：

- `deploy`：发布当前已通过 push CI 的 master。过时运行对应的提交已不是 master 时拒绝发布。
- `rollback`：用服务器保留的上一镜像，经过同样的候选检查和对局保护。不重建当前代码，不修改 Git 历史。

服务器也可执行：

```bash
SP_DEPLOY_ROOT=/srv/stronghold/managed SP_PUBLIC_PORT=3000 SP_BIND_ADDRESS=127.0.0.1 \
  bash /srv/stronghold/managed/deploy/deploy.sh rollback
```

自定义容器名、端口或监听地址时，手动命令也要传 `SP_CONTAINER_NAME`、`SP_PUBLIC_PORT`、`SP_BIND_ADDRESS`。
回滚不修改素材、插件及未来的数据库。镜像不会自动清理，维护磁盘时保留上一版容器引用的镜像。

## 更新提示

每分钟检查版本，两次确认变化后弹出一次“发现新版本”。“稍后更新”、关闭按钮或 Escape 只关闭弹窗。
进入游戏后保留“新版本可用 / 查看更新”提示条。对局中禁用“立即更新”，结算后可以手动刷新；
返回大厅也不会自动刷新。后续再次发布会再次提示，回滚到页面原版本会清除过期提示。

第一次从旧版切换时，旧页面仍执行旧版自动刷新逻辑，载入本版本后才适用上述行为。
保留页面不意味着已经执行新版 JS；模块在手动刷新后才替换。
