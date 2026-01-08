const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const NPA43AClient = require('./amplifier-client');

class AudioVisualizerServer {
    constructor(port = 8080) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.amplifierClient = null;
        this.connectedClients = new Set();
        this.statusBroadcastInterval = null;
        this.heartbeatInterval = null;
        
        this.setupExpress();
        this.setupWebSocket();
        this.startPeriodicStatusBroadcast();
        this.startHeartbeat();
    }

    setupExpress() {
        // Serve static files from public directory
        this.app.use(express.static(path.join(__dirname, '../public')));
        
        // API endpoint to set amplifier IP
        this.app.post('/api/connect', express.json(), (req, res) => {
            const { amplifierIP } = req.body;
            
            if (!amplifierIP) {
                return res.status(400).json({ error: 'Amplifier IP is required' });
            }

            this.connectToAmplifier(amplifierIP)
                .then(() => {
                    res.json({ success: true, message: 'Connected to amplifier' });
                })
                .catch(err => {
                    res.status(500).json({ error: err.message });
                });
        });

        // API endpoint to disconnect
        this.app.post('/api/disconnect', (req, res) => {
            this.disconnectFromAmplifier();
            res.json({ success: true, message: 'Disconnected from amplifier' });
        });

        // API endpoint for mute control
        this.app.post('/api/mute', express.json(), (req, res) => {
            const { type, id, mute } = req.body;
            
            console.log(`\n=== MUTE API CALL ===`);
            console.log(`Request body:`, req.body);
            console.log(`Type: ${type}, ID: ${id}, Mute: ${mute}`);
            
            if (!this.amplifierClient || !this.amplifierClient.isConnected) {
                console.log(`❌ Not connected to amplifier`);
                return res.status(400).json({ error: 'Not connected to amplifier' });
            }
            
            console.log(`✓ Amplifier connected, sending command...`);
            
            try {
                if (type === 'all-output') {
                    console.log(`Sending master mute command (all-output)`);
                    this.amplifierClient.setMute('all-output', null, mute);
                } else if (type === 'input' || type === 'output') {
                    if (!id || id < 1 || id > 4) {
                        console.log(`❌ Invalid channel ID: ${id}`);
                        return res.status(400).json({ error: 'Invalid channel ID. Must be 1-4' });
                    }
                    console.log(`Sending channel mute command: ${type} ${id}`);
                    this.amplifierClient.setMute(type, id, mute);
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
            res.json({
                connected: this.amplifierClient && this.amplifierClient.isConnected,
                amplifierIP: this.amplifierClient ? this.amplifierClient.amplifierIP : null,
                clientCount: this.connectedClients.size
            });
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
        // Broadcast status every 5 seconds to ensure frontend stays updated
        this.statusBroadcastInterval = setInterval(() => {
            this.broadcastCurrentStatus();
        }, 5000);
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
        this.broadcast({
            type: 'status',
            connected: this.amplifierClient && this.amplifierClient.isConnected,
            amplifierIP: this.amplifierClient ? this.amplifierClient.amplifierIP : null
        });
    }

    async connectToAmplifier(amplifierIP) {
        try {
            // Disconnect existing connection if any
            if (this.amplifierClient) {
                this.disconnectFromAmplifier();
            }

            // Create new client
            this.amplifierClient = new NPA43AClient(amplifierIP);
            
            // Set up event handlers
            this.amplifierClient.on('connected', () => {
                console.log('🔗 Amplifier connected event received, starting polling');
                this.broadcastCurrentStatus();
                this.amplifierClient.startPolling(250); // Poll every 250ms
            });

            this.amplifierClient.on('disconnected', () => {
                console.log('Amplifier disconnected');
                this.broadcastCurrentStatus();
            });

            this.amplifierClient.on('data', (data) => {
                if (data.db !== undefined) {
                    // Audio level data
                    this.broadcast({
                        type: 'audioData',
                        ...data
                    });
                } else if (data.muted !== undefined) {
                    // Mute status data
                    this.broadcast({
                        type: 'muteStatus',
                        channelType: data.channelType,
                        channelId: data.channelId,
                        muted: data.muted,
                        timestamp: data.timestamp
                    });
                }
            });

            this.amplifierClient.on('error', (err) => {
                console.error('Amplifier error:', err.message);
                this.broadcast({
                    type: 'error',
                    message: err.message
                });
            });

            // Connect to amplifier
            await this.amplifierClient.connect();
            
        } catch (err) {
            console.error('Failed to connect to amplifier:', err.message);
            this.broadcast({
                type: 'error',
                message: `Connection failed: ${err.message}`
            });
            throw err;
        }
    }

    disconnectFromAmplifier() {
        if (this.amplifierClient) {
            this.amplifierClient.disconnect();
            this.amplifierClient = null;
            
            this.broadcastCurrentStatus();
        }
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
