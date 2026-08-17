// Scrap Mechanic Tactical Co-op Map - High-Performance WebSocket Room Relay Server
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
require('dotenv').config();

const PORT = parseInt(process.env.PORT || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';

// In-memory Room State: Map<roomCode, Room>
// Room: { code, seed, hostId, createdAt, peers: Map<peerId, Peer> }
// Peer: { id, ws, name, color, x, y, z, dirX, dirY, speed, lastSeen, isHost }
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToRoom(roomCode, msgObj, excludePeerId = null) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const raw = JSON.stringify(msgObj);
    for (const [peerId, peer] of room.peers.entries()) {
        if (peerId !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(raw);
        }
    }
}

// 1. Create HTTP Server for Health Checks & WebSocket Upgrade
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            activeRooms: rooms.size,
            totalPeers: Array.from(rooms.values()).reduce((acc, r) => acc + r.peers.size, 0),
            uptimeSeconds: Math.floor(process.uptime())
        }));
        return;
    }

    if (req.url === '/stats') {
        const roomStats = Array.from(rooms.values()).map(r => ({
            code: r.code,
            seed: r.seed,
            peers: r.peers.size,
            uptime: Math.floor((Date.now() - r.createdAt) / 1000)
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, rooms: roomStats }));
        return;
    }

    res.writeHead(404);
    res.end();
});

const wss = new WebSocketServer({ server });

let nextPeerId = 1;

wss.on('connection', (ws, req) => {
    const peerId = `p_${nextPeerId++}_${Math.random().toString(36).substring(2, 7)}`;
    let currentRoomCode = null;
    let peerName = 'Player';
    let peerColor = '#00e5ff';
    let lastMsgTime = 0;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        let msg = null;
        try {
            msg = JSON.parse(data.toString());
        } catch (e) { return; }

        const type = msg.type;

        // 1. CREATE ROOM
        if (type === 'create_room') {
            const requestedCode = (msg.roomCode || generateRoomCode()).toUpperCase().trim();
            const code = rooms.has(requestedCode) ? generateRoomCode() : requestedCode;
            const seed = msg.seed || 151054709;
            peerName = msg.name || 'Host';
            peerColor = msg.color || '#00e5ff';
            const cells = Array.isArray(msg.cells) && msg.cells.length > 0 ? msg.cells : null;

            const room = {
                code,
                seed,
                cells,
                hostId: peerId,
                createdAt: Date.now(),
                peers: new Map()
            };

            const peer = { id: peerId, ws, name: peerName, color: peerColor, x: 0, y: 0, z: 0, dirX: 0, dirY: 1, speed: 0, lastSeen: Date.now(), isHost: true };
            room.peers.set(peerId, peer);
            rooms.set(code, room);
            currentRoomCode = code;

            const cellInfo = cells ? ` (${cells.length} cells attached)` : '';
            console.log(`[Relay] Room created: #${code} (Seed: ${seed})${cellInfo} by ${peerName} (${peerId})`);

            ws.send(JSON.stringify({
                type: 'room_created',
                roomCode: code,
                seed: room.seed,
                cells: room.cells,
                peerId: peerId,
                isHost: true,
                peers: []
            }));
            return;
        }

        // 2. JOIN ROOM
        if (type === 'join_room') {
            const code = (msg.roomCode || '').toUpperCase().trim();
            peerName = msg.name || 'Squad Member';
            peerColor = msg.color || '#ff7a00';

            const room = rooms.get(code);
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', message: `Room #${code} does not exist.` }));
                return;
            }

            const peer = { id: peerId, ws, name: peerName, color: peerColor, x: 0, y: 0, z: 0, dirX: 0, dirY: 1, speed: 0, lastSeen: Date.now(), isHost: false };
            room.peers.set(peerId, peer);
            currentRoomCode = code;

            console.log(`[Relay] ${peerName} (${peerId}) joined Room #${code}`);

            // Send full room state & current peer roster to joining player
            const existingPeers = [];
            for (const [id, p] of room.peers.entries()) {
                if (id !== peerId) {
                    existingPeers.push({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, dirX: p.dirX, dirY: p.dirY, speed: p.speed, isHost: p.isHost });
                }
            }

            ws.send(JSON.stringify({
                type: 'room_joined',
                roomCode: code,
                seed: room.seed,
                cells: room.cells,
                peerId: peerId,
                isHost: false,
                peers: existingPeers
            }));

            // Notify other peers in room
            broadcastToRoom(code, {
                type: 'peer_joined',
                peer: { id: peerId, name: peerName, color: peerColor, isHost: false }
            }, peerId);
            return;
        }

        // 2.5 UPDATE ROOM CELLS (Host can push fresh cell atlas to all peers)
        if (type === 'update_cells' && currentRoomCode) {
            const room = rooms.get(currentRoomCode);
            if (room && room.hostId === peerId && Array.isArray(msg.cells)) {
                room.cells = msg.cells;
                if (msg.seed) room.seed = msg.seed;
                broadcastToRoom(currentRoomCode, { type: 'cells_updated', seed: room.seed, cells: room.cells }, peerId);
                console.log(`[Relay] Host updated ${room.cells.length} cells in Room #${currentRoomCode}`);
            }
            return;
        }

        // 3. TELEMETRY STREAM (Rate-limited to 25 Hz)
        if (type === 'telemetry' && currentRoomCode) {
            const now = Date.now();
            if (now - lastMsgTime < 40) return; // Cap at 25 Hz
            lastMsgTime = now;

            const room = rooms.get(currentRoomCode);
            if (!room) return;
            const peer = room.peers.get(peerId);
            if (peer) {
                peer.x = msg.x || 0;
                peer.y = msg.y || 0;
                peer.z = msg.z || 0;
                peer.dirX = msg.dirX || 0;
                peer.dirY = msg.dirY || 1;
                peer.speed = msg.speed || 0;
                peer.lastSeen = now;

                broadcastToRoom(currentRoomCode, {
                    type: 'telemetry_broadcast',
                    id: peerId,
                    x: peer.x,
                    y: peer.y,
                    z: peer.z,
                    dirX: peer.dirX,
                    dirY: peer.dirY,
                    speed: peer.speed,
                    t: now
                }, peerId);
            }
            return;
        }

        // 4. TACTICAL SQUAD PING
        if (type === 'squad_ping' && currentRoomCode) {
            broadcastToRoom(currentRoomCode, {
                type: 'squad_ping_broadcast',
                id: `ping_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                authorId: peerId,
                authorName: peerName,
                x: msg.x,
                y: msg.y,
                text: msg.text || 'Tactical Marker',
                pingType: msg.pingType || 'alert',
                color: peerColor,
                t: Date.now()
            });
            return;
        }

        // 5. UPDATE ROOM SEED (Host Only)
        if (type === 'update_seed' && currentRoomCode) {
            const room = rooms.get(currentRoomCode);
            if (room && room.hostId === peerId && msg.seed) {
                room.seed = msg.seed;
                broadcastToRoom(currentRoomCode, { type: 'seed_updated', seed: msg.seed });
            }
            return;
        }
    });

    const cleanup = () => {
        if (!currentRoomCode) return;
        const room = rooms.get(currentRoomCode);
        if (room) {
            room.peers.delete(peerId);
            console.log(`[Relay] ${peerName} (${peerId}) disconnected from #${currentRoomCode}`);

            if (room.peers.size === 0) {
                rooms.delete(currentRoomCode);
                console.log(`[Relay] Room #${currentRoomCode} closed (empty).`);
            } else {
                broadcastToRoom(currentRoomCode, { type: 'peer_left', peerId: peerId });
            }
        }
        currentRoomCode = null;
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
});

// Periodic Heartbeat Ping (Every 10s) to prune dead connections
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 10000);

server.listen(PORT, HOST, () => {
    console.log("=================================================================");
    console.log("  SCRAP MECHANIC CO-OP MAP - WEBSOCKET ROOM RELAY SERVER");
    console.log("=================================================================");
    console.log(`  Listening on:   ws://${HOST}:${PORT}`);
    console.log(`  Health Check:   http://${HOST}:${PORT}/health`);
    console.log("=================================================================");
});
