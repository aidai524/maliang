#!/bin/bash

################################################################################
# Maliang API 完整部署脚本 v2.0
# 适用于 Ubuntu 22.04 LTS on Linode
#
# 特性：
# - 完整的环境检查和依赖安装
# - 智能的 SSL 配置（先 HTTP，后 HTTPS）
# - 自动错误处理和回滚
# - 详细的日志记录
################################################################################

set -e  # 遇到错误立即退出

################################################################################
# 颜色和格式定义
################################################################################
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

################################################################################
# 日志函数
################################################################################
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${BLUE}===> $1${NC}"
}

################################################################################
# 错误处理
################################################################################
error_exit() {
    log_error "$1"
    echo ""
    log_info "查看日志: $LOG_FILE"
    exit 1
}

################################################################################
# 日志文件
################################################################################
LOG_FILE="/tmp/maliang-deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

################################################################################
# 打印横幅
################################################################################
print_banner() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║          Maliang API 自动部署脚本 v2.0                         ║"
    echo "║                                                                ║"
    echo "║  适用于 Ubuntu 22.04 LTS on Linode                             ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo -e "日志文件: ${YELLOW}$LOG_FILE${NC}"
    echo ""
}

################################################################################
# 检查系统要求
################################################################################
check_requirements() {
    log_step "检查系统要求..."

    # 检查是否为 root 用户
    if [ "$EUID" -eq 0 ]; then
        error_exit "请不要使用 root 用户运行此脚本。请创建一个普通用户并使用 sudo 运行。"
    fi

    # 检查 sudo 权限
    if ! sudo -n true 2>/dev/null; then
        error_exit "当前用户没有 sudo 权限。"
    fi

    # 检查操作系统
    if [ ! -f /etc/os-release ]; then
        error_exit "无法检测操作系统版本。"
    fi

    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        error_exit "此脚本仅支持 Ubuntu 系统。当前系统: $ID"
    fi

    local ubuntu_version=$(echo $VERSION_ID | cut -d. -f1)
    if [ "$ubuntu_version" -lt 22 ]; then
        log_warning "推荐使用 Ubuntu 22.04 LTS 或更高版本。当前版本: $VERSION_ID"
        read -p "是否继续? (y/n): " continue
        if [[ "$continue" != "y" && "$continue" != "Y" ]]; then
            exit 0
        fi
    fi

    log_success "系统检查通过: Ubuntu $VERSION_ID"
}

################################################################################
# 收集配置信息
################################################################################
collect_config() {
    log_step "收集配置信息..."

    echo ""
    echo "请输入以下配置信息："
    echo "（留空使用默认值）"
    echo ""

    # 域名
    read -p "域名 (例如: api.yourdomain.com): " domain_name
    domain_name=${domain_name:-"api.yourdomain.com"}

    # 数据库配置
    echo ""
    read -sp "PostgreSQL 数据库密码 (留空自动生成): " db_password
    echo ""
    if [ -z "$db_password" ]; then
        db_password=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
        log_info "已生成数据库密码: $db_password"
    fi

    # Redis 密码
    read -sp "Redis 密码 (留空则不设置): " redis_password
    echo ""

    # R2 配置
    echo ""
    read -p "Cloudflare R2 Account ID: " r2_account_id
    read -p "R2 Access Key ID: " r2_access_key
    read -sp "R2 Secret Access Key: " r2_secret_key
    echo ""
    read -p "R2 Bucket Name: " r2_bucket
    read -p "R2 Public URL (例如: https://cdn.yourdomain.com): " r2_public_url

    # Gemini API Keys
    echo ""
    read -p "Gemini API Key 1: " gemini_key_1
    read -p "Gemini API Key 2 (可选): " gemini_key_2

    # SSL 证书
    echo ""
    read -p "是否安装 SSL 证书? (需要域名已解析) (y/n): " install_ssl
    install_ssl=${install_ssl:-"n"}

    # 确认配置
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "配置信息确认："
    echo "═══════════════════════════════════════════════════════════════"
    echo "  域名: $domain_name"
    echo "  数据库密码: ****"
    echo "  Redis 密码: ${redis_password:+****}"
    echo "  安装 SSL: $install_ssl"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    read -p "确认配置并继续? (y/n): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_info "部署已取消"
        exit 0
    fi
}

################################################################################
# 更新系统
################################################################################
update_system() {
    log_step "更新系统包..."

    sudo apt update
    sudo apt upgrade -y

    log_success "系统更新完成"
}

################################################################################
# 安装 Node.js 20.x
################################################################################
install_nodejs() {
    log_step "安装 Node.js 20.x..."

    if command -v node &> /dev/null; then
        local node_version=$(node -v)
        log_info "Node.js 已安装: $node_version"

        # 检查版本是否满足要求
        local major_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$major_version" -ge 18 ]; then
            log_success "Node.js 版本满足要求"
            return
        fi
    fi

    # 安装 Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs

    log_success "Node.js $(node -v) 安装完成"
}

################################################################################
# 安装 PostgreSQL
################################################################################
install_postgresql() {
    log_step "安装 PostgreSQL 15..."

    if command -v psql &> /dev/null; then
        log_info "PostgreSQL 已安装"
        sudo systemctl start postgresql
        sudo systemctl enable postgresql
        return
    fi

    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql

    # 创建数据库和用户
    log_info "创建数据库和用户..."
    sudo -u postgres psql << EOF
SELECT 'CREATE DATABASE' as action;
CREATE DATABASE imagesaas;

SELECT 'CREATE USER' as action;
CREATE USER maliang WITH ENCRYPTED PASSWORD '$db_password';

SELECT 'GRANT PRIVILEGES' as action;
GRANT ALL PRIVILEGES ON DATABASE imagesaas TO maliang;
\c imagesaas
GRANT ALL ON SCHEMA public TO maliang;
EOF

    log_success "PostgreSQL 安装完成"
}

################################################################################
# 安装 Redis
################################################################################
install_redis() {
    log_step "安装 Redis..."

    if command -v redis-server &> /dev/null; then
        log_info "Redis 已安装"
        sudo systemctl start redis-server
        sudo systemctl enable redis-server
        return
    fi

    sudo apt install -y redis-server

    # 设置 Redis 密码（如果提供）
    if [ -n "$redis_password" ]; then
        sudo sed -i "s/# requirepass foobared/requirepass $redis_password/" /etc/redis/redis.conf
        log_info "已设置 Redis 密码"
    fi

    sudo systemctl restart redis-server
    sudo systemctl enable redis-server

    log_success "Redis 安装完成"
}

################################################################################
# 安装 PM2
################################################################################
install_pm2() {
    log_step "安装 PM2 进程管理器..."

    if command -v pm2 &> /dev/null; then
        log_info "PM2 已安装: $(pm2 -v)"
        return
    fi

    sudo npm install -g pm2

    log_success "PM2 $(pm2 -v) 安装完成"
}

################################################################################
# 安装 Nginx
################################################################################
install_nginx() {
    log_step "安装 Nginx..."

    if command -v nginx &> /dev/null; then
        log_info "Nginx 已安装"
        sudo systemctl stop nginx
    else
        sudo apt install -y nginx
    fi

    sudo systemctl enable nginx

    log_success "Nginx 安装完成"
}

################################################################################
# 部署应用代码
################################################################################
deploy_app() {
    log_step "准备应用目录..."

    # 创建应用目录
    mkdir -p ~/maliang
    mkdir -p ~/maliang/logs
    cd ~/maliang

    # 检查代码是否存在
    if [ -f "package.json" ]; then
        log_info "应用代码已存在"
        read -p "是否重新部署代码? (y/n): " redeploy_code
        if [[ "$redeploy_code" != "y" && "$redeploy_code" != "Y" ]]; then
            return
        fi
    fi

    log_warning "请确保代码已上传到 ~/maliang 目录"
    log_info "可以使用以下方法上传代码："
    echo "  方法 1: git clone <repo-url>"
    echo "  方法 2: scp -r ./maliang maliang@$(hostname -I | awk '{print $1}'):~/"
    echo ""

    read -p "代码已上传? (y/n): " code_uploaded
    if [[ "$code_uploaded" != "y" && "$code_uploaded" != "Y" ]]; then
        error_exit "请先上传代码后继续"
    fi

    cd ~/maliang
}

################################################################################
# 安装依赖
################################################################################
install_dependencies() {
    log_step "安装应用依赖..."

    cd ~/maliang

    if [ ! -f "package.json" ]; then
        error_exit "未找到 package.json，请确保代码已正确上传"
    fi

    npm install
    npx prisma generate

    log_success "依赖安装完成"
}

################################################################################
# 运行数据库迁移
################################################################################
run_migrations() {
    log_step "运行数据库迁移..."

    cd ~/maliang

    # 生成 Prisma Client
    npx prisma generate

    # 运行迁移
    npx prisma migrate deploy

    log_success "数据库迁移完成"
}

################################################################################
# 创建环境配置
################################################################################
create_env_config() {
    log_step "创建环境配置..."

    cd ~/maliang

    local webhook_secret=$(openssl rand -hex 32)

    cat > .env.production << EOF
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://maliang:${db_password}@localhost:5432/imagesaas

# Redis
if [ -n "$redis_password" ]; then
    echo "REDIS_URL=redis://:${redis_password}@localhost:6379" >> .env.production
else
    echo "REDIS_URL=redis://localhost:6379" >> .env.production
fi

# Object Storage (R2)
R2_ACCOUNT_ID=${r2_account_id}
R2_ACCESS_KEY_ID=${r2_access_key}
R2_SECRET_ACCESS_KEY=${r2_secret_key}
R2_BUCKET_NAME=${r2_bucket}
R2_PUBLIC_BASE_URL=${r2_public_url}

STORAGE_TYPE=r2
PUBLIC_BASE_URL=${r2_public_url}

WEBHOOK_SIGNING_SECRET=${webhook_secret}

# Gemini API
GEMINI_API_KEY_1=${gemini_key_1}
if [ -n "$gemini_key_2" ]; then
    echo "GEMINI_API_KEY_2=${gemini_key_2}" >> .env.production
fi
GEMINI_MODEL=gemini-3.0-pro-vision

# Rate limits
GLOBAL_RPM_LIMIT=1000
GLOBAL_CONCURRENCY_LIMIT=200
WORKER_CONCURRENCY=50
EOF

    chmod 600 .env.production

    log_success "环境配置已创建: .env.production"
}

################################################################################
# 构建应用
################################################################################
build_app() {
    log_step "构建应用..."

    cd ~/maliang

    npm run build

    log_success "应用构建完成"
}

################################################################################
# 启动应用
################################################################################
start_app() {
    log_step "启动应用..."

    cd ~/maliang

    # 停止旧进程（如果存在）
    pm2 delete maliang-api 2>/dev/null || true

    # 启动应用
    pm2 start dist/server.js --name maliang-api --env production

    # 保存 PM2 配置
    pm2 save

    # 配置开机自启
    pm2 startup systemd -u maliang --hp /home/maliang

    # 等待应用启动
    sleep 3

    # 检查状态
    if pm2 status | grep -q "maliang-api.*online"; then
        log_success "应用启动成功"
    else
        log_error "应用启动失败，查看日志:"
        pm2 logs maliang-api --lines 20 --nostream
        error_exit "应用启动失败"
    fi
}

################################################################################
# 配置 Nginx（HTTP 模式）
<arg_value>content</arg_key><arg_value>#!/bin/bash

################################################################################
# Maliang API 卸载脚本
# 完全移除之前部署的所有组件
################################################################################

set -e

# 颜色定义
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

print_banner() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║              Maliang API 卸载脚本                              ║"
    echo "║              ⚠️  警告：将删除所有相关数据！⚠️️                   ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
}

confirm_uninstall() {
    echo -e "${RED}⚠️  警告：此操作将：${NC}"
    echo "  • 停止并删除应用进程"
    echo "  • 删除应用代码和配置"
    echo "  • 删除 Nginx 配置"
    echo "  • 删除数据库和数据"
    echo "  • 删除 Redis 配置"
    echo "  • 卸载相关软件包"
    echo ""
    echo -e "${YELLOW}建议：如果只是重启或更新，不要使用此脚本${NC}"
    echo ""

    read -p "输入 'YES' 确认卸载: " confirm
    if [ "$confirm" != "YES" ]; then
        echo "卸载已取消"
        exit 0
    fi
}

stop_app() {
    echo "=== 停止应用 ==="

    if pm2 status | grep -q "maliang-api"; then
        pm2 stop maliang-api
        pm2 delete maliang-api
        pm2 save
        echo "✓ 应用已停止"
    else
        echo "! 应用未运行"
    fi

    # 清理 PM2 开机自启
    pm2 unstartup systemd 2>/dev/null || true
    echo ""
}

remove_nginx_config() {
    echo "=== 删除 Nginx 配置 ==="

    sudo rm -f /etc/nginx/sites-available/maliang
    sudo rm -f /etc/nginx/sites-enabled/maliang
    sudo rm -f /etc/nginx/sites-available/maliang.backup

    # 恢复默认配置
    if [ ! -f /etc/nginx/sites-enabled/default ]; then
        sudo cp /usr/share/nginx/html/index.nginx-debian.html /var/www/html/index.html 2>/dev/null || true
    fi

    sudo nginx -t 2>/dev/null && sudo systemctl reload nginx
    echo "✓ Nginx 配置已删除"
    echo ""
}

remove_app_files() {
    echo "=== 删除应用文件 ==="

    cd ~

    if [ -d "maliang" ]; then
        # 备份重要文件
        mkdir -p ~/.maliang-backup

        if [ -f "maliang/.env.production" ]; then
            cp maliang/.env.production ~/.maliang-backup/
            echo "! 配置文件已备份到 ~/.maliang-backup/"
        fi

        if [ -d "maliang/logs" ]; then
            cp -r maliang/logs ~/.maliang-backup/
            echo "! 日志文件已备份到 ~/.maliang-backup/"
        fi

        rm -rf maliang
        echo "✓ 应用代码已删除"
    else
        echo "! 应用目录不存在"
    fi

    echo ""
}

remove_database() {
    echo "=== 删除数据库 ==="

    read -p "是否删除数据库 imagesaas? (这将永久删除所有数据!) (yes/no): " confirm_db
    if [ "$confirm_db" == "yes" ]; then
        sudo -u postgres psql << EOF
DROP DATABASE IF EXISTS imagesaas;
DROP USER IF EXISTS maliang;
EOF
        echo "✓ 数据库已删除"
    else
        echo "! 数据库保留"
    fi

    echo ""
}

remove_redis_config() {
    echo "=== 清理 Redis 配置 ==="

    if [ -f /etc/redis/redis.conf.bak ]; then
        echo "! Redis 配置备份已存在，跳过"
    else
        echo "! Redis 配置未修改，跳过"
    fi

    # 清空 Redis 数据（可选）
    read -p "是否清空 Redis 数据? (y/n): " confirm_redis
    if [ "$confirm_redis" == "y" ]; then
        redis-cli FLUSHALL 2>/dev/null || echo "! Redis 未运行或无密码"
        echo "✓ Redis 数据已清空"
    fi

    echo ""
}

uninstall_packages() {
    echo "=== 卸载软件包 ==="

    echo "可卸载的软件包："
    echo "  1. Node.js 和 npm"
    echo "  2. PostgreSQL"
    echo "  3. Redis"
    echo "  4. PM2"
    echo "  5. Nginx"
    echo ""

    read -p "是否卸载以上软件包? (y/n): " confirm_packages

    if [ "$confirm_packages" == "y" ]; then
        # 停止服务
        sudo systemctl stop postgresql 2>/dev/null || true
        sudo systemctl stop redis-server 2>/dev/null || true
        sudo systemctl stop nginx 2>/dev/null || true

        # 卸载
        sudo apt remove --purge -y postgresql postgresql-contrib redis-server nginx
        sudo npm uninstall -g pm2
        sudo apt autoremove -y

        echo "✓ 软件包已卸载"
    else
        echo "! 软件包保留"
    fi

    echo ""
}

remove_user() {
    echo "=== 清理 PM2 用户 ==="

    # PM2 systemd 服务
    sudo rm -f /etc/systemd/system/pm2-maliang.service
    sudo systemctl daemon-reload

    echo "✓ PM2 服务已清理"
    echo ""
}

show_summary() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                    卸载完成                                   ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "备份文件位置: ~/.maliang-backup/"
    echo ""
    echo "如果需要完全重装，可以："
    echo "  1. 删除备份: rm -rf ~/.maliang-backup"
    echo "  2. 重新运行部署脚本"
    echo ""
}

# 主流程
print_banner
confirm_uninstall

stop_app
remove_nginx_config
remove_app_files
remove_database
remove_redis_config
uninstall_packages
remove_user

show_summary

echo "卸载完成！"
