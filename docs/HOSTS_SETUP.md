# Hosts 文件配置说明

## 什么是 Hosts 文件？

Hosts 文件是操作系统用来将域名映射到 IP 地址的本地文件。通过修改 hosts 文件，可以让 `starcoin.h5-online.com` 指向本地服务器（127.0.0.1）。

## 为什么需要配置？

在生产服务器上，如果你想通过域名 `http://starcoin.h5-online.com/` 访问应用，而不是 `http://localhost/`，就需要在 hosts 文件中添加域名映射。

## 配置方法

### 方法1：使用自动脚本（推荐）

1. **以管理员身份运行** `scripts/setup_hosts.bat`
   - 右键点击 `scripts/setup_hosts.bat`
   - 选择"以管理员身份运行"

2. 脚本会自动：
   - 检查是否已有该域名条目
   - 添加或更新域名映射
   - 显示操作结果

### 方法2：手动编辑

1. **打开 hosts 文件**：
   - 路径：`C:\Windows\System32\drivers\etc\hosts`
   - 需要以管理员权限打开

2. **添加以下行**：
   ```
   127.0.0.1    starcoin.h5-online.com
   ```

3. **保存文件**

## 验证配置

配置完成后，可以通过以下方式验证：

1. **Ping 测试**：
   ```cmd
   ping starcoin.h5-online.com
   ```
   应该显示 `127.0.0.1`

2. **浏览器访问**：
   打开浏览器，访问 `http://starcoin.h5-online.com/`
   应该能正常访问应用

## 移除配置

如果需要移除域名映射：

1. **使用脚本**：
   - 运行 `scripts/setup_hosts.bat`
   - 选择移除现有条目

2. **手动移除**：
   - 编辑 hosts 文件
   - 删除包含 `starcoin.h5-online.com` 的行
   - 保存文件

## 注意事项

- ⚠️ **需要管理员权限**：修改 hosts 文件需要管理员权限
- ⚠️ **备份重要**：修改前建议备份 hosts 文件
- ⚠️ **DNS 缓存**：修改后可能需要清除 DNS 缓存或重启浏览器
- ⚠️ **仅本地有效**：此配置仅在本机有效，不会影响其他设备

## 清除 DNS 缓存

如果修改后无法立即生效，可以清除 DNS 缓存：

```cmd
ipconfig /flushdns
```

## 常见问题

**Q: 修改后仍然无法访问？**
A: 尝试清除 DNS 缓存或重启浏览器

**Q: 如何查看当前 hosts 文件内容？**
A: 在 CMD 中运行：`type C:\Windows\System32\drivers\etc\hosts`

**Q: 修改 hosts 文件安全吗？**
A: 是的，这是 Windows 的标准功能，只要不添加恶意域名就是安全的

