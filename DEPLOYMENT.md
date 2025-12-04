# 部署说明

## 生产服务器部署流程

### 1. 本地开发环境构建前端

在本地开发电脑上：

```bash
cd frontend
npm run build
```

构建完成后，会在 `frontend/dist` 目录生成生产版本的文件。

### 2. 将构建文件复制到生产服务器

将以下内容复制到生产服务器：

**必需文件/目录：**
- `frontend/dist/` - 整个目录（包含所有构建后的静态文件）
- `backend/` - 整个后端目录
- `server.py` - Python HTTP 服务器
- `start_app_production.bat` - 生产服务器启动脚本
- `stellar.db` - 数据库文件（如果已有数据）

**可选文件：**
- `README.md` - 项目说明
- `.gitignore` - Git 配置

### 3. 在生产服务器上启动

在生产服务器上：

1. 确保已安装：
   - Python 3.x
   - Node.js (用于运行后端)

2. 运行启动脚本：
   ```bash
   start_app_production.bat
   ```

3. 脚本会自动：
   - 检查环境（Python、Node.js）
   - 检查构建文件（`frontend/dist/index.html`）
   - 安装后端依赖（如果需要）
   - 启动后端服务器（端口 3001）
   - 启动前端静态服务器（端口 80）

### 4. 访问应用

- 前端：http://starcoin.h5-online.com/ 或 http://localhost/
- 后端 API：http://localhost:3001/api

## 注意事项

1. **端口 80 需要管理员权限**：确保以管理员身份运行启动脚本
2. **防火墙设置**：确保端口 80 和 3001 未被防火墙阻止
3. **数据库文件**：首次部署时，数据库会自动创建。如需保留数据，请备份 `stellar.db` 文件
4. **更新部署**：更新时只需替换 `frontend/dist` 目录和 `backend` 目录即可

## 快速部署命令（本地）

如果需要快速将构建文件打包：

```bash
# Windows PowerShell
Compress-Archive -Path frontend\dist -DestinationPath dist.zip
Compress-Archive -Path backend -DestinationPath backend.zip
```

然后将这些 zip 文件传输到服务器并解压。

