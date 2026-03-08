#!/bin/bash

# Maliang API 一键部署脚本
# 适用于 Ubuntu 22.04 LTS on Linode

set -e  # 遇到错误立即退出

echo "================================"
echo "  Maliang API 部署脚本"
echo "================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}请不要使用 root 用户运行此脚本${NC}"
    echo "请创建一个普通用户并使用 sudo 运行此脚本"
    exit 1
fi

# 检查是否为 Ubuntu
if [ ! -f /etc/os-release ]; then
    echo -e "${RED}无法检测操作系统版本${NC}"
    exit 1
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" ]]; then
    echo -e "${RED}此脚本仅支持 Ubuntu 系统${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 系统检查通过${NC}"
echo ""

# 询问配置信息
echo "请输入以下配置信息："
read -p "域名 (例如: api.yourdomain.com): " DOMAIN_NAME
read -sp "PostgreSQL 数据库密码: " DB_PASSWORD
echo ""
read -sp "Redis 密码 (留空则不设置): " REDIS_PASSWORD
echo ""

# 确认配置
echo ""
echo "配置信息确认："
echo "  域名: $DOMAIN_NAME"
echo "  数据库密码: ****"
echo "  Redis 密码: ${REDIS_PASSWORD:-未设置}"
echo ""
read -p "确认继续? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "部署已取消"
    exit 0
fi

echo ""
echo -e "${YELLOW}开始部署...${NC}"
echo ""

# 更新系统
echo "1. 更新系统..."
sudo apt update && sudo apt upgrade -y
echo -e "${GREEN}✓ 系统更新完成${NC}"
echo ""

# 安装 Node.js 20.x
echo "2. 安装 Node.js 20.x..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✓ Node.js $(node -v) 安装完成${NC}"
else
    echo -e "${GREEN}✓ Node.js $(node -v) 已安装${NC}"
fi
echo ""

# 安装 PostgreSQL
echo "3. 安装 PostgreSQL..."
if ! command -v psql &> /dev/null; then
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql

    # 创建数据库和用户
    echo "创建数据库和用户..."
    sudo -u postgres psql << EOF
CREATE DATABASE imagesaas;
CREATE USER maliang WITH ENCRYPTED PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE imagesaas TO maliang;
\c imagesaas
GRANT ALL ON SCHEMA public TO maliang;
EOF
    echo -e "${GREEN}✓ PostgreSQL 安装完成${NC}"
else
    echo -e "${GREEN}✓ PostgreSQL 已安装${NC}"
fi
echo ""

# 安装 Redis
echo "4. 安装 Redis..."
if ! command -v redis-server &> /dev/null; then
    sudo apt install -y redis-server

    # 设置 Redis 密码（如果提供）
    if [ -n "$REDIS_PASSWORD" ]; then
        sudo sed -i "s/# requirepass foobared/requirepass $REDIS_PASSWORD/" /etc/redis/redis.conf
    fi

    sudo systemctl restart redis-server
    sudo systemctl enable redis-server
    echo -e "${GREEN}✓ Redis 安装完成${NC}"
else
    echo -e "${GREEN}✓ Redis 已安装${NC}"
fi
echo ""

# 安装 PM2
echo "5. 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✓ PM2 安装完成${NC}"
else
    echo -e "${GREEN}✓ PM2 已安装${NC}"
fi
echo ""

# 安装 Nginx
echo "6. 安装 Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx

    # 配置 Nginx（先配置 HTTP，稍后安装 SSL）
    echo "配置 Nginx（HTTP 模式）..."
    sudo tee /etc/nginx/sites-available/maliang > /dev/null << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN_NAME;

    access_log /var/log/nginx/maliang-access.log;
    error_log /var/log/nginx/maliang-error.log;

    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
}
EOF

    sudo ln -sf /etc/nginx/sites-available/maliang /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl reload nginx
    echo -e "${GREEN}✓ Nginx 安装并配置完成${NC}"
else
    echo -e "${GREEN}✓ Nginx 已安装${NC}"
fi
echo ""

# 配置防火墙
echo "7. 配置防火墙..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
echo -e "${GREEN}✓ 防火墙配置完成${NC}"
echo ""

# 创建应用目录
echo "8. 准备应用目录..."
cd ~
if [ ! -d "maliang" ]; then
    echo "请将代码上传到 ~/maliang 目录"
    echo "可以使用以下命令："
    echo "  git clone <your-repo-url> maliang"
    echo "或"
    echo "  scp -r ./maliang maliang@$(hostname -I | awk '{print $1}'):~/"
    echo ""
    read -p "代码已上传? (y/n): " CODE_UPLOADED
    if [[ "$CODE_UPLOADED" != "y" && "$CODE_UPLOADED" != "Y" ]]; then
        echo "请上传代码后继续"
        exit 0
    fi
fi

cd maliang
echo -e "${GREEN}✓ 应用目录准备完成${NC}"
echo ""

# 安装依赖
echo "9. 安装应用依赖..."
if [ -f "package.json" ]; then
    npm install
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
else
    echo -e "${RED}未找到 package.json，请确保代码已正确上传${NC}"
    exit 1
fi
echo ""

# 创建 .env.production
echo "10. 创建环境配置..."
if [ ! -f ".env.production" ]; then
    cat > .env.production << EOF
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://maliang:$DB_PASSWORD@localhost:5432/imagesaas

# Redis
REDIS_URL=redis://${REDIS_PASSWORD:+:$REDIS_PASSWORD@}localhost:6379

# Object Storage (R2)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=images
R2_PUBLIC_BASE_URL=https://cdn.yourdomain.com/

STORAGE_TYPE=r2
PUBLIC_BASE_URL=https://cdn.yourdomain.com

WEBHOOK_SIGNING_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

GEMINI_API_KEY_1=your_gemini_api_key
GEMINI_API_KEY_2=your_second_gemini_api_key
GEMINI_MODEL=gemini-3.0-pro-vision

GLOBAL_RPM_LIMIT=1000
GLOBAL_CONCURRENCY_LIMIT=200
WORKER_CONCURRENCY=50
EOF

    echo "已创建 .env.production，请编辑并填入正确的配置："
    echo "  nano .env.production"
    echo ""
    read -p "配置已更新? (y/n): " CONFIG_UPDATED
    if [[ "$CONFIG_UPDATED" != "y" && "$CONFIG_UPDATED" != "Y" ]]; then
        echo "请更新配置后继续"
        exit 0
    fi
fi
echo ""

# 运行数据库迁移
echo "11. 运行数据库迁移..."
npx prisma generate
npx prisma migrate deploy
echo -e "${GREEN}✓ 数据库迁移完成${NC}"
echo ""

# 构建应用
echo "12. 构建应用..."
npm run build
echo -e "${GREEN}✓ 应用构建完成${NC}"
echo ""

# 启动应用
echo "13. 启动应用..."
pm2 delete maliang-api 2>/dev/null || true
pm2 start dist/server.js --name maliang-api
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u maliang --hp /home/maliang
echo -e "${GREEN}✓ 应用启动完成${NC}"
echo ""

# 检查应用状态
echo "14. 检查应用状态..."
sleep 3
if pm2 status | grep -q "maliang-api.*online"; then
    echo -e "${GREEN}✓ 应用运行正常${NC}"
else
    echo -e "${RED}✗ 应用启动失败，请查看日志：${NC}"
    pm2 logs maliang-api --lines 20
    exit 1
fi
echo ""

# 安装 SSL 证书
echo "15. 安装 SSL 证书..."
read -p "是否安装 SSL 证书? (需要域名已解析到服务器) (y/n): " INSTALL_SSL
if [[ "$INSTALL_SSL" == "y" || "$INSTALL_SSL" == "Y" ]]; then
    echo "检查域名解析..."
    if nslookup $DOMAIN_NAME > /dev/null 2>&1; then
        sudo apt install -y certbot python3-certbot-nginx
        echo "安装 SSL 证书（这可能需要几分钟）..."
        sudo certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --email admin@$DOMAIN_NAME --redirect
        echo -e "${GREEN}✓ SSL 证书安装完成，HTTPS 已启用${NC}"
    else
        echo -e "${YELLOW}⚠️  域名 $DOMAIN_NAME 未解析到此服务器${NC}"
        echo "跳过 SSL 证书安装，可稍后手动安装："
        echo "  1. 确保域名已解析到服务器 IP"
        echo "  2. 运行: sudo certbot --nginx -d $DOMAIN_NAME"
    fi
else
    echo "跳过 SSL 证书安装，当前使用 HTTP 模式"
    echo "稍后可手动安装 SSL："
    echo "  sudo apt install -y certbot python3-certbot-nginx"
    echo "  sudo certbot --nginx -d $DOMAIN_NAME"
fi
echo ""

# 创建日志目录
echo "16. 配置日志..."
mkdir -p logs
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
echo -e "${GREEN}✓ 日志配置完成${NC}"
echo ""

# 完成
echo ""
echo "================================"
echo -e "${GREEN}部署完成！${NC}"
echo "================================"
echo ""
echo "应用信息："
echo "  域名: https://$DOMAIN_NAME"
echo "  健康检查: https://$DOMAIN_NAME/health"
echo "  API 文档: 查看 docs/API.md"
echo ""
echo "管理命令："
echo "  查看状态: pm2 status"
echo "  查看日志: pm2 logs maliang-api"
echo "  重启应用: pm2 restart maliang-api"
echo "  停止应用: pm2 stop maliang-api"
echo "  查看监控: pm2 monit"
echo ""
echo "测试命令："
echo "  curl https://$DOMAIN_NAME/health"
echo ""
