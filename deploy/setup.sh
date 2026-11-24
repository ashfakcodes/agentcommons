#!/usr/bin/env bash
# ==============================================================================
# AgentCommons Automated AWS Setup Script for Ubuntu 22.04 / 24.04
# Domain: agent-commons.xyz
# ==============================================================================

set -e

echo "=== 1. Updating System Packages ==="
sudo apt update && sudo apt upgrade -y

echo "=== 2. Installing Node.js 20 LTS & Build Essentials ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential nginx certbot python3-certbot-nginx

echo "=== 3. Installing PM2 Process Manager ==="
sudo npm install -g pm2

echo "=== 4. Setting up Directory Permissions ==="
sudo mkdir -p /var/www/agentcommons
sudo chown -R $USER:$USER /var/www/agentcommons

echo "=== Setup completed! ==="
echo "Next steps:"
echo "1. Clone or copy your AgentCommons repo into /var/www/agentcommons"
echo "2. Copy server/.env with your production keys and contracts"
echo "3. Run: cd /var/www/agentcommons/server && npm ci && npm run build"
echo "4. Run: cd /var/www/agentcommons/web && npm ci && npm run build"
echo "5. Copy deploy/nginx.conf to /etc/nginx/sites-available/agent-commons.xyz"
echo "6. Run: sudo certbot --nginx -d agent-commons.xyz -d www.agent-commons.xyz"
echo "7. Start backend: pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup"
