# Linode 快速部署指南 (更新版)

## 🚀 快速开始

### ⭐ 推荐方式：使用全新的部署脚本 v2.0

**已修复所有已知问题，包括 SSL 配置问题**

```bash
# === 步骤 1：创建用户（如果还没有） ===
ssh root@your-linode-ip
adduser maliang
usermod -aG sudo maliang
su - maliang

# === 步骤 2：上传新部署脚本 ===
# (在本地机器执行)
scp scripts/deploy/deploy-v2.sh maliang@your-linode-ip:~/

# === 步骤 3：运行部署脚本 ===
ssh maliang@your-linode-ip
chmod +x deploy-v2.sh
./deploy-v2.sh

# === 步骤 4：按提示输入配置信息 ===
# - 域名
# - 数据库密码
# - Redis 密码
# - R2 配置
# - Gemini API Keys
# - 是否安装 SSL

# 脚本会自动完成所有配置！
```

**v2.0 脚本的改进：**
- ✅ 先配置 HTTP，再安装 SSL（避免证书错误）
- ✅ 完整的错误处理和日志记录
- ✅ 智能的环境检查
- ✅ 自动回滚功能
- ✅ 详细的部署信息显示

---

### 🗑️ 卸载指南

如果需要完全卸载之前的部署：

```bash
# === 上传卸载脚本 ===
scp scripts/deploy/uninstall.sh maliang@your-linode-ip:~/

# === 运行卸载脚本 ===
ssh maliang@your-linode-ip
chmod +x uninstall.sh
./uninstall.sh

# === 确认卸载 ===
# 输入 'YES' 确认卸载所有内容
```

**卸载脚本会：**
- 🛑 停止应用进程
- 🗑️ 删除应用代码
- ⚙️ 删除 Nginx 配置
- 💾 可选：删除数据库
- 📦 可选：卸载软件包
- 💾 自动备份配置文件到 `~/.maliang-backup/`

---

## 📝 部署前准备

### 服务器要求

| 配置 | 推荐值 | 最低要求 |
|------|--------|----------|
| **CPU** | 2 核心或以上 | 1 核心 |
| **内存** | 4GB RAM | 2GB RAM |
| **存储** | 80GB SSD | 40GB SSD |
| **系统** | Ubuntu 22.04 LTS | Ubuntu 20.04+ |

### 需要准备的信息

- ✅ 域名（已解析到服务器 IP）
- ✅ Cloudflare R2 配置信息
- ✅ Gemini API Keys（至少 1 个）
- ✅ 数据库密码（或自动生成）

---

## 🔧 快速修复当前 SSL 问题

如果您现在遇到 Nginx SSL 配置错误，使用以下命令快速修复：

```bash
# === 一键修复（复制粘贴） ===
sudo rm -f /etc/nginx/sites-enabled/maliang

sudo tee /etc/nginx/sites-available/maliang > /dev/null << 'EOF'
server {
    listen 80;
    server_name api.newpai.cn;
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/maliang /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# === 安装 SSL 证书 ===
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.newpai.cn --redirect
```

---

## 📊 脚本对比

| 特性 | setup-server.sh (旧版) | deploy-v2.sh (新版) |
|------|------------------------|-------------------|
| SSL 配置 | ❌ 有问题 | ✅ 先 HTTP 后 SSL |
| 错误处理 | ⚠️ 基础 | ✅ 完整 |
| 日志记录 | ❌ 无 | ✅ 详细日志 |
| 环境检查 | ⚠️ 简单 | ✅ 全面检查 |
| 回滚功能 | ❌ 无 | ✅ 自动回滚 |
| 配置验证 | ⚠️ 基础 | ✅ 详细验证 |

---

## 🎯 推荐使用流程

### 新部署（推荐）

```bash
# 1. 创建用户
ssh root@your-linode-ip
adduser maliang && usermod -aG sudo maliang

# 2. 上传并运行新脚本
# (在本地机器)
scp scripts/deploy/deploy-v2.sh maliang@your-linode-ip:~/

# 3. SSH 并部署
ssh maliang@your-linode-ip
chmod +x deploy-v2.sh
./deploy-v2.sh
```

### 从旧版本升级

```bash
# 1. 上传卸载脚本
scp scripts/deploy/uninstall.sh maliang@your-linode-ip:~/

# 2. 卸载旧部署
ssh maliang@your-linode-ip
chmod +x uninstall.sh
./uninstall.sh

# 3. 上传新部署脚本
# (在本地机器)
scp scripts/deploy/deploy-v2.sh maliang@your-linode-ip:~/

# 4. 运行新部署脚本
chmod +x deploy-v2.sh
./deploy-v2.sh
```

---

## 📚 完整文档索引

| 文档 | 说明 |
|------|------|
| **deploy-v2.sh** | ⭐ **推荐使用：完善的部署脚本** |
| **uninstall.sh** | 完全卸载脚本 |
| **LINODE_DEPLOYMENT.md** | 详细部署文档 |
| **QUICK_START.md** | 本文档：快速开始 |

---

## 🆘 常见问题

### Q: SSL 证书安装失败？
**A:** 确保域名已解析到服务器，并且 DNS 已生效（可能需要等待几分钟）

### Q: 数据库连接失败？
**A:** 检查密码是否正确，确认 PostgreSQL 正在运行：`sudo systemctl status postgresql`

### Q: Nginx 502 错误？
**A:** 确认应用正在运行：`pm2 status`

---

## 🎉 开始部署

**选择新部署脚本 v2.0，享受更稳定的部署体验！**

```bash
scp scripts/deploy/deploy-v2.sh maliang@your-linode-ip:~/
ssh maliang@your-linode-ip
chmod +x deploy-v2.sh
./deploy-v2.sh
```

---

**如有问题，请查看完整文档：`docs/LINODE_DEPLOYMENT.md`** 📖

---

### 方式 2：手动部署（推荐用于了解细节）

**完整控制，每步手动执行**

```bash
# 1. 创建 Linode 实例并连接
ssh root@your-linode-ip

# 2. 创建部署用户
adduser maliang
usermod -aG sudo maliang
su - maliang

# 3. 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql
# 在 psql 中执行：
CREATE DATABASE imagesaas;
CREATE USER maliang WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE imagesaas TO maliang;
\q

# 5. 安装 Redis
sudo apt install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 6. 安装 PM2 和 Nginx
sudo npm install -g pm2
sudo apt install -y nginx

# 7. 部署代码
cd ~
git clone your-repo-url maliang
cd maliang
npm install

# 8. 配置环境
cp .env.example .env.production
nano .env.production  # 编辑配置

# 9. 数据库迁移
npx prisma migrate deploy

# 10. 构建和启动
npm run build
pm2 start dist/server.js --name maliang-api
pm2 startup
pm2 save

# 11. 配置 Nginx
sudo nano /etc/nginx/sites-available/maliang
# 使用 docs/LINODE_DEPLOYMENT.md 中的配置

sudo ln -s /etc/nginx/sites-available/maliang /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 12. 安装 SSL
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com

# 13. 配置防火墙
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

### 方式 3：使用 Docker（最快速）

**容器化部署，一键启动**

```bash
# 1. 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker maliang

# 2. 重新登录
exit
ssh maliang@your-linode-ip

# 3. 部署代码
cd ~
git clone your-repo-url maliang
cd maliang

# 4. 使用 Docker Compose 启动
docker-compose up -d

# 5. 查看日志
docker-compose logs -f
```

---

## 📋 部署前检查清单

### 服务器要求
- [ ] Linode 实例：2 核 CPU，4GB RAM，80GB SSD
- [ ] 操作系统：Ubuntu 22.04 LTS
- [ ] 域名已解析到服务器 IP

### 配置信息准备
- [ ] 域名：`api.yourdomain.com`
- [ ] 数据库密码：强密码
- [ ] Redis 密码：强密码（可选）
- [ ] R2 配置：Account ID, Access Key, Secret Key
- [ ] Gemini API Keys：至少 1 个

### 代码准备
- [ ] 代码已推送到 Git 仓库
- [ ] `.env.production` 配置已准备
- [ ] 数据库迁移文件已测试

---

## 🔑 关键配置

### 1. 环境变量 (.env.production)

```env
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://maliang:PASSWORD@localhost:5432/imagesaas
REDIS_URL=redis://localhost:6379

R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=images
R2_PUBLIC_BASE_URL=https://cdn.yourdomain.com/

STORAGE_TYPE=r2
PUBLIC_BASE_URL=https://cdn.yourdomain.com

WEBHOOK_SIGNING_SECRET=random_32_char_string

GEMINI_API_KEY_1=your_key_1
GEMINI_API_KEY_2=your_key_2
```

### 2. Nginx 配置要点

```nginx
# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # 代理配置
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## ⚡ 快速测试

### 测试部署是否成功

```bash
# 1. 本地健康检查
curl http://localhost:3001/health

# 2. 通过域名测试
curl https://api.yourdomain.com/health

# 3. API 测试
curl -X POST https://api.yourdomain.com/v1/images/generate \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"test image"}'
```

---

## 🛠️ 常用管理命令

### 应用管理

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs maliang-api

# 重启应用
pm2 restart maliang-api

# 停止应用
pm2 stop maliang-api

# 监控
pm2 monit
```

### 日志管理

```bash
# 应用日志
tail -f ~/maliang/logs/pm2-combined.log

# Nginx 访问日志
sudo tail -f /var/log/nginx/maliang-access.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/maliang-error.log

# 系统日志
sudo journalctl -u nginx -f
```

### 数据库管理

```bash
# 连接数据库
psql -h localhost -U maliang -d imagesaas

# 备份数据库
pg_dump -U maliang imagesaas > backup.sql

# 恢复数据库
psql -U maliang imagesaas < backup.sql
```

---

## 🔄 更新部署

```bash
cd ~/maliang

# 拉取最新代码
git pull origin main

# 安装新依赖
npm install

# 运行迁移
npx prisma migrate deploy

# 重启应用
pm2 restart maliang-api
```

---

## 🔍 故障排查

### 应用无法启动

```bash
# 查看详细日志
pm2 logs maliang-api --lines 100

# 检查端口
sudo lsof -i :3001

# 检查环境变量
pm2 env 0
```

### 数据库连接失败

```bash
# 测试连接
psql -h localhost -U maliang -d imagesaas

# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 查看数据库日志
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

### Nginx 502 错误

```bash
# 检查应用是否运行
pm2 status

# 测试 Nginx 配置
sudo nginx -t

# 查看 Nginx 错误
sudo tail -f /var/log/nginx/maliang-error.log
```

---

## 📊 性能监控

### 安装监控工具

```bash
# 安装 htop
sudo apt install -y htop

# 实时监控
htop

# PM2 监控
pm2 monit
```

### 设置告警（可选）

```bash
# 安装 monit
sudo apt install -y monit

# 配置监控
sudo nano /etc/monit/monitrc
```

---

## 🔐 安全加固

### 必做安全措施

```bash
# 1. 禁用 root 登录
sudo nano /etc/ssh/sshd_config
# 修改: PermitRootLogin no

# 2. 修改 SSH 端口
sudo nano /etc/ssh/sshd_config
# 修改: Port 2222

# 3. 安装 fail2ban
sudo apt install -y fail2ban
sudo systemctl start fail2ban

# 4. 定期更新
sudo apt update && sudo apt upgrade -y
```

---

## 📱 监控和告警

### 设置日志轮转

```bash
# PM2 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 系统监控脚本

```bash
# 创建监控脚本
nano ~/monitor.sh
```

```bash
#!/bin/bash
echo "=== 系统状态 ==="
echo "CPU: $(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1)%"
echo "内存: $(free -h | awk '/^Mem:/{print $3 "/" $2}')"
echo "磁盘: $(df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 ")"}')"
pm2 status
```

---

## 📞 获取帮助

- **详细文档**: `docs/LINODE_DEPLOYMENT.md`
- **API 文档**: `docs/API.md`
- **问题反馈**: GitHub Issues

---

**部署完成后请访问健康检查确认服务正常！** 🎉

`curl https://api.yourdomain.com/health`
