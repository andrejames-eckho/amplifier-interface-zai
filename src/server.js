const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const NPA43AClient = require('./amplifier-client');
const ScreenCapture = require('./screen-capture');
const AutoClicker = require('./auto-clicker');

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
        
        // Screen capture functionality
        this.screenCapture = new ScreenCapture();
        this.captureIntervals = new Map(); // Map of IP -> capture interval
        
        // Auto-click functionality
        this.autoClicker = new AutoClicker();
        
        // Set global broadcast reference for auto-clicker
        global.broadcast = this.broadcast.bind(this);
        
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

        // API endpoint to open external app
        this.app.post('/api/open-external-app', express.json(), (req, res) => {
            const { ip } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            try {
                const { spawn } = require('child_process');
                
                // Path to OSD PRO.exe
                const exePath = path.join(__dirname, '../OSD PRO V2.8.77_DBG/OSD PRO.exe');
                
                // Check if the executable exists
                if (!fs.existsSync(exePath)) {
                    console.error(`OSD PRO.exe not found at: ${exePath}`);
                    return res.status(500).json({ error: 'OSD PRO.exe not found. Please ensure the OSD PRO V2.8.77_DBG folder contains OSD PRO.exe' });
                }
                console.log(`Attempting to open: ${exePath}`);
                // Open the executable on Windows
                const process = spawn(exePath, [], { 
                    detached: true,
                    stdio: 'ignore'
                });
                
                process.on('error', (err) => {
                    console.error('Failed to open external app:', err);
                    return res.status(500).json({ error: 'Failed to open external app: ' + err.message });
                });
                
                process.on('spawn', () => {
                    console.log(`✅ OSD PRO.exe opened for amplifier ${ip}`);
                    res.json({ success: true, message: 'OSD PRO.exe opened successfully' });
                });
                
                // Don't wait for the process to exit since it's detached
                process.unref();
                
            } catch (err) {
                console.error('Error opening external app:', err);
                res.status(500).json({ error: err.message });
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

        // API endpoint to capture screen
        this.app.post('/api/capture', express.json(), async (req, res) => {
            const { windowTitle, resize = true, maxWidth = 800, maxHeight = 600 } = req.body;
            
            try {
                // Check if window is open
                const isOpen = await this.screenCapture.isWindowOpen(windowTitle || 'OSD PRO');
                if (!isOpen) {
                    return res.status(404).json({ 
                        error: 'Window not found',
                        message: `Window with title containing "${windowTitle || 'OSD PRO'}" is not open`
                    });
                }

                // Capture the window
                let imageBuffer = await this.screenCapture.captureWindow(windowTitle || 'OSD PRO');
                
                // Resize for web if requested
                if (resize) {
                    imageBuffer = await this.screenCapture.resizeForWeb(imageBuffer, maxWidth, maxHeight);
                }
                
                // Convert to base64 for JSON response
                const base64Image = imageBuffer.toString('base64');
                
                res.json({
                    success: true,
                    image: `data:image/png;base64,${base64Image}`,
                    timestamp: new Date().toISOString(),
                    windowTitle: windowTitle || 'OSD PRO'
                });
                
            } catch (err) {
                console.error('Screen capture failed:', err);
                res.status(500).json({ 
                    error: 'Screen capture failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to start periodic capture
        this.app.post('/api/capture/start', express.json(), async (req, res) => {
            const { ip, interval = 5000, windowTitle } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            // Stop existing capture for this IP if any
            if (this.captureIntervals.has(ip)) {
                clearInterval(this.captureIntervals.get(ip));
            }

            try {
                // Start periodic capture
                const captureInterval = setInterval(async () => {
                    try {
                        const isOpen = await this.screenCapture.isWindowOpen(windowTitle || 'OSD PRO');
                        if (!isOpen) {
                            console.log(`Window not found for ${ip}, stopping capture`);
                            this.stopCapture(ip);
                            return;
                        }

                        let imageBuffer = await this.screenCapture.captureWindow(windowTitle || 'OSD PRO');
                        imageBuffer = await this.screenCapture.resizeForWeb(imageBuffer, 800, 600);
                        const base64Image = imageBuffer.toString('base64');
                        
                        // Broadcast captured image to all clients
                        this.broadcast({
                            type: 'screenCapture',
                            amplifierIP: ip,
                            image: `data:image/png;base64,${base64Image}`,
                            timestamp: new Date().toISOString(),
                            windowTitle: windowTitle || 'OSD PRO'
                        });
                        
                    } catch (err) {
                        console.error(`Periodic capture failed for ${ip}:`, err);
                        // Don't stop the interval on individual failures
                    }
                }, interval);

                this.captureIntervals.set(ip, captureInterval);
                
                res.json({
                    success: true,
                    message: `Started periodic capture for ${ip} every ${interval}ms`,
                    interval: interval
                });
                
            } catch (err) {
                console.error('Failed to start periodic capture:', err);
                res.status(500).json({ 
                    error: 'Failed to start periodic capture',
                    message: err.message 
                });
            }
        });

        // API endpoint to stop periodic capture
        this.app.post('/api/capture/stop', express.json(), (req, res) => {
            const { ip } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            const stopped = this.stopCapture(ip);
            
            res.json({
                success: true,
                message: stopped ? `Stopped periodic capture for ${ip}` : `No active capture for ${ip}`,
                ip: ip
            });
        });

        // API endpoint to check if window is open
        this.app.get('/api/window-check', async (req, res) => {
            const windowTitle = req.query.title || 'OSD PRO';
            
            try {
                const isOpen = await this.screenCapture.isWindowOpen(windowTitle);
                res.json({
                    isOpen: isOpen,
                    windowTitle: windowTitle,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.error('Window check failed:', err);
                res.status(500).json({ 
                    error: 'Window check failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to get process list
        this.app.get('/api/processes', async (req, res) => {
            try {
                const processes = await this.screenCapture.getProcessList();
                res.json({
                    processes: processes,
                    count: processes.length,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.error('Failed to get process list:', err);
                res.status(500).json({ 
                    error: 'Failed to get process list',
                    message: err.message 
                });
            }
        });

        // Serve captured images statically
        this.app.use('/captures', express.static(path.join(__dirname, '../captures')));

        // API endpoint to click on amplifier
        this.app.post('/api/click-amplifier', express.json(), async (req, res) => {
            const { ip, windowTitle, x, y } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            try {
                const result = await this.autoClicker.clickAmplifier(ip, windowTitle || 'OSD PRO', x, y);
                
                if (result.success) {
                    // Broadcast click result to all clients
                    this.broadcast({
                        type: 'amplifierClicked',
                        amplifierIP: ip,
                        result: result,
                        timestamp: new Date().toISOString()
                    });
                }
                
                res.json(result);
                
            } catch (err) {
                console.error('Click amplifier failed:', err);
                res.status(500).json({ 
                    error: 'Click amplifier failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to get window position and size
        this.app.post('/api/get-window-info', async (req, res) => {
            const { windowTitle } = req.body;

            if (!windowTitle) {
                return res.status(400).json({ success: false, error: 'Window title is required' });
            }

            try {
                const command = `
                    $window = Get-Process | Where-Object { $_.MainWindowTitle -like "*${windowTitle}*" }
                    if ($window) {
                        $bounds = $window.MainWindowHandle | Get-WinEvent | Select-Object -ExpandProperty Bounds
                        $info = @{
                            x = $bounds.Left;
                            y = $bounds.Top;
                            width = $bounds.Width;
                            height = $bounds.Height;
                        }
                        $info | ConvertTo-Json
                    } else {
                        Write-Output "{}"
                    }
                `;
                const result = await this.executePowerShell(command);
                const windowInfo = JSON.parse(result.trim());

                if (Object.keys(windowInfo).length > 0) {
                    res.json({ success: true, windowInfo });
                } else {
                    res.status(404).json({ success: false, error: `Window with title containing '${windowTitle}' not found.` });
                }
            } catch (error) {
                console.error('Error getting window info:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // API endpoint to start auto-click
        this.app.post('/api/auto-click/start', express.json(), async (req, res) => {
            console.log(`🎯 === AUTO-CLICK API CALLED ===`);
            console.log(`🎯 Request body: ${JSON.stringify(req.body)}`);
            console.log(`🎯 IP received: "${req.body.ip}" (type: ${typeof req.body.ip})`);
            
            const { ip, interval = 10000, windowTitle, x, y } = req.body;
            
            if (!ip) {
                console.log(`❌ IP validation failed - IP is null/undefined/empty`);
                return res.status(400).json({ error: 'IP address is required' });
            }
            
            console.log(`✅ IP validation passed - proceeding with auto-click for ${ip}`);

            try {
                const result = await this.autoClicker.startAutoClick(ip, interval, windowTitle || 'OSD PRO', x, y);
                
                if (result.success) {
                    // Broadcast auto-click start to all clients
                    this.broadcast({
                        type: 'autoClickStarted',
                        amplifierIP: ip,
                        interval: interval,
                        timestamp: new Date().toISOString()
                    });
                }
                
                res.json(result);
                
            } catch (err) {
                console.error('Start auto-click failed:', err);
                res.status(500).json({ 
                    error: 'Start auto-click failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to stop auto-click
        this.app.post('/api/auto-click/stop', express.json(), (req, res) => {
            const { ip } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            try {
                const stopped = this.autoClicker.stopAutoClick(ip);
                
                if (stopped) {
                    // Broadcast auto-click stop to all clients
                    this.broadcast({
                        type: 'autoClickStopped',
                        amplifierIP: ip,
                        timestamp: new Date().toISOString()
                    });
                }
                
                res.json({
                    success: true,
                    message: stopped ? `Stopped auto-click for ${ip}` : `No active auto-click for ${ip}`,
                    ip: ip,
                    stopped: stopped
                });
                
            } catch (err) {
                console.error('Stop auto-click failed:', err);
                res.status(500).json({ 
                    error: 'Stop auto-click failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to get auto-click status
        this.app.get('/api/auto-click/status', (req, res) => {
            try {
                const status = this.autoClicker.getAutoClickStatus();
                res.json({
                    status: status,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.error('Get auto-click status failed:', err);
                res.status(500).json({ 
                    error: 'Get auto-click status failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to detect amplifier position
        this.app.post('/api/detect-amplifier', express.json(), async (req, res) => {
            const { ip, windowTitle } = req.body;
            
            if (!ip) {
                return res.status(400).json({ error: 'IP address is required' });
            }

            try {
                const result = await this.autoClicker.detectAmplifierPosition(ip, windowTitle || 'OSD PRO');
                res.json(result);
            } catch (err) {
                console.error('Detect amplifier failed:', err);
                res.status(500).json({ 
                    error: 'Detect amplifier failed',
                    message: err.message 
                });
            }
        });

        // API endpoint to initiate OSD PRO connection sequence
        this.app.post('/api/osd-pro-initiate', express.json(), async (req, res) => {
            const { amplifierIP, windowTitle } = req.body;
            
            if (!amplifierIP) {
                return res.status(400).json({ error: 'Amplifier IP address is required' });
            }

            try {
                console.log(`🚀 Starting OSD PRO initiation sequence for ${amplifierIP}`);
                
                // Step 1: Click OSD PRO software once
                console.log('Step 1: Clicking OSD PRO software...');
                const clickResult = await this.autoClicker.clickOsdPro(windowTitle || 'OSD PRO');
                
                if (!clickResult.success) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to click OSD PRO',
                        message: clickResult.error || clickResult.message
                    });
                }
                
                // Broadcast step completion
                this.broadcast({
                    type: 'osdProStep',
                    amplifierIP: amplifierIP,
                    step: 1,
                    message: 'OSD PRO software clicked',
                    result: clickResult,
                    timestamp: new Date().toISOString()
                });
                
                // Step 2: Wait 10 seconds
                console.log('Step 2: Waiting 10 seconds for OSD PRO to load...');
                this.broadcast({
                    type: 'osdProStep',
                    amplifierIP: amplifierIP,
                    step: 2,
                    message: 'Waiting 10 seconds for OSD PRO to load amplifiers...',
                    timestamp: new Date().toISOString()
                });
                
                // Wait asynchronously
                setTimeout(async () => {
                    try {
                        // Step 3: Read connected amplifiers from OSD PRO software
                        console.log('Step 3: Reading connected amplifiers from OSD PRO...');
                        this.broadcast({
                            type: 'osdProStep',
                            amplifierIP: amplifierIP,
                            step: 3,
                            message: 'Reading connected amplifiers from OSD PRO...',
                            timestamp: new Date().toISOString()
                        });
                        
                        const amplifierReadResult = await this.autoClicker.readAmplifiersFromOsdPro(windowTitle || 'OSD PRO');
                        
                        if (!amplifierReadResult.success) {
                            this.broadcast({
                                type: 'osdProStep',
                                amplifierIP: amplifierIP,
                                step: 3,
                                message: 'Failed to read amplifiers from OSD PRO',
                                error: amplifierReadResult.error,
                                timestamp: new Date().toISOString()
                            });
                            
                            return res.status(500).json({
                                success: false,
                                error: 'Failed to read amplifiers from OSD PRO',
                                message: amplifierReadResult.error || amplifierReadResult.message
                            });
                        }
                        
                        this.broadcast({
                            type: 'osdProStep',
                            amplifierIP: amplifierIP,
                            step: 3,
                            message: `Detected amplifiers: ${amplifierReadResult.amplifiers.join(', ')}`,
                            amplifiers: amplifierReadResult.amplifiers,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Step 4: Connect to the amplifier used to open OSD PRO
                        console.log(`Step 4: Connecting to amplifier ${amplifierIP} in OSD PRO...`);
                        this.broadcast({
                            type: 'osdProStep',
                            amplifierIP: amplifierIP,
                            step: 4,
                            message: `Connecting to amplifier ${amplifierIP} in OSD PRO...`,
                            timestamp: new Date().toISOString()
                        });
                        
                        const connectResult = await this.autoClicker.connectToAmplifierInOsdPro(amplifierIP, windowTitle || 'OSD PRO');
                        
                        if (!connectResult.success) {
                            this.broadcast({
                                type: 'osdProStep',
                                amplifierIP: amplifierIP,
                                step: 4,
                                message: 'Failed to connect to amplifier in OSD PRO',
                                error: connectResult.error,
                                timestamp: new Date().toISOString()
                            });
                            
                            return res.status(500).json({
                                success: false,
                                error: 'Failed to connect to amplifier in OSD PRO',
                                message: connectResult.error || connectResult.message
                            });
                        }
                        
                        // Success!
                        this.broadcast({
                            type: 'osdProCompleted',
                            amplifierIP: amplifierIP,
                            message: `Successfully connected to amplifier ${amplifierIP} in OSD PRO`,
                            clickResult: clickResult,
                            amplifierReadResult: amplifierReadResult,
                            connectResult: connectResult,
                            timestamp: new Date().toISOString()
                        });
                        
                        console.log(`✅ Successfully completed OSD PRO initiation sequence for ${amplifierIP}`);
                        
                        res.json({
                            success: true,
                            message: `OSD PRO initiation sequence completed for ${amplifierIP}`,
                            steps: {
                                click: clickResult,
                                read: amplifierReadResult,
                                connect: connectResult
                            }
                        });
                        
                    } catch (err) {
                        console.error('OSD PRO initiation sequence failed:', err);
                        
                        this.broadcast({
                            type: 'osdProStep',
                            amplifierIP: amplifierIP,
                            step: 'error',
                            message: 'OSD PRO initiation sequence failed',
                            error: err.message,
                            timestamp: new Date().toISOString()
                        });
                        
                        res.status(500).json({
                            success: false,
                            error: 'OSD PRO initiation sequence failed',
                            message: err.message
                        });
                    }
                }, 10000); // 10 second wait
                
            } catch (err) {
                console.error('OSD PRO initiation failed:', err);
                res.status(500).json({ 
                    error: 'OSD PRO initiation failed',
                    message: err.message 
                });
            }
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
            // Stop capture for this amplifier
            this.stopCapture(amplifierIP);
        } else {
            // Disconnect all amplifiers
            for (const [ip, client] of this.amplifierClients.entries()) {
                console.log(`Disconnecting amplifier ${ip}`);
                client.disconnect();
            }
            this.amplifierClients.clear();
            // Stop all captures
            this.stopAllCaptures();
        }
        
        this.broadcastCurrentStatus();
    }

    stopCapture(ip) {
        if (this.captureIntervals.has(ip)) {
            clearInterval(this.captureIntervals.get(ip));
            this.captureIntervals.delete(ip);
            console.log(`Stopped screen capture for ${ip}`);
            return true;
        }
        return false;
    }

    stopAllCaptures() {
        for (const [ip, interval] of this.captureIntervals.entries()) {
            clearInterval(interval);
            console.log(`Stopped screen capture for ${ip}`);
        }
        this.captureIntervals.clear();
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
        this.stopAllCaptures();
        this.autoClicker.stopAllAutoClicks();
        
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
