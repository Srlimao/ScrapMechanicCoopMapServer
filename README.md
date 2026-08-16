# 🛰️ Scrap Mechanic Co-op Tactical Map - Relay Server

High-performance, low-latency WebSocket room relay server for the **Scrap Mechanic Tactical Co-op Map Viewer**.

Allows co-op players to create/join rooms, automatically synchronize world seeds, stream live character coordinates across the internet, and drop tactical squad pings.

---

## ⚡ Quick Start on Google Cloud VM

### Option A: 1-Command Setup (Linux / Debian / Ubuntu)
SSH into your Google Cloud VM and run:
```bash
git clone https://github.com/Srlimao/ScrapMechanicCoopMapServer.git
cd ScrapMechanicCoopMapServer
chmod +x deploy_gcp.sh
./deploy_gcp.sh
```
This automatically installs Node.js, configures a persistent `systemd` daemon, and starts the relay server on port `8090`.

---

### Option B: Docker
```bash
git clone https://github.com/Srlimao/ScrapMechanicCoopMapServer.git
cd ScrapMechanicCoopMapServer
docker compose up -d --build
```

---

## 🔒 Firewall Configuration (GCP)
Ensure port `8090` (TCP) is open in your Google Cloud VPC Firewall:
- **Target**: All instances in network
- **Source IPv4 Ranges**: `0.0.0.0/0`
- **Protocols and Ports**: `tcp:8090`

---

## 📊 Endpoints & Protocol

- **WebSocket**: `ws://<YOUR-VM-IP>:8090` (or `wss://relay.yourdomain.com`)
- **Health Check**: `GET http://<YOUR-VM-IP>:8090/health`
- **Room Stats**: `GET http://<YOUR-VM-IP>:8090/stats`

---

## 📜 License
MIT
