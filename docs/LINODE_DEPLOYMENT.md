# Linode Ubuntu 服务器部署指南

## 📋 目录

1. [服务器准备](#服务器准备)
2. [环境安装](#环境安装)
3. [代码部署](#代码部署)
4. [数据库配置](#数据库配置)
5. [应用配置](#应用配置)
6. [进程管理](#进程管理)
7. [反向代理](#反向代理)
8. [SSL 证书](#ssl-证书)
9. [安全配置](#安全配置)
10. [监控和日志](#监控和日志)

---

## 服务器准备

### 1. 创建 Linode 实例

**推荐配置：**
- **CPU**: 2 核心或以上
- **内存**: 4GB RAM 或以上
- **存储**: 80GB SSD
- **操作系统**: Ubuntu 22.04 LTS
- **位置**: 选择离用户最近的数据中心

### 2. 初始化服务器

登录到服务器：

```bash
# SSH 连接（替换 IP 和 root 密码）
ssh root@your-linode-ip

# 更新系统
apt update && apt upgrade -y

# 设置时区（可选）
timedatectl set-timezone Asia/Shanghai

# 创建部署用户（推荐）
adduser maliang
usermod -aG sudo maliang

# 切换到部署用户
su - maliang
```

---

## 环境安装

### 1. 安装 Node.js 20.x

```bash
# 使用 NodeSource 仓库安装
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v  # 应该是 v20.x.x
npm -v
```

### 2. 安装 PostgreSQL 15

```bash
# 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 创建数据库和用户
sudo -u postgres psql

# 在 psql 中执行：
CREATE DATABASE imagesaas;
CREATE USER maliang WITH ENCRYPTED PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE imagesaas TO maliang;
\q

# 测试连接
psql -h localhost -U maliang -d imagesaas
```

### 3. 安装 Redis

```bash
# 安装 Redis
sudo apt install -y redis-server

# 配置 Redis（可选，设置密码）
sudo nano /etc/redis/redis.conf

# 找到并修改以下行：
# requirepass your_redis_password

# 重启 Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# 测试 Redis
redis-cli ping  # 应该返回 PONG
```

### 4. 安装 PM2（进程管理）

```bash
sudo npm install -g pm2

# 验证
pm2 -v
```

### 5. 安装 Nginx（反向代理）

```bash
sudo apt install -y nginx

# 启动服务
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 代码部署

### 方案 1：使用 Git（推荐）

```bash
# 安装 Git
sudo apt install -y git

# 克隆代码
cd ~
git clone https://your-repo-url.git maliang
cd maliang

# 或如果代码在本地，使用 scp/rsync 上传
# 在本地执行：
# rsync -avz ./ maliang@your-linode-ip:~/maliang/
```

### 方案 2：使用 SCP/Rsync

```bash
# 在本地机器执行
cd /Users/joe/Apps/maliang

# 排除不必要的文件
rsync -avz --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '*.log' \
  --exclude '.env' \
  ./ maliang@your-linode-ip:~/maliang/
```

---

## 数据库配置

```bash
cd ~/maliang

# 安装依赖
npm install

# 生成 Prisma Client
npx prisma generate

# 运行数据库迁移
npx prisma migrate deploy

# 或使用开发环境迁移
npx prisma migrate dev

# 初始化数据（创建测试租户等）
npm run init
```

---

## 应用配置

### 1. 创建生产环境配置

```bash
# 复制示例配置
cp .env.example .env.production

# 编辑生产环境配置
nano .env.production
```

**生产环境配置示例：**

```env
# 环境
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://maliang:your_strong_password@localhost:5432/imagesaas

# Redis
REDIS_URL=redis://localhost:6379
# 如果设置了 Redis 密码
# REDIS_URL=redis://:your_redis_password@localhost:6379

# Object Storage (Cloudflare R2)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=images
R2_PUBLIC_BASE_URL=https://cdn.yourdomain.com/

# Storage Configuration
STORAGE_TYPE=r2
PUBLIC_BASE_URL=https://cdn.yourdomain.com

# Webhook signing
WEBHOOK_SIGNING_SECRET=generate_a_strong_random_secret_here

# Gemini/Nano Banana API
GEMINI_API_KEY_1=your_gemini_api_key
GEMINI_API_KEY_2=your_second_gemini_api_key
GEMINI_MODEL=gemini-3.0-pro-vision

# Rate limits
GLOBAL_RPM_LIMIT=1000
GLOBAL_CONCURRENCY_LIMIT=200

# Worker concurrency
WORKER_CONCURRENCY=50
```

### 2. 生成密钥

```bash
# 生成 webhook secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 进程管理

### 使用 PM2 管理应用

```bash
cd ~/maliang

# 构建 TypeScript（如果需要）
npm run build

# 启动应用
pm2 start dist/server.js --name maliang-api --env production

# 或者直接使用 ts-node
pm2 start src/server.ts --name maliang-api --interpreter ts-node

# 查看状态
pm2 status

# 查看日志
pm2 logs maliang-api

# 查看详细信息
pm2 show maliang-api

# 设置开机自启
pm2 startup
pm2 save
```

### PM2 配置文件（可选）

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'maliang-api',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    max_memory_restart: '1G',
    autorestart: true,
    watch: false
  }]
};
```

使用配置文件启动：

```bash
pm2 start ecosystem.config.js
```

---

## 反向代理

### 配置 Nginx

```bash
# 创建 Nginx 配置
sudo nano /etc/nginx/sites-available/maliang
```

**Nginx 配置内容：**

```nginx
# HTTP 配置（重定向到 HTTPS）
server {
    listen 80;
    listen [::]:80;
    server_name api.yourdomain.com;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # 其他请求重定向到 HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.yourdomain.com;

    # SSL 证书配置（稍后配置）
    # ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # SSL 优化配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 日志
    access_log /var/log/nginx/maliang-access.log;
    error_log /var/log/nginx/maliang-error.log;

    # 客户端上传大小限制
    client_max_body_size 10M;

    # 代理到 Node.js 应用
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;

        # WebSocket 支持（如果需要）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # 缓存控制（API 不缓存）
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # 健康检查端点（无需代理）
    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
}
```

启用配置：

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/maliang /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx
```

---

## SSL 证书

### 使用 Let's Encrypt 免费 SSL

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书（自动配置 Nginx）
sudo certbot --nginx -d api.yourdomain.com

# 测试自动续期
sudo certbot renew --dry-run
```

Certbot 会自动修改 Nginx 配置，添加 SSL 证书。

**手动配置（如果自动配置失败）：**

在 Nginx 配置中取消注释 SSL 证书行：

```nginx
ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
```

---

## 安全配置

### 1. 配置防火墙（UFW）

```bash
# 启用 UFW
sudo ufw enable

# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 查看状态
sudo ufw status
```

### 2. 限制 SSH 访问

```bash
# 编辑 SSH 配置
sudo nano /etc/ssh/sshd_config

# 修改以下配置：
# Port 22                    # 可以改为其他端口
# PermitRootLogin no         # 禁止 root 登录
# PasswordAuthentication no  # 禁用密码登录（仅允许密钥）
# PubkeyAuthentication yes   # 允许密钥登录

# 重启 SSH
sudo systemctl restart sshd
```

### 3. 设置 fail2ban（防止暴力攻击）

```bash
# 安装 fail2ban
sudo apt install -y fail2ban

# 创建本地配置
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local

# 启动服务
sudo systemctl start fail2ban
sudo systemctl enable fail2ban
```

---

## 监控和日志

### 1. 日志管理

```bash
# 创建日志目录
mkdir -p ~/maliang/logs

# PM2 日志轮转配置
pm2 install pm2-logrotate

# 配置日志轮转
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 2. 监控脚本

创建监控脚本 `monitor.sh`：

```bash
#!/bin/bash
# 监控脚本

echo "=== Maliang API 监控 ==="
echo ""

# 检查 PM2 状态
echo "PM2 状态："
pm2 status
echo ""

# 检查磁盘空间
echo "磁盘使用："
df -h | grep -E "Filesystem|/$"
echo ""

# 检查内存使用
echo "内存使用："
free -h
echo ""

# 检查最近的错误日志
echo "最近错误（最近 10 行）："
pm2 logs maliang-api --err --lines 10 --nostream
```

设置定时监控：

```bash
# 添加到 crontab
crontab -e

# 每小时检查一次
0 * * * * /home/maliang/maliang/monitor.sh >> /home/maliang/maliang/logs/monitor.log 2>&1
```

### 3. 性能监控（可选）

```bash
# 安装 htop
sudo apt install -y htop

# 实时监控
htop

# 或使用内置工具
pm2 monit
```

---

## 部署检查清单

### 部署前

- [ ] Linode 实例已创建
- [ ] 域名已解析到服务器 IP
- [ ] PostgreSQL 已安装并配置
- [ ] Redis 已安装并运行
- [ ] 代码已上传到服务器

### 配置

- [ ] `.env.production` 已配置
- [ ] 数据库迁移已执行
- [ ] Provider Keys 已配置
- [ ] R2 存储已配置
- [ ] Nginx 已配置并测试
- [ ] SSL 证书已安装

### 安全

- [ ] UFW 防火墙已启用
- [ ] SSH root 登录已禁用
- [ ] fail2ban 已安装
- [ ] 数据库密码足够强

### 运行

- [ ] PM2 应用已启动
- [ ] PM2 开机自启已配置
- [ ] 健康检查接口正常
- [ ] 日志正常记录

---

## 部署命令总结

```bash
# 1. 连接服务器
ssh maliang@your-linode-ip

# 2. 更新系统
sudo apt update && sudo apt upgrade -y

# 3. 安装依赖
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql postgresql-contrib redis-server nginx
sudo npm install -g pm2

# 4. 配置数据库
sudo -u postgres psql
# 在 psql 中执行数据库创建命令

# 5. 部署代码
cd ~
git clone your-repo-url maliang
cd maliang
npm install
npx prisma migrate deploy
cp .env.example .env.production
nano .env.production  # 编辑配置

# 6. 启动应用
npm run build
pm2 start dist/server.js --name maliang-api
pm2 startup
pm2 save

# 7. 配置 Nginx
sudo nano /etc/nginx/sites-available/maliang
sudo ln -s /etc/nginx/sites-available/maliang /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 8. 安装 SSL
sudo certbot --nginx -d api.yourdomain.com

# 9. 配置防火墙
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 10. 测试
curl https://api.yourdomain.com/health
```

---

## 故障排查

### 应用无法启动

```bash
# 查看 PM2 日志
pm2 logs maliang-api --lines 100

# 检查端口占用
sudo lsof -i :3001

# 检查环境变量
pm2 env 0
```

### 数据库连接失败

```bash
# 测试数据库连接
psql -h localhost -U maliang -d imagesaas

# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 查看 PostgreSQL 日志
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

### Nginx 502 错误

```bash
# 检查应用是否运行
pm2 status

# 检查 Nginx 配置
sudo nginx -t

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/maliang-error.log
```

### Redis 连接失败

```bash
# 测试 Redis
redis-cli ping

# 检查 Redis 状态
sudo systemctl status redis-server

# 查看 Redis 日志
sudo tail -f /var/log/redis/redis-server.log
```

---

## 更新部署

```bash
cd ~/maliang

# 拉取最新代码
git pull origin main

# 安装新依赖
npm install

# 运行数据库迁移
npx prisma migrate deploy

# 重启应用
pm2 restart maliang-api

# 或使用零停机更新
pm2 reload maliang-api
```

---

## 备份策略

### 数据库备份

```bash
# 创建备份脚本
nano ~/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/home/maliang/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="imagesaas_$DATE.sql.gz"

mkdir -p $BACKUP_DIR

pg_dump -U maliang imagesaas | gzip > $BACKUP_DIR/$FILENAME

# 保留最近 7 天的备份
find $BACKUP_DIR -name "imagesaas_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $FILENAME"
```

设置定时备份：

```bash
chmod +x ~/backup-db.sh
crontab -e

# 每天凌晨 2 点备份
0 2 * * * /home/maliang/backup-db.sh
```

---

## 性能优化建议

1. **使用多进程**: 修改 PM2 配置使用多个实例
2. **启用 Gzip**: 在 Nginx 中启用 gzip 压缩
3. **配置缓存**: 对静态资源配置缓存策略
4. **数据库索引**: 为常用查询字段添加索引
5. **连接池**: 优化数据库和 Redis 连接池配置

---

## 联系与支持

- 技术文档：项目 README.md
- 问题反馈：GitHub Issues
- 日志位置：`~/maliang/logs/`

**部署完成后，请访问健康检查接口确认服务正常！** 🚀
