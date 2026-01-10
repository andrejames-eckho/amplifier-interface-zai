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

        // API endpoint for bulk channel assignment when IP is selected from sidebar
        this.app.post('/api/bulk-assign', express.json(), (req, res) => {
            const { ip } = req.body;
            
            console.log(`\n=== BULK CHANNEL ASSIGNMENT ===`);
            console.log(`Assigning all channels to IP: ${ip}`);
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }
            
            // Validate IP format
            const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (!ipRegex.test(ip)) {
                return res.status(400).json({ error: 'Invalid IP address format' });
            }
            
            // Check if IP exists in saved list
            const savedIP = this.savedIPs.find(savedIP => savedIP.ip === ip);
            if (!savedIP) {
                return res.status(400).json({ error: 'IP address not found in saved list' });
            }
            
            // Assign all input and output channels (1-4) to this IP
            const channels = ['input-1', 'input-2', 'input-3', 'input-4', 'output-1', 'output-2', 'output-3', 'output-4'];
            
            channels.forEach(channel => {
                this.channelIPAssignments[channel] = ip;
                // Also assign channel numbers 1-4 to corresponding display channels
                const channelNumber = parseInt(channel.split('-')[1]);
                this.channelNumberAssignments[channel] = channelNumber;
            });
            
            console.log(`✓ Assigned all channels to IP ${ip}`);
            console.log('IP assignments:', this.channelIPAssignments);
            console.log('Channel number assignments:', this.channelNumberAssignments);
            
            // Save assignments to file
            this.saveChannelAssignments();
            
            // Update channel monitoring to apply new mappings
            this.updateChannelMonitoring();
            
            res.json({ 
                success: true, 
                message: `All channels assigned to ${savedIP.name || ip}`,
                channelIPAssignments: this.channelIPAssignments,
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
            
            // Validate channel format (input-1, input-2, output-1, output-2, etc.)
            const channelRegex = /^(input|output)-[1-4]$/;
            if (!channelRegex.test(channel)) {
                return res.status(400).json({ error: 'Invalid channel format. Must be input-1 through input-4 or output-1 through output-4' });
            }
            
            if (channelNumber && channelNumber !== '') {
                // Validate channel number if provided
                if (channelNumber < 1 || channelNumber > 4) {
                    return res.status(400).json({ error: 'Channel number must be between 1 and 4' });
                }
                
                // Assign channel number
                this.channelNumberAssignments[channel] = parseInt(channelNumber);
                console.log(`✓ Assigned channel number ${channelNumber} to display channel ${channel}`);
            } else {
                // Remove channel number assignment
                delete this.channelNumberAssignments[channel];
                console.log(`✓ Removed channel number assignment from display channel ${channel}`);
            }
            
            // Save assignments to file
            this.saveChannelAssignments();
            
            // Update channel monitoring to apply new channel number mappings
            this.updateChannelMonitoring();
            
            res.json({ 
                success: true, 
                message: channelNumber ? `Channel ${channel} assigned to amplifier channel ${channelNumber}` : `Channel ${channel} number assignment removed`,
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

            // Only create channel mapping for channels that are NOT assigned to specific IPs
            // and have explicit channel number assignments
            const channelMapping = {};
            for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                if (!assignedIP || assignedIP === '') {
                    // This display channel uses the default/main IP AND has a channel number assignment
                    if (this.channelNumberAssignments[displayChannel]) {
                        const actualChannelId = this.channelNumberAssignments[displayChannel];
                        channelMapping[displayChannel] = actualChannelId;
                    }
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
                
                // Check if all channels are assigned to the same IP
                const assignedIPs = Object.values(this.channelIPAssignments).filter(ip => ip && ip !== '');
                const uniqueIPs = [...new Set(assignedIPs)];
                const allChannelsAssignedToSameIP = uniqueIPs.length === 1 && assignedIPs.length === 8;
                
                let shouldBroadcast = false;
                
                if (allChannelsAssignedToSameIP) {
                    // All channels assigned to same IP - main client should broadcast if it's monitoring that IP
                    const mainIP = uniqueIPs[0];
                    if (mainIP === this.currentIP && this.channelIPAssignments[channelKey] === mainIP) {
                        shouldBroadcast = true;
                        console.log(`📡 Main client broadcasting data for bulk-assigned channel: ${channelKey} (IP: ${mainIP})`);
                    }
                } else {
                    // Mixed assignment case - only broadcast for unassigned channels
                    if (!this.channelIPAssignments[channelKey]) {
                        shouldBroadcast = true;
                        console.log(`📡 Main client broadcasting data for unassigned channel: ${channelKey}`);
                    }
                }
                
                if (shouldBroadcast) {
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
                    if (allChannelsAssignedToSameIP) {
                        console.log(`🚫 Main client blocking data for non-main channel: ${channelKey} (assigned to ${this.channelIPAssignments[channelKey]})`);
                    } else {
                        console.log(`🚫 Main client blocking data for assigned channel: ${channelKey} (assigned to ${this.channelIPAssignments[channelKey]})`);
                    }
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
        
        // Check if all channels are assigned to the same IP
        const assignedIPs = Object.values(this.channelIPAssignments).filter(ip => ip && ip !== '');
        const uniqueIPs = [...new Set(assignedIPs)];
        const allChannelsAssignedToSameIP = uniqueIPs.length === 1 && assignedIPs.length === 8; // 8 channels total
        
        console.log('Assigned IPs:', assignedIPs);
        console.log('Unique IPs:', uniqueIPs);
        console.log('All channels assigned to same IP:', allChannelsAssignedToSameIP);
        
        // Update main amplifier client if it exists
        if (this.amplifierClient && this.currentIP) {
            console.log('Updating main amplifier client with new channel mappings...');
            
            // Create new channel mapping for the main client
            const channelMapping = {};
            
            if (allChannelsAssignedToSameIP) {
                // All channels are assigned to the same IP - this IP should be the main monitoring IP
                const mainIP = uniqueIPs[0];
                if (mainIP === this.currentIP) {
                    // This IP is the main connection, so main client should handle all channels
                    for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                        if (assignedIP === mainIP && this.channelNumberAssignments[displayChannel]) {
                            const actualChannelId = this.channelNumberAssignments[displayChannel];
                            channelMapping[displayChannel] = actualChannelId;
                        }
                    }
                }
            } else {
                // Mixed assignment or default case - main client handles unassigned channels
                for (const [displayChannel, assignedIP] of Object.entries(this.channelIPAssignments)) {
                    if (!assignedIP || assignedIP === '') {
                        // This display channel uses the default/main IP AND has a channel number assignment
                        if (this.channelNumberAssignments[displayChannel]) {
                            const actualChannelId = this.channelNumberAssignments[displayChannel];
                            channelMapping[displayChannel] = actualChannelId;
                        }
                    }
                }
            }
            
            // Update the main client's channel mapping
            this.amplifierClient.channelMapping = Object.keys(channelMapping).length > 0 ? channelMapping : null;
            console.log('Main client updated with mapping:', channelMapping);
        }
        
        // Get all unique IPs that need to be monitored
        const requiredIPs = new Set();
        const ipToChannels = new Map(); // IP -> Set of channels
        
        if (allChannelsAssignedToSameIP) {
            // All channels assigned to same IP - only need to monitor that one IP
            const mainIP = uniqueIPs[0];
            requiredIPs.add(mainIP);
            ipToChannels.set(mainIP, new Set());
            
            // Add all channels to this IP's channel set
            for (const [channel, ip] of Object.entries(this.channelIPAssignments)) {
                if (ip === mainIP) {
                    ipToChannels.get(mainIP).add(channel);
                }
            }
        } else {
            // Mixed assignment case
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
                    // This display channel is assigned to this IP AND has a channel number assignment
                    if (this.channelNumberAssignments[displayChannel]) {
                        const actualChannelId = this.channelNumberAssignments[displayChannel];
                        channelMapping[displayChannel] = actualChannelId;
                    }
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
