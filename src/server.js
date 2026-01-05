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
        
        this.setupExpress();
        this.setupWebSocket();
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

            // Send current status
            ws.send(JSON.stringify({
                type: 'status',
                connected: this.amplifierClient && this.amplifierClient.isConnected,
                amplifierIP: this.amplifierClient ? this.amplifierClient.amplifierIP : null
            }));

            ws.on('close', () => {
                console.log('WebSocket client disconnected');
                this.connectedClients.delete(ws);
            });

            ws.on('error', (err) => {
                console.error('WebSocket error:', err.message);
                this.connectedClients.delete(ws);
            });
        });
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.connectedClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
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
                console.log('Amplifier connected, starting polling');
                this.broadcast({
                    type: 'status',
                    connected: true,
                    amplifierIP: amplifierIP
                });
                this.amplifierClient.startPolling(250); // Poll every 250ms
            });

            this.amplifierClient.on('disconnected', () => {
                console.log('Amplifier disconnected');
                this.broadcast({
                    type: 'status',
                    connected: false,
                    amplifierIP: null
                });
            });

            this.amplifierClient.on('data', (data) => {
                this.broadcast({
                    type: 'audioData',
                    ...data
                });
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
            
            this.broadcast({
                type: 'status',
                connected: false,
                amplifierIP: null
            });
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
