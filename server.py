#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地HTTP服务器
域名: http://starcoin.h5-online.com/
"""

import os
import sys
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
import threading

# 服务器配置
HOST = '0.0.0.0'  # 监听所有网络接口
PORT = 80         # 端口号（HTTP默认端口）
DOMAIN = 'starcoin.h5-online.com'

class CustomHTTPRequestHandler(SimpleHTTPRequestHandler):
    """自定义HTTP请求处理器"""
    
    def __init__(self, *args, **kwargs):
        import time
        self._request_start_time = time.time()
        # 优先使用 frontend/dist 目录（构建后的前端文件）
        dist_dir = os.path.join(os.getcwd(), 'frontend', 'dist')
        if os.path.exists(dist_dir):
            super().__init__(*args, directory=dist_dir, **kwargs)
        else:
            # 如果 dist 目录不存在，使用当前目录
            super().__init__(*args, directory=os.getcwd(), **kwargs)
    
    def send_error(self, code, message=None, explain=None):
        """
        重写 send_error 方法，正确处理中文字符编码
        默认的 send_error 使用 latin-1 编码，无法处理中文
        """
        import html
        
        try:
            short_msg, long_msg = self.responses.get(code, ('???', '???'))
        except AttributeError:
            short_msg, long_msg = '???', '???'
        
        if message is None:
            message = short_msg
        if explain is None:
            explain = long_msg
        
        self.log_error("code %d, message %s", code, message)
        
        # 使用 UTF-8 编码的错误页面
        error_content = f'''<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"
    "http://www.w3.org/TR/html4/strict.dtd">
<html>
    <head>
        <meta http-equiv="Content-Type" content="text/html;charset=utf-8">
        <title>Error response</title>
    </head>
    <body>
        <h1>Error response</h1>
        <p>Error code: {code}</p>
        <p>Message: {html.escape(message, quote=False)}</p>
        <p>Error code explanation: {code} - {html.escape(explain, quote=False)}</p>
    </body>
</html>'''
        
        # 使用 UTF-8 编码
        body = error_content.encode('utf-8', 'replace')
        
        # HTTP 状态行不能包含非 ASCII 字符，只发送状态码
        self.send_response(code)
        self.send_header("Content-Type", "text/html;charset=utf-8")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        
        if self.command != 'HEAD' and code >= 200 and code not in (204, 304):
            self.wfile.write(body)
    
    def do_GET(self):
        """处理GET请求"""
        import time
        self._request_start_time = time.time()
        
        # API 请求转发到后端服务器
        if self.path.startswith('/api/'):
            import urllib.request
            import http.client
            
            print(f"[请求] GET {self.path} - 开始处理")
            try:
                backend_url = f'http://localhost:3001{self.path}'
                req = urllib.request.Request(backend_url, headers=dict(self.headers))
                
                # 处理 304 Not Modified 响应
                # 添加超时设置，避免请求挂起（10秒超时）
                try:
                    response = urllib.request.urlopen(req, timeout=10)
                    status_code = response.getcode()
                    
                    # 如果是 304，直接返回 304，不读取响应体
                    if status_code == 304:
                        self.send_response(304)
                        for header, value in response.headers.items():
                            if header.lower() not in ['connection', 'transfer-encoding', 'content-length']:
                                self.send_header(header, value)
                        self.end_headers()
                        return
                    
                    # 其他状态码，正常处理
                    self.send_response(status_code)
                    for header, value in response.headers.items():
                        if header.lower() not in ['connection', 'transfer-encoding']:
                            self.send_header(header, value)
                    self.end_headers()
                    self.wfile.write(response.read())
                except urllib.error.HTTPError as e:
                    # 处理 HTTP 错误（包括 304）
                    if e.code == 304:
                        self.send_response(304)
                        for header, value in e.headers.items():
                            if header.lower() not in ['connection', 'transfer-encoding', 'content-length']:
                                self.send_header(header, value)
                        self.end_headers()
                    else:
                        self.send_response(e.code)
                        for header, value in e.headers.items():
                            if header.lower() not in ['connection', 'transfer-encoding']:
                                self.send_header(header, value)
                        self.end_headers()
                        self.wfile.write(e.read())
                except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
                    # 处理网络错误和超时
                    elapsed = time.time() - self._request_start_time
                    error_msg = str(e)
                    if 'timeout' in error_msg.lower() or isinstance(e, (socket.timeout, TimeoutError)):
                        print(f"[错误] GET {self.path} - 后端超时 ({elapsed:.3f}s)")
                        self.send_error(504, f"Backend timeout: Request to backend server timed out after 10 seconds")
                    else:
                        print(f"[错误] GET {self.path} - 连接错误: {error_msg} ({elapsed:.3f}s)")
                        self.send_error(502, f"Backend connection error: {error_msg}")
            except Exception as e:
                elapsed = time.time() - self._request_start_time
                error_msg = str(e)
                if 'timeout' in error_msg.lower():
                    print(f"[错误] GET {self.path} - 超时异常: {error_msg} ({elapsed:.3f}s)")
                    self.send_error(504, f"Backend timeout: {error_msg}")
                else:
                    print(f"[错误] GET {self.path} - 代理错误: {error_msg} ({elapsed:.3f}s)")
                    self.send_error(502, f"Backend proxy error: {error_msg}")
            else:
                elapsed = time.time() - self._request_start_time
                print(f"[成功] GET {self.path} - 完成 ({elapsed:.3f}s)")
            return
        
        # 检查是否是静态资源请求（JS、CSS、图片等）
        static_extensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot']
        is_static_resource = any(self.path.lower().endswith(ext) for ext in static_extensions) or self.path.startswith('/assets/')
        
        # 标记为静态资源请求，以便在 end_headers 中添加缓存头
        self._is_static_resource = is_static_resource
        
        # 如果是静态资源，尝试返回文件
        if is_static_resource:
            return super().do_GET()
        
        # 对于所有其他路径（SPA 路由），返回 index.html
        # 这样 React Router 可以在客户端处理路由
        self.path = '/index.html'
        return super().do_GET()
    
    def do_POST(self):
        """处理POST请求 - 转发到后端API"""
        import time
        self._request_start_time = time.time()
        
        # API 请求转发到后端服务器
        if self.path.startswith('/api/'):
            import urllib.request
            import json
            
            print(f"[请求] POST {self.path} - 开始处理")
            try:
                # 读取请求体
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length) if content_length > 0 else b''
                
                # 转发到后端
                backend_url = f'http://localhost:3001{self.path}'
                req = urllib.request.Request(backend_url, data=post_data, headers=dict(self.headers))
                req.add_header('Content-Type', self.headers.get('Content-Type', 'application/json'))
                
                # 添加超时设置（10秒）
                with urllib.request.urlopen(req, timeout=10) as response:
                    self.send_response(response.getcode())
                    for header, value in response.headers.items():
                        if header.lower() not in ['connection', 'transfer-encoding']:
                            self.send_header(header, value)
                    self.end_headers()
                    self.wfile.write(response.read())
            except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
                elapsed = time.time() - self._request_start_time
                error_msg = str(e)
                if 'timeout' in error_msg.lower() or isinstance(e, (socket.timeout, TimeoutError)):
                    print(f"[错误] POST {self.path} - 后端超时 ({elapsed:.3f}s)")
                    self.send_error(504, f"Backend timeout: Request timed out after 10 seconds")
                else:
                    print(f"[错误] POST {self.path} - 连接错误: {error_msg} ({elapsed:.3f}s)")
                    self.send_error(502, f"Backend connection error: {error_msg}")
            except Exception as e:
                elapsed = time.time() - self._request_start_time
                error_msg = str(e)
                if 'timeout' in error_msg.lower():
                    print(f"[错误] POST {self.path} - 超时异常: {error_msg} ({elapsed:.3f}s)")
                    self.send_error(504, f"Backend timeout: {error_msg}")
                else:
                    print(f"[错误] POST {self.path} - 代理错误: {error_msg} ({elapsed:.3f}s)")
                    self.send_error(502, f"Backend proxy error: {error_msg}")
            else:
                elapsed = time.time() - self._request_start_time
                print(f"[成功] POST {self.path} - 完成 ({elapsed:.3f}s)")
        else:
            self.send_error(404, "Not Found")
    
    def do_PUT(self):
        """处理PUT请求 - 转发到后端API"""
        self.do_POST()  # 使用相同的处理逻辑
    
    def do_DELETE(self):
        """处理DELETE请求 - 转发到后端API"""
        import time
        self._request_start_time = time.time()
        
        if self.path.startswith('/api/'):
            import urllib.request
            
            print(f"[请求] DELETE {self.path} - 开始处理")
            try:
                backend_url = f'http://localhost:3001{self.path}'
                req = urllib.request.Request(backend_url, method='DELETE', headers=dict(self.headers))
                
                # 添加超时设置（10秒）
                with urllib.request.urlopen(req, timeout=10) as response:
                    self.send_response(response.getcode())
                    for header, value in response.headers.items():
                        if header.lower() not in ['connection', 'transfer-encoding']:
                            self.send_header(header, value)
                    self.end_headers()
                    self.wfile.write(response.read())
            except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
                error_msg = str(e)
                if 'timeout' in error_msg.lower() or isinstance(e, (socket.timeout, TimeoutError)):
                    self.send_error(504, f"Backend timeout: Request timed out after 10 seconds")
                else:
                    self.send_error(502, f"Backend connection error: {error_msg}")
            except Exception as e:
                error_msg = str(e)
                if 'timeout' in error_msg.lower():
                    self.send_error(504, f"Backend timeout: {error_msg}")
                else:
                    self.send_error(502, f"Backend proxy error: {error_msg}")
        else:
            self.send_error(404, "Not Found")
    
    def end_headers(self):
        """添加CORS头和缓存控制"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        
        # 静态资源缓存策略
        if hasattr(self, '_is_static_resource') and self._is_static_resource:
            # JS/CSS 带哈希的文件可以长期缓存（1年）
            if '/assets/' in self.path:
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            else:
                # 其他静态资源缓存 1 天
                self.send_header('Cache-Control', 'public, max-age=86400')
        elif self.path == '/index.html' or self.path == '/':
            # HTML 文件不缓存，确保更新时能获取最新版本
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        
        super().end_headers()
    
    def do_OPTIONS(self):
        """处理OPTIONS预检请求"""
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        """自定义日志输出"""
        import time
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
        print(f"[{timestamp}] {format % args}")
    
    def log_request(self, code='-', size='-'):
        """记录请求详情，包括处理时间"""
        import time
        if not hasattr(self, '_request_start_time'):
            self._request_start_time = time.time()
        
        elapsed = time.time() - self._request_start_time if hasattr(self, '_request_start_time') else 0
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
        
        print(f"[{timestamp}] {self.address_string()} - \"{self.requestline}\" {code} {size} ({elapsed:.3f}s)")
        
        # 如果处理时间超过5秒，记录警告
        if elapsed > 5:
            print(f"[警告] 请求处理时间过长: {elapsed:.3f}秒 - {self.path}")

def check_port_available(port):
    """检查端口是否可用"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('127.0.0.1', port))
        sock.close()
        return True
    except OSError:
        return False

def main():
    """主函数"""
    print("=" * 50)
    print("Python HTTP 服务器")
    print("=" * 50)
    print(f"域名: http://{DOMAIN}/")
    print(f"监听地址: {HOST}:{PORT}")
    print("=" * 50)
    print()
    
    # 检查端口是否被占用
    if not check_port_available(PORT):
        print(f"[错误] 端口 {PORT} 已被占用！")
        print(f"请关闭占用该端口的程序，或修改server.py中的PORT配置")
        print(f"[提示] 使用80端口需要管理员权限，请以管理员身份运行！")
        sys.exit(1)
    
    # 检查构建后的前端文件
    dist_dir = os.path.join(os.getcwd(), 'frontend', 'dist')
    index_path = os.path.join(dist_dir, 'index.html')
    
    if not os.path.exists(index_path):
        print("[警告] 未找到构建后的前端文件！")
        print(f"[信息] 期望路径: {index_path}")
        print("[提示] 请先运行 'npm run build' 在 frontend 目录中构建前端应用")
        print()
        
        # 检查是否有旧的 index.html
        old_index = os.path.join(os.getcwd(), 'index.html')
        if os.path.exists(old_index):
            print("[信息] 找到旧的 index.html，但这不是构建后的文件")
            print("[建议] 请使用 start_app_production.bat 自动构建")
        print()
    
    # 创建多线程服务器（支持并发处理）
    try:
        server = ThreadingHTTPServer((HOST, PORT), CustomHTTPRequestHandler)
        print(f"[成功] 服务器已启动")
        print(f"[信息] 访问地址: http://localhost/")
        print(f"[信息] 或访问: http://{DOMAIN}/")
        print()
        print("[提示] 如需使用域名访问，请在hosts文件中添加:")
        print(f"       127.0.0.1    {DOMAIN}")
        print()
        print("按 Ctrl+C 停止服务器")
        print("=" * 50)
        print()
        
        # 启动服务器
        server.serve_forever()
        
    except KeyboardInterrupt:
        print()
        print("[信息] 服务器已停止")
        server.shutdown()
        sys.exit(0)
    except PermissionError:
        print(f"[错误] 权限不足！使用80端口需要管理员权限")
        print(f"[提示] 请以管理员身份运行此程序")
        sys.exit(1)
    except Exception as e:
        print(f"[错误] 服务器启动失败: {e}")
        if PORT == 80:
            print(f"[提示] 使用80端口需要管理员权限，请以管理员身份运行！")
        sys.exit(1)

if __name__ == '__main__':
    main()

