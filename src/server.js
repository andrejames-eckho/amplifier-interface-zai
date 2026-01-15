const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const NPA43AClient = require('./amplifier-client');

class AudioVisualizerServer {
    constructor(port = 8080) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.connectedClients = new Set();
        this.statusBroadcastInterval = null;
        this.heartbeatInterval = null;
        this.ipStorageFile = path.join(__dirname, 'ip-addresses.json');
        this.savedIPs = this.loadIPAddresses();
        
        // Amplifier storage - map of IP -> client
        this.amplifierClients = new Map();
        this.amplifierData = new Map(); // Map of IP -> amplifier data
        
        this.setupExpress();
        this.setupWebSocket();
        this.startPeriodicStatusBroadcast();
        this.startHeartbeat();
    }

    loadIPAddresses() {
        try {
            if (fs.existsSync(this.ipStorageFile)) {
                const data = fs.readFileSync(this.ipStorageFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('Error loading IP addresses:', err.message);
        }
        return [];
    }

    saveIPAddresses() {
        try {
            fs.writeFileSync(this.ipStorageFile, JSON.stringify(this.savedIPs, null, 2));
        } catch (err) {
            console.error('Error saving IP addresses:', err.message);
        }
    }


    setupExpress() {
        // Serve static files from public directory
        this.app.use(express.static(path.join(__dirname, '../public')));
        
        // API endpoint to connect to amplifier
        this.app.post('/api/connect', express.json(), async (req, res) => {
            const { ip } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            try {
                await this.connectToAmplifier(ip);
                res.json({ success: true, message: 'Connected to amplifier' });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // API endpoint to get all saved IP addresses
        this.app.get('/api/ips', (req, res) => {
            const connectedIPs = Array.from(this.amplifierClients.keys());
            res.json({
                ips: this.savedIPs,
                connectedIPs: connectedIPs
            });
        });

        // API endpoint to add a new IP address
        this.app.post('/api/ips', express.json(), (req, res) => {
            const { ip, name } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            // Validate IP format (basic validation)
            const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (!ipRegex.test(ip)) {
                return res.status(400).json({ error: 'Invalid IP address format' });
            }

            // Check if IP already exists
            if (this.savedIPs.find(savedIP => savedIP.ip === ip)) {
                return res.status(400).json({ error: 'IP address already exists' });
            }

            const newIP = {
                id: Date.now().toString(),
                ip: ip,
                name: name || ip,
                addedAt: new Date().toISOString()
            };

            this.savedIPs.push(newIP);
            this.saveIPAddresses();
            
            res.json({ 
                success: true, 
                message: 'IP address added successfully',
                ip: newIP
            });
        });

        // API endpoint to remove an IP address
        this.app.delete('/api/ips/:id', (req, res) => {
            const { id } = req.params;
            
            const index = this.savedIPs.findIndex(ip => ip.id === id);
            if (index === -1) {
                return res.status(404).json({ error: 'IP address not found' });
            }

            const removedIP = this.savedIPs[index];
            this.savedIPs.splice(index, 1);
            this.saveIPAddresses();

            // Disconnect from this amplifier if connected
            this.disconnectFromAmplifier(removedIP.ip);

            res.json({ 
                success: true, 
                message: 'IP address removed successfully',
                removedIP: removedIP
            });
        });


        // API endpoint to disconnect
        this.app.post('/api/disconnect', express.json(), (req, res) => {
            const { ip } = req.body;
            
            if (ip) {
                this.disconnectFromAmplifier(ip);
                res.json({ success: true, message: `Disconnected from amplifier ${ip}` });
            } else {
                this.disconnectFromAmplifier();
                res.json({ success: true, message: 'Disconnected from all amplifiers' });
            }
        });

        // API endpoint for mute control
        this.app.post('/api/mute', express.json(), (req, res) => {
            const { type, id, mute, amplifierIP } = req.body;
            
            console.log(`\n=== MUTE API CALL ===`);
            console.log(`Request body:`, req.body);
            console.log(`Type: ${type}, ID: ${id}, Mute: ${mute}, Amplifier IP: ${amplifierIP}`);
            
            // Find the correct amplifier client
            let targetClient = null;
            
            if (amplifierIP) {
                // Use specific amplifier
                targetClient = this.channelClients.get(amplifierIP);
            } else if (this.amplifierClient && this.amplifierClient.isConnected) {
                // Fallback to main client
                targetClient = this.amplifierClient;
            } else {
                // Try to find any connected client
                for (const [ip, client] of this.channelClients.entries()) {
                    if (client.isConnected) {
                        targetClient = client;
                        break;
                    }
                }
            }
            
            if (!targetClient) {
                console.log(`❌ No connected amplifier found`);
                return res.status(400).json({ error: 'No connected amplifier found' });
            }
            
            console.log(`✓ Using amplifier ${targetClient.amplifierIP}, sending command...`);
            
            try {
                if (type === 'all-output') {
                    console.log(`Sending master mute command (all-output)`);
                    targetClient.setMute('all-output', null, mute);
                } else if (type === 'input' || type === 'output') {
                    if (!id || id < 1 || id > 4) {
                        console.log(`❌ Invalid channel ID: ${id}`);
                        return res.status(400).json({ error: 'Invalid channel ID. Must be 1-4' });
                    }
                    console.log(`Sending channel mute command: ${type} ${id}`);
                    targetClient.setMute(type, id, mute);
                } else {
                    console.log(`❌ Invalid type: ${type}`);
                    return res.status(400).json({ error: 'Invalid type. Must be input, output, or all-output' });
                }
                
                console.log(`✓ Command sent successfully`);
                res.json({ 
                    success: true, 
                    message: `${mute ? 'Muted' : 'Unmuted'} ${type}${id ? ' ' + id : ''}` 
                });
            } catch (err) {
                console.log(`❌ Error sending command:`, err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // API endpoint to get connection status
        this.app.get('/api/status', (req, res) => {
            const connectedIPs = Array.from(this.amplifierClients.keys())
                .filter(ip => this.amplifierClients.get(ip).isConnected);
            
            res.json({
                connected: connectedIPs.length > 0,
                connectedIPs: connectedIPs,
                totalConnected: connectedIPs.length,
                clientCount: this.connectedClients.size
            });
        });

        // API endpoint for mute control
        this.app.post('/api/mute', express.json(), (req, res) => {
            const { type, id, mute, amplifierIP } = req.body;
            
            // Find the correct amplifier client
            let targetClient = null;
            
            if (amplifierIP) {
                // Use specific amplifier
                targetClient = this.amplifierClients.get(amplifierIP);
            }
            
            if (!targetClient) {
                return res.status(400).json({ error: 'Amplifier not found or not connected' });
            }
            
            try {
                if (type === 'all-output') {
                    targetClient.setMute('all-output', null, mute);
                } else if (type === 'input' || type === 'output') {
                    if (!id || id < 1 || id > 4) {
                        return res.status(400).json({ error: 'Invalid channel ID. Must be 1-4' });
                    }
                    targetClient.setMute(type, id, mute);
                } else {
                    return res.status(400).json({ error: 'Invalid type. Must be input, output, or all-output' });
                }
                
                res.json({ 
                    success: true, 
                    message: `${mute ? 'Muted' : 'Unmuted'} ${type}${id ? ' ' + id : ''}` 
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Serve main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('WebSocket client connected');
            this.connectedClients.add(ws);

            // Send current status immediately
            this.broadcastCurrentStatus();

            ws.on('close', () => {
                console.log('WebSocket client disconnected');
                this.connectedClients.delete(ws);
            });

            ws.on('error', (err) => {
                console.error('WebSocket error:', err.message);
                this.connectedClients.delete(ws);
            });

            // Handle pong responses for heartbeat
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Mark as alive for heartbeat tracking
            ws.isAlive = true;
        });
    }

    startPeriodicStatusBroadcast() {
        // Broadcast status every 10 seconds to ensure frontend stays updated
        this.statusBroadcastInterval = setInterval(() => {
            this.broadcastCurrentStatus();
        }, 10000);
    }

    startHeartbeat() {
        // WebSocket heartbeat to detect dead connections
        this.heartbeatInterval = setInterval(() => {
            this.connectedClients.forEach(ws => {
                if (!ws.isAlive) {
                    console.log('Terminating dead WebSocket connection');
                    ws.terminate();
                    this.connectedClients.delete(ws);
                    return;
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // 30 second heartbeat
    }

    stopPeriodicUpdates() {
        if (this.statusBroadcastInterval) {
            clearInterval(this.statusBroadcastInterval);
            this.statusBroadcastInterval = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        console.log('📡 Broadcasting to', this.connectedClients.size, 'clients:', data);
        this.connectedClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
    }

    broadcastCurrentStatus() {
        const connectedIPs = Array.from(this.amplifierClients.keys())
            .filter(ip => this.amplifierClients.get(ip).isConnected);
            
        this.broadcast({
            type: 'status',
            connected: connectedIPs.length > 0,
            connectedIPs: connectedIPs,
            totalConnected: connectedIPs.length
        });
    }

    async connectToAmplifier(amplifierIP) {
        try {
            // Check if we already have a client for this IP
            if (this.amplifierClients.has(amplifierIP)) {
                console.log(`✓ Already connected to ${amplifierIP}`);
                return;
            }

            console.log(`Creating amplifier client for IP ${amplifierIP}`);
            
            // Create new client for this IP
            const client = new NPA43AClient(amplifierIP, 8234);
            
            // Set up event handlers for this client
            client.on('connected', () => {
                console.log(`🔗 Amplifier ${amplifierIP} connected`);
                this.broadcastCurrentStatus();
                client.startPolling(250); // Poll every 250ms
            });

            client.on('disconnected', () => {
                console.log(`Amplifier ${amplifierIP} disconnected`);
                this.amplifierClients.delete(amplifierIP);
                this.broadcastCurrentStatus();
            });

            client.on('data', (data) => {
                // Broadcast data with amplifier IP
                if (data.db !== undefined) {
                    // Audio level data
                    this.broadcast({
                        type: 'audioData',
                        amplifierIP: amplifierIP,
                        ...data
                    });
                } else if (data.muted !== undefined) {
                    // Mute status data
                    this.broadcast({
                        type: 'muteStatus',
                        amplifierIP: amplifierIP,
                        channelType: data.channelType,
                        channelId: data.channelId,
                        muted: data.muted,
                        timestamp: data.timestamp
                    });
                }
            });

            client.on('error', (err) => {
                console.error(`Amplifier ${amplifierIP} error:`, err.message);
                this.broadcast({
                    type: 'error',
                    message: `${amplifierIP}: ${err.message}`
                });
            });

            // Store and connect to amplifier
            this.amplifierClients.set(amplifierIP, client);
            await client.connect();
            
            console.log(`✓ Connected to amplifier ${amplifierIP}`);
            
        } catch (err) {
            console.error(`Failed to connect to amplifier ${amplifierIP}:`, err.message);
            throw err;
        }
    }

    disconnectFromAmplifier(amplifierIP = null) {
        if (amplifierIP) {
            // Disconnect specific amplifier
            const client = this.amplifierClients.get(amplifierIP);
            if (client) {
                console.log(`Disconnecting amplifier ${amplifierIP}`);
                client.disconnect();
                this.amplifierClients.delete(amplifierIP);
            }
        } else {
            // Disconnect all amplifiers
            for (const [ip, client] of this.amplifierClients.entries()) {
                console.log(`Disconnecting amplifier ${ip}`);
                client.disconnect();
            }
            this.amplifierClients.clear();
        }
        
        this.broadcastCurrentStatus();
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`Audio Visualizer Server running on port ${this.port}`);
            console.log(`Open http://localhost:${this.port} in your browser`);
        });
    }

    stop() {
        this.disconnectFromAmplifier();
        this.stopPeriodicUpdates();
        
        // Ensure all amplifier clients are disconnected
        for (const [ip, client] of this.amplifierClients.entries()) {
            client.disconnect();
        }
        this.amplifierClients.clear();
        
        this.server.close();
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new AudioVisualizerServer(8080);
    server.start();

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down server...');
        server.stop();
        process.exit(0);
    });
}

module.exports = AudioVisualizerServer;
