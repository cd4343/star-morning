# Nginx 部署包（Windows）

用 Nginx 取代现行的 `python scripts/server.py`（80 端口）。后端 Node(3001) 不变。
本目录是**独立配置包**：不执行下面的切换步骤，对现行部署零影响。

## 1. 下载与安装

1. 打开 <https://nginx.org/en/download.html>，下载 *Mainline* 或 *Stable* 的 Windows zip（如 `nginx-1.27.x.zip`）。
2. 解压到一个**无中文、无空格**的目录，例如 `C:\nginx`。
3. 把本目录的 `nginx.conf` 覆盖到 `C:\nginx\conf\nginx.conf`（原文件可先改名为 `nginx.conf.bak`）。

## 2. 替换路径（必做）

编辑 `C:\nginx\conf\nginx.conf`，找到：

```nginx
root   C:/path/to/starcoin/frontend/dist;
```

改成本机项目的前端构建目录，**Windows 路径用正斜杠**，例如：

```nginx
root   D:/work/starcoin/frontend/dist;
```

改完先验证语法（在 `C:\nginx` 目录下）：

```bat
nginx -t
```

## 3. 启动 / 停止 / 重载

在 `C:\nginx` 目录下执行（管理员命令行）：

```bat
start nginx              :: 启动（后台运行，不占用窗口）
nginx -s reload          :: 改配置后平滑重载
nginx -s quit            :: 优雅停止（处理完现有请求）
nginx -s stop            :: 立即停止
tasklist /fi "imagename eq nginx.exe"   :: 查看是否在运行
```

注意：80 端口被占用会启动失败。先停掉 python 服务器（见下一节），或用
`netstat -ano | findstr :80` 找到占用进程。

## 4. 切换步骤（从 python 服务器迁移）

### 4.1 后端开启代理信任（必做）

经过 Nginx 后，后端看到的请求 IP 是 127.0.0.1，限流会把所有用户算到一个 IP 上。
编辑 `scripts\production_env.local.bat`，加一行：

```bat
set "TRUST_PROXY=1"
```

后端已支持该变量（server.ts 会执行 `app.set('trust proxy', 1)`，配合 Nginx 传的
`X-Real-IP` / `X-Forwarded-For` 恢复真实 IP）。

### 4.2 让 start_server_simple.bat 只启动后端

编辑 `scripts\start_server_simple.bat`，把 python 相关两处用 `REM` 注释掉：

1. `scripts\server.py` 的存在性检查（约第 46-50 行）：

```bat
REM if not exist "scripts\server.py" (
REM     echo [ERROR] scripts\server.py not found.
REM     pause
REM     exit /b 1
REM )
```

2. 文件末尾真正启动 python 的一行：

```bat
REM python scripts\server.py
```

这样脚本仍负责：加载环境变量、清理 80/3001 端口旧进程、启动后端并等待就绪。
（脚本会清理 80 端口进程，所以**先跑它再 `start nginx`**；或把清理端口的
`for %%P in (80 %PORT%)` 改为 `for %%P in (%PORT%)` 避免误杀 Nginx。）

### 4.3 切换顺序

1. `nginx -t` 验证配置。
2. 运行修改后的 `start_server_simple.bat`（只启动后端）。
3. `start nginx`。
4. 验证：浏览器开 `http://localhost/` 能进页面；登录后看
   `http://localhost/api/...` 请求正常；上传一张探索照片验证 `client_max_body_size`。

## 5. 回滚方法

1. `nginx -s stop` 停掉 Nginx。
2. 还原 `scripts\start_server_simple.bat` 里被 `REM` 注释的两处（或 `git checkout -- scripts/start_server_simple.bat`）。
3. （可选）从 `scripts\production_env.local.bat` 移除 `set "TRUST_PROXY=1"`——
   直连场景下保留它会让限流信任伪造的 X-Forwarded-For 头，建议移除。
4. 重新运行 `start_server_simple.bat`，回到 python 服务器方案。

## 6. 为什么换 Nginx

- python `http.server` 是单线程阻塞模型，静态文件 + 代理都排同一条队；
- Nginx 提供 gzip（文本约省 60-80% 流量）、`/assets/` 一年强缓存、并发连接复用；
- 移动端（Capacitor 上线目标）弱网下首屏收益明显。
