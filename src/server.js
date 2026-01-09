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
        this.amplifierClient = null;
        this.connectedClients = new Set();
        this.statusBroadcastInterval = null;
        this.heartbeatInterval = null;
        this.ipStorageFile = path.join(__dirname, 'ip-addresses.json');
        this.savedIPs = this.loadIPAddresses();
        this.currentIP = null;
        
        // Channel IP assignments storage
        this.channelIPAssignments = {};
        this.channelAssignmentsFile = path.join(__dirname, 'channel-assignments.json');
        this.loadChannelAssignments();
        
        // Channel number assignments storage (maps display channel to actual amplifier channel)
        this.channelNumberAssignments = {};
        this.loadChannelNumberAssignments();
        
        // Per-channel amplifier clients for monitoring different IPs
        this.channelClients = new Map(); // Map of IP -> NPA43AClient
        this.channelClientData = new Map(); // Map of channel -> latest data
        
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

    loadChannelAssignments() {
        try {
            if (fs.existsSync(this.channelAssignmentsFile)) {
                const data = fs.readFileSync(this.channelAssignmentsFile, 'utf8');
                const assignments = JSON.parse(data);
                this.channelIPAssignments = assignments.ipAssignments || {};
                this.channelNumberAssignments = assignments.numberAssignments || {};
                console.log('Loaded channel IP assignments:', this.channelIPAssignments);
                console.log('Loaded channel number assignments:', this.channelNumberAssignments);
            }
        } catch (err) {
            console.error('Error loading channel assignments:', err.message);
        }
    }

    loadChannelNumberAssignments() {
        // This method is now integrated into loadChannelAssignments for simplicity
        // Keeping it for compatibility but it doesn't need to do anything
    }

    saveChannelAssignments() {
        try {
            const assignments = {
                ipAssignments: this.channelIPAssignments,
                numberAssignments: this.channelNumberAssignments
            };
            fs.writeFileSync(this.channelAssignmentsFile, JSON.stringify(assignments, null, 2));
        } catch (err) {
            console.error('Error saving channel assignments:', err.message);
        }
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
                    this.currentIP = amplifierIP;
                    res.json({ success: true, message: 'Connected to amplifier' });
                })
                .catch(err => {
                    res.status(500).json({ error: err.message });
                });
        });

        // API endpoint to get all saved IP addresses
        this.app.get('/api/ips', (req, res) => {
            res.json({
                ips: this.savedIPs,
                currentIP: this.currentIP
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

            // If the removed IP was current connection, disconnect
            if (this.currentIP === removedIP.ip) {
                this.disconnectFromAmplifier();
                this.currentIP = null;
            }

            res.json({ 
                success: true, 
                message: 'IP address removed successfully',
                removedIP: removedIP
            });
        });

        // API endpoint to switch to a different IP
        this.app.post('/api/switch', express.json(), (req, res) => {
            const { ip } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            // Check if IP exists in saved list
            const savedIP = this.savedIPs.find(savedIP => savedIP.ip === ip);
            if (!savedIP) {
                return res.status(404).json({ error: 'IP address not found in saved list' });
            }

            this.connectToAmplifier(ip)
                .then(() => {
                    this.currentIP = ip;
                    res.json({ 
                        success: true, 
                        message: `Switched to ${savedIP.name || ip}`,
                        currentIP: ip
                    });
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
                currentIP: this.currentIP,
                clientCount: this.connectedClients.size,
                channelAssignments: this.channelIPAssignments,
                channelNumberAssignments: this.channelNumberAssignments
            });
        });

        // API endpoint to get all channel assignments
        this.app.get('/api/channel-assignments', (req, res) => {
            res.json({
                channelNumberAssignments: this.channelNumberAssignments,
                channelIPAssignments: this.channelIPAssignments
            });
        });

        // API endpoint for channel number assignments
        this.app.post('/api/channel-number', express.json(), (req, res) => {
            const { channel, channelNumber } = req.body;
            
            console.log(`\n=== CHANNEL NUMBER ASSIGNMENT ===`);
            console.log(`Channel: ${channel}, Channel Number: ${channelNumber}`);
            
            if (!channel) {
                return res.status(400).json({ error: 'Channel is required' });
            }
            
            if (!channelNumber || channelNumber < 1 || channelNumber > 4) {
                return res.status(400).json({ error: 'Channel number must be between 1 and 4' });
            }
            
            // Validate channel format (input-1, input-2, output-1, output-2, etc.)
            const channelRegex = /^(input|output)-[1-4]$/;
            if (!channelRegex.test(channel)) {
                return res.status(400).json({ error: 'Invalid channel format. Must be input-1 through input-4 or output-1 through output-4' });
            }
            
            // Assign channel number
            this.channelNumberAssignments[channel] = parseInt(channelNumber);
            console.log(`✓ Assigned channel number ${channelNumber} to display channel ${channel}`);
            
            // Save assignments to file
            this.saveChannelAssignments();
            
            // Update channel monitoring to apply new channel number mappings
            this.updateChannelMonitoring();
            
            res.json({ 
                success: true, 
                message: `Channel ${channel} assigned to amplifier channel ${channelNumber}`,
                channelNumberAssignments: this.channelNumberAssignments
            });
        });

        // API endpoint for channel IP assignments
        this.app.post('/api/channel-ip', express.json(), (req, res) => {
            const { channel, ip } = req.body;
            
            console.log(`\n=== CHANNEL IP ASSIGNMENT ===`);
            console.log(`Channel: ${channel}, IP: ${ip}`);
            
            if (!channel) {
                return res.status(400).json({ error: 'Channel is required' });
            }
            
            // Validate channel format (input-1, input-2, output-1, output-2, etc.)
            const channelRegex = /^(input|output)-[1-4]$/;
            if (!channelRegex.test(channel)) {
                return res.status(400).json({ error: 'Invalid channel format. Must be input-1 through input-4 or output-1 through output-4' });
            }
            
            if (ip && ip !== '') {
                // Validate IP format if provided
                const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
                if (!ipRegex.test(ip)) {
                    return res.status(400).json({ error: 'Invalid IP address format' });
                }
                
                // Check if IP exists in saved list
                const savedIP = this.savedIPs.find(savedIP => savedIP.ip === ip);
                if (!savedIP) {
                    return res.status(400).json({ error: 'IP address not found in saved list' });
                }
                
                // Assign IP to channel
                this.channelIPAssignments[channel] = ip;
                console.log(`✓ Assigned IP ${ip} to channel ${channel}`);
            } else {
                // Remove IP assignment from channel
                delete this.channelIPAssignments[channel];
                console.log(`✓ Removed IP assignment from channel ${channel}`);
            }
            
            // Save assignments to file
            this.saveChannelAssignments();
            
            // Implement per-channel monitoring logic
            this.updateChannelMonitoring();
            
            res.json({ 
                success: true, 
                message: ip ? `Channel ${channel} assigned to IP ${ip}` : `Channel ${channel} reverted to default monitoring`,
                channelAssignments: this.channelIPAssignments
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

            // Create channel mapping for the main client (channels not assigned to specific IPs)
            const channelMapping = {};
            for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                if (!assignedIP || assignedIP === '') {
                    // This display channel uses the default/main IP
                    const actualChannelId = this.channelNumberAssignments[displayChannel] || parseInt(displayChannel.split('-')[1]);
                    channelMapping[displayChannel] = actualChannelId;
                }
            }
            
            console.log(`Creating main amplifier client for IP ${amplifierIP} with mapping:`, channelMapping);
            
            // Create new client
            this.amplifierClient = new NPA43AClient(amplifierIP, 8234, Object.keys(channelMapping).length > 0 ? channelMapping : null);
            
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
                const channelKey = `${data.channelType}-${data.channelId}`;
                
                // Only broadcast data for channels that are NOT assigned to a specific IP
                // (i.e., channels that should use the default/current IP monitoring)
                if (!this.channelIPAssignments[channelKey]) {
                    console.log(`📡 Main client broadcasting data for unassigned channel: ${channelKey}`);
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
                } else {
                    console.log(`🚫 Main client blocking data for assigned channel: ${channelKey} (assigned to ${this.channelIPAssignments[channelKey]})`);
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

    async updateChannelMonitoring() {
        console.log('\n=== UPDATING CHANNEL MONITORING ===');
        console.log('Current IP assignments:', this.channelIPAssignments);
        console.log('Current channel number assignments:', this.channelNumberAssignments);
        
        // Update main amplifier client if it exists
        if (this.amplifierClient && this.currentIP) {
            console.log('Updating main amplifier client with new channel mappings...');
            
            // Create new channel mapping for the main client
            const channelMapping = {};
            for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                if (!assignedIP || assignedIP === '') {
                    // This display channel uses the default/main IP
                    const actualChannelId = this.channelNumberAssignments[displayChannel] || parseInt(displayChannel.split('-')[1]);
                    channelMapping[displayChannel] = actualChannelId;
                }
            }
            
            // Update the main client's channel mapping
            this.amplifierClient.channelMapping = Object.keys(channelMapping).length > 0 ? channelMapping : null;
            console.log('Main client updated with mapping:', channelMapping);
        }
        
        // Get all unique IPs that need to be monitored
        const requiredIPs = new Set();
        const ipToChannels = new Map(); // IP -> Set of channels
        
        // Add current IP for default monitoring
        if (this.currentIP) {
            requiredIPs.add(this.currentIP);
            ipToChannels.set(this.currentIP, new Set());
        }
        
        // Add assigned IPs
        for (const [channel, ip] of Object.entries(this.channelIPAssignments)) {
            if (ip && ip !== '') {
                requiredIPs.add(ip);
                if (!ipToChannels.has(ip)) {
                    ipToChannels.set(ip, new Set());
                }
                ipToChannels.get(ip).add(channel);
            }
        }
        
        console.log('Required IPs:', Array.from(requiredIPs));
        console.log('IP to channels mapping:', Object.fromEntries(ipToChannels));
        
        // Disconnect clients that are no longer needed
        for (const [ip, client] of this.channelClients.entries()) {
            if (!requiredIPs.has(ip)) {
                console.log(`Disconnecting client for IP ${ip} (no longer needed)`);
                client.disconnect();
                this.channelClients.delete(ip);
            } else {
                // Update existing clients with new channel mappings
                console.log(`Updating client for IP ${ip} with new channel mappings`);
                client.disconnect();
                this.channelClients.delete(ip);
            }
        }
        
        // Connect to all required IPs (both new and updated)
        for (const ip of requiredIPs) {
            console.log(`Creating/Recreating client for IP ${ip}`);
            await this.createChannelClient(ip);
        }
        
        console.log('=== END CHANNEL MONITORING UPDATE ===\n');
    }

    async createChannelClient(ip) {
        try {
            // Create channel mapping for this IP based on assignments
            const channelMapping = {};
            for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                if (assignedIP === ip) {
                    // This display channel is assigned to this IP
                    const actualChannelId = this.channelNumberAssignments[displayChannel] || parseInt(displayChannel.split('-')[1]);
                    channelMapping[displayChannel] = actualChannelId;
                }
            }
            
            console.log(`Creating channel client for IP ${ip} with mapping:`, channelMapping);
            
            const client = new NPA43AClient(ip, 8234, Object.keys(channelMapping).length > 0 ? channelMapping : null);
            
            // Set up event handlers for channel-specific client
            client.on('connected', () => {
                console.log(`🔗 Channel client connected to ${ip}`);
                client.startPolling(250);
            });

            client.on('disconnected', () => {
                console.log(`Channel client disconnected from ${ip}`);
            });

            client.on('data', (data) => {
                // Store the data for this IP
                const ipKey = ip;
                if (!this.channelClientData.has(ipKey)) {
                    this.channelClientData.set(ipKey, new Map());
                }
                const ipData = this.channelClientData.get(ipKey);
                
                const channelKey = `${data.channelType}-${data.channelId}`;
                ipData.set(channelKey, data);
                
                // Only broadcast data for channels that are assigned to this specific IP
                if (this.channelIPAssignments[channelKey] === ip) {
                    console.log(`📡 Channel client ${ip} broadcasting data for assigned channel: ${channelKey}`);
                    if (data.db !== undefined) {
                        this.broadcast({
                            type: 'audioData',
                            ...data
                        });
                    } else if (data.muted !== undefined) {
                        this.broadcast({
                            type: 'muteStatus',
                            channelType: data.channelType,
                            channelId: data.channelId,
                            muted: data.muted,
                            timestamp: data.timestamp
                        });
                    }
                } else {
                    console.log(`🚫 Channel client ${ip} blocking data for unassigned channel: ${channelKey}`);
                }
            });

            client.on('error', (err) => {
                console.error(`Channel client error for ${ip}:`, err.message);
                this.broadcast({
                    type: 'error',
                    message: `Channel monitoring error for ${ip}: ${err.message}`
                });
            });

            // Connect to the amplifier
            await client.connect();
            this.channelClients.set(ip, client);
            
            // Initialize data storage for this IP
            if (!this.channelClientData.has(ip)) {
                this.channelClientData.set(ip, new Map());
            }
            
            console.log(`✓ Channel client created and connected to ${ip}`);
            
        } catch (err) {
            console.error(`Failed to create channel client for ${ip}:`, err.message);
            this.broadcast({
                type: 'error',
                message: `Failed to connect to ${ip}: ${err.message}`
            });
        }
    }

    disconnectFromAmplifier() {
        if (this.amplifierClient) {
            this.amplifierClient.disconnect();
            this.amplifierClient = null;
            
            this.broadcastCurrentStatus();
        }
        
        // Disconnect all channel clients
        for (const [ip, client] of this.channelClients.entries()) {
            console.log(`Disconnecting channel client for ${ip}`);
            client.disconnect();
        }
        this.channelClients.clear();
        this.channelClientData.clear();
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
        
        // Ensure all channel clients are disconnected
        for (const [ip, client] of this.channelClients.entries()) {
            client.disconnect();
        }
        this.channelClients.clear();
        this.channelClientData.clear();
        
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
