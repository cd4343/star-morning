# 星辰早晨 运维手册（Windows 服务器 + 宝塔 Nginx）

> 2026-06-11 完成 Python→Nginx 切换后固化。遇到问题先查本手册"排障"节。

## 一、日常状态（记住这一段就够）

- **Nginx（80/443）**：宝塔面板管理，开机自启，平时不用管
- **Node 后端（3001）**：服务器上保持一个 `start_backend_only.bat` 窗口开着
- **HTTPS**：Let's Encrypt 证书，宝塔自动续期（90 天周期）
- 平时不需要做任何事

## 二、三种场景的操作

### 服务器重启后
双击 `scripts\start_backend_only.bat`，完。
（Nginx 宝塔自启；想连这步都省，用任务计划程序把该 bat 设为开机启动）

### 更新代码版本
1. 覆盖文件到项目根目录
2. 跑 `scripts\setup_server_production.bat`（JWT secret 提示处粘贴
   production_env.local.bat 里现有值；它会装依赖+编译后端+构建前端）
3. 双击 `start_backend_only.bat`
4. 不需要动 Nginx

### 修改了 Nginx 配置后
宝塔的"重启"按钮可能对旧进程无效（历史教训），用这套组合：
```
taskkill /f /im nginx.exe        ← PowerShell 执行
```
然后宝塔面板 → 网站 → 「Nginx」→ 启动。

## 三、验证命令（PowerShell）

```powershell
# 网站内容是否正确（出现 assets/index- 即正常；出现 Welcome to nginx 见排障①）
curl.exe -k -s https://127.0.0.1/ -H "Host: starcoin.h5-online.com" | findstr /i "assets nginx"

# 80/443 被谁占用
Get-NetTCPConnection -LocalPort 80,443 -State Listen | Select-Object LocalPort,OwningProcess,@{n='Path';e={(Get-Process -Id $_.OwningProcess).Path}}

# 后端是否存活
curl.exe -s http://127.0.0.1:3001/api/health
```

## 四、排障（按今天真实踩过的坑整理）

### ① 网站变成 "Welcome to nginx!"
**最可能原因：宝塔把默认首页写进了 `frontend/dist/index.html`**（它在
"添加站点/改根目录"时会往根目录塞默认页，覆盖 Vite 构建产物）。
特征：访问任何路径（包括 /favicon.ico）都返回同一个 ~640 字节页面。
修复：
```
cd <项目根>\frontend
npm run build
```
不需要重启任何东西。**凡在宝塔里动过站点根目录设置，之后必须重跑一次 build。**

### ② 改了 Nginx 配置不生效 / reload 报 Access is denied
运行中的 nginx 是旧进程，拒收重载信号；且宝塔守护会秒级复活被杀的
nginx（带着旧配置）。用"二.修改了Nginx配置后"的杀+面板启动组合。

### ③ 80 端口被抢
本机装有 phpstudy（含另一个 nginx）。确保小皮面板里所有服务停止且
不自启。判断归属用"三"中第二条命令看 Path。

### ④ 手机上语音/定位不工作
必须 HTTPS。检查证书是否过期（宝塔站点设置→SSL），强制 HTTPS 是否开启。

### ⑤ 后端起不来：JWT_SECRET 报错
production_env.local.bat 丢失或未配置。重跑 setup 脚本生成（会要求
输入或自动生成 JWT_SECRET；换新密钥=全家重新登录一次）。

## 五、安全注意

- 不要在宝塔创建根目录指向项目目录或其上级的站点（曾出现 default.com
  指向项目上级目录，等于把 stellar.db 暴露在公网）
- 站点根目录只能指向 `frontend/dist`
- 数据库 stellar.db 只存在于项目根目录，永远不进任何网站根目录、
  不进 git、不进增量包
