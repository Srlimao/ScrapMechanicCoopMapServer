#!/bin/bash
# Scrap Mechanic Co-op Relay Server - GCP VM Quick Deployment Script
# Tested on Debian / Ubuntu Compute Engine instances

set -e

echo "=== [1/4] Updating system & installing Node.js 20 ==="
sudo apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

echo "=== [2/4] Installing NPM Dependencies ==="
npm install --production

echo "=== [3/4] Setting up systemd background service ==="
SERVICE_FILE="/etc/systemd/system/sm-relay.service"
CURRENT_DIR=$(pwd)

sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Scrap Mechanic Tactical Co-op Relay Server
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$CURRENT_DIR
ExecStart=/usr/bin/node $CURRENT_DIR/server.js
Restart=always
RestartSec=5
Environment=PORT=8090
Environment=HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable sm-relay
sudo systemctl restart sm-relay

echo "=== [4/4] Relay Server is LIVE! ==="
sudo systemctl status sm-relay --no-pager
echo ""
echo "Relay Server running on port 8090."
echo "Check health at: curl http://localhost:8090/health"
