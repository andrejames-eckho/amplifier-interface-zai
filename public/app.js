class AudioVisualizer {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.lastStatusUpdate = 0;
        this.connectionStatusCheckInterval = null;
        
        // Multi-amplifier support
        this.activeAmplifiers = new Map(); // Map of IP -> amplifier data
        this.amplifierPanels = new Map(); // Map of IP -> panel element
        
        // Screen capture state
        this.captureStates = new Map(); // Map of IP -> capture state
        
        // Auto-click state
        this.autoClickStates = new Map(); // Map of IP -> auto-click state
        
        // External app management
        this.externalAppOpened = false;
        
        // Initialize debug logging
        this.initDebugLog();
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
        this.loadIPs();
        this.startConnectionStatusMonitoring();
    }

    initDebugLog() {
        // Override console.log to also display in debug log
        const originalLog = console.log;
        const originalError = console.error;
        const debugLogContent = document.getElementById('debugLogContent');
        
        if (debugLogContent) {
            console.log = (...args) => {
                originalLog.apply(console, args);
                const message = args.join(' ');
                const timestamp = new Date().toLocaleTimeString();
                debugLogContent.innerHTML += `<div style="color: #00ff00;">[${timestamp}] ${message}</div>`;
                debugLogContent.scrollTop = debugLogContent.scrollHeight;
            };
            
            console.error = (...args) => {
                originalError.apply(console, args);
                const message = args.join(' ');
                const timestamp = new Date().toLocaleTimeString();
                debugLogContent.innerHTML += `<div style="color: #ff0000;">[${timestamp}] ERROR: ${message}</div>`;
                debugLogContent.scrollTop = debugLogContent.scrollHeight;
            };
        }
    }

    initializeElements() {
        // Sidebar elements
        this.sidebar = document.getElementById('sidebar');
        this.menuContent = document.getElementById('menuContent');
        this.ipCardsList = document.getElementById('ipCardsList');
        this.manageIPsFromMenu = document.getElementById('manageIPsFromMenu');
        
        // Connection elements
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        
        // Modal elements
        this.ipModal = document.getElementById('ipModal');
        this.closeModal = document.getElementById('closeModal');
        this.newIPInput = document.getElementById('newIP');
        this.newIPNameInput = document.getElementById('newIPName');
        this.addIPBtn = document.getElementById('addIPBtn');
        this.savedIPsList = document.getElementById('savedIPsList');
        
        // Amplifiers container
        this.amplifiersContainer = document.getElementById('amplifiersContainer');
        this.noAmplifiersMessage = document.getElementById('noAmplifiersMessage');
        
        // Error toast
        this.errorToast = document.getElementById('errorToast');
        this.errorMessage = document.getElementById('errorMessage');
        
        // IP management
        this.savedIPs = [];
        this.currentIP = null;
    }

    bindEvents() {
        // Sidebar events
        this.manageIPsFromMenu.addEventListener('click', () => this.openIPModal());
        this.closeModal.addEventListener('click', () => this.closeIPModal());
        this.addIPBtn.addEventListener('click', () => this.addNewIP());
        
        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === this.ipModal) {
                this.closeIPModal();
            }
        });
        
        // Allow Enter key to add IP
        this.newIPInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewIP();
            }
        });
        
        this.newIPNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewIP();
            }
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        console.log(`Connecting to WebSocket at ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.lastStatusUpdate = Date.now();
            this.loadIPs(); // Load IPs when WebSocket connects
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
                
                // Update last status update timestamp for monitoring
                if (data.type === 'status') {
                    this.lastStatusUpdate = Date.now();
                }
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.ws = null;
            
            // Attempt to reconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
            } else {
                this.showError('Lost connection to server. Please refresh the page.');
            }
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            this.showError('WebSocket connection error');
        };
    }

    startConnectionStatusMonitoring() {
        // Check if we're receiving status updates regularly
        this.connectionStatusCheckInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = now - this.lastStatusUpdate;
            
            // Only show warning if we're supposed to be connected but haven't received updates for 20 seconds
            if (timeSinceLastUpdate > 20000 && this.isConnected) {
                if (!this.statusIndicator.classList.contains('warning')) {
                    console.warn('⚠️ No status updates received for 20 seconds');
                    this.statusText.textContent = 'Connected (checking...)';
                    this.statusIndicator.classList.add('warning');
                }
            } else if (this.isConnected && this.statusIndicator.classList.contains('warning') && timeSinceLastUpdate < 20000) {
                // Clear warning state if we start receiving updates again
                this.statusIndicator.classList.remove('warning');
                this.statusText.textContent = `Connected to ${this.amplifierPanels.size} amplifier(s)`;
            }
        }, 10000); // Check every 10 seconds instead of 5
    }

    stopConnectionStatusMonitoring() {
        if (this.connectionStatusCheckInterval) {
            clearInterval(this.connectionStatusCheckInterval);
            this.connectionStatusCheckInterval = null;
        }
    }

    handleMessage(data) {
        console.log('📨 Frontend received message:', data);
        switch (data.type) {
            case 'status':
                console.log('🔄 Updating connection status to:', data.connected);
                this.connectedIPs = data.connectedIPs || [];
                this.updateConnectionStatus(data.connected);
                
                // Auto-create panels for newly connected amplifiers
                if (data.connected && this.connectedIPs.length > 0) {
                    this.connectedIPs.forEach(ip => {
                        const savedIP = this.savedIPs.find(savedIP => savedIP.ip === ip);
                        if (savedIP && !this.amplifierPanels.has(ip)) {
                            this.addAmplifierPanel(ip, savedIP.name || ip);
                        }
                    });
                }
                break;
            case 'audioData':
                this.updateMeter(data.amplifierIP, data.channelType, data.channelId, data.db);
                break;
            case 'muteStatus':
                this.updateMuteStatus(data.amplifierIP, data.channelType, data.channelId, data.muted);
                break;
            case 'amplifierInfo':
                this.updateAmplifierInfo(data.amplifierIP, data.info);
                break;
            case 'screenCapture':
                this.handleScreenCapture(data);
                break;
            case 'amplifierClicked':
                this.handleAmplifierClicked(data);
                break;
            case 'autoClickStarted':
                this.handleAutoClickStarted(data);
                break;
            case 'autoClickStopped':
                this.handleAutoClickStopped(data);
                break;
            case 'autoClickResult':
                this.handleAutoClickResult(data);
                break;
            case 'osdProStep':
                this.handleOsdProStep(data);
                break;
            case 'osdProCompleted':
                this.handleOsdProCompleted(data);
                break;
            case 'error':
                this.showError(data.message);
                break;
        }
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        
        if (connected) {
            this.statusIndicator.classList.remove('disconnected', 'warning');
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = `Connected to ${this.amplifierPanels.size} amplifier(s)`;
            
            // Clear any warning state when we get a status update
            this.statusIndicator.classList.remove('warning');
        } else {
            this.statusIndicator.classList.remove('connected', 'warning');
            this.statusIndicator.classList.add('disconnected');
            this.statusText.textContent = 'Disconnected';
        }
    }

    createAmplifierPanel(ip, name) {
        const panelId = `panel-${ip.replace(/\./g, '-')}`;
        const panel = document.createElement('div');
        panel.className = 'amplifier-panel';
        panel.id = panelId;
        panel.dataset.ip = ip;
        
        panel.innerHTML = `
            <div class="amplifier-header">
                <div class="amplifier-info">
                    <h3 class="amplifier-name">${name || ip}</h3>
                    <div class="amplifier-details">
                        <span class="amplifier-ip">Control IP: ${ip}</span>
                    </div>
                </div>
                <div class="amplifier-controls">
                    <button class="auto-script-btn" data-ip="${ip}" title="Open OSD PRO">🖥️</button>
                    <button class="close-panel-btn" data-ip="${ip}">×</button>
                </div>
            </div>
            
            <div class="amplifier-channels">
                <div class="channels-section">
                    <h4>Inputs</h4>
                    <div class="channels-grid input-channels">
                        ${this.createChannelMeters('input', ip, 4)}
                    </div>
                </div>
                
                <div class="channels-section">
                    <h4>Outputs</h4>
                    <div class="channels-grid output-channels">
                        ${this.createChannelMeters('output', ip, 4)}
                    </div>
                </div>
            </div>
        `;
        
        // Add close button event listener
        const closeBtn = panel.querySelector('.close-panel-btn');
        closeBtn.addEventListener('click', () => this.removeAmplifierPanel(ip));
        
        // Add OSD PRO button event listener
        const autoScriptBtn = panel.querySelector('.auto-script-btn');
        autoScriptBtn.addEventListener('click', () => this.openOSDPRO(ip));
        
        // Update button state
        this.updateOSDPROButton(autoScriptBtn);
        
        // Initialize capture state
        this.captureStates.set(ip, {
            isCapturing: false,
            isVisible: false, // Panels are now hidden
            lastCapture: null
        });
        
        // Initialize auto-click state
        this.autoClickStates.set(ip, {
            isAutoClicking: false,
            lastClick: null
        });
        
        // Store panel reference
        this.amplifierPanels.set(ip, panel);
        
        // Store amplifier data
        this.activeAmplifiers.set(ip, {
            ip: ip,
            name: name || ip,
            meters: {},
            info: {}
        });
        
        // Initialize meter references
        const amplifierData = this.activeAmplifiers.get(ip);
        for (let i = 1; i <= 4; i++) {
            amplifierData.meters[`input-${i}`] = {
                bar: panel.querySelector(`#input-${i}-${panelId}-bar`),
                segments: null // Will be set after DOM is ready
            };
        }
        for (let i = 1; i <= 4; i++) {
            amplifierData.meters[`output-${i}`] = {
                bar: panel.querySelector(`#output-${i}-${panelId}-bar`),
                segments: null // Will be set after DOM is ready
            };
        }
        
        return panel;
    }

    createChannelMeters(type, ip, count) {
        const panelId = `panel-${ip.replace(/\./g, '-')}`;
        let meters = '';
        
        for (let i = 1; i <= count; i++) {
            meters += `
                <div class="meter-container vertical" data-channel="${type}-${i}" data-amplifier="${ip}">
                    <div class="vu-meter">
                        <div class="vu-scale">
                            <div class="scale-label">+60</div>
                            <div class="scale-label">+50</div>
                            <div class="scale-label">+40</div>
                            <div class="scale-label">+30</div>
                            <div class="scale-label">+20</div>
                            <div class="scale-label">+10</div>
                            <div class="scale-label">+6</div>
                            <div class="scale-label">+3</div>
                            <div class="scale-label">0</div>
                            <div class="scale-label">-3</div>
                            <div class="scale-label">-6</div>
                            <div class="scale-label">-12</div>
                            <div class="scale-label">-18</div>
                            <div class="scale-label">-24</div>
                            <div class="scale-label">-30</div>
                            <div class="scale-label">-36</div>
                            <div class="scale-label">-42</div>
                            <div class="scale-label">-48</div>
                            <div class="scale-label">-54</div>
                            <div class="scale-label">-60</div>
                        </div>
                        <div class="vu-bar-container">
                            <div class="vu-bar" id="${type}-${i}-${panelId}-bar">
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment red"></div>
                                <div class="vu-segment red"></div>
                                <div class="vu-segment red"></div>
                                <div class="vu-segment red"></div>
                            </div>
                        </div>
                    </div>
                    <div class="meter-label">${type === 'input' ? 'IN' : 'OUT'} ${i}</div>
                    <button class="channel-mute-btn" data-channel="${type}-${i}" data-amplifier="${ip}" disabled>
                        <span class="mute-icon">🔊</span>
                    </button>
                </div>
            `;
        }
        
        return meters;
    }

    addAmplifierPanel(ip, name) {
        // Check if panel already exists
        if (this.amplifierPanels.has(ip)) {
            this.showError('Amplifier is already being displayed');
            return;
        }
        
        // Hide no amplifiers message
        if (this.noAmplifiersMessage) {
            this.noAmplifiersMessage.style.display = 'none';
        }
        
        // Create and add panel
        const panel = this.createAmplifierPanel(ip, name);
        this.amplifiersContainer.appendChild(panel);
        
        // Request connection to this amplifier
        this.connectToAmplifier(ip);
    }

    removeAmplifierPanel(ip) {
        const panel = this.amplifierPanels.get(ip);
        if (panel) {
            // Stop screen capture if it's running
            const captureState = this.captureStates.get(ip);
            if (captureState && captureState.isCapturing) {
                this.stopLiveCapture(ip);
            }
            
            // Stop auto-clicking if it's running
            const autoClickState = this.autoClickStates.get(ip);
            if (autoClickState && autoClickState.isAutoClicking) {
                this.stopAutoClick(ip);
            }
            
            panel.remove();
            this.amplifierPanels.delete(ip);
            this.activeAmplifiers.delete(ip);
            
            // Reset external app flag if no amplifiers are active (user likely closed external app too)
            if (this.amplifierPanels.size === 0) {
                this.externalAppOpened = false;
            }
            
            // Show no amplifiers message if no panels left
            if (this.amplifierPanels.size === 0 && this.noAmplifiersMessage) {
                this.noAmplifiersMessage.style.display = 'block';
            }
            
            // Disconnect from this amplifier
            this.disconnectFromAmplifier(ip);
        }
    }

    async connectToAmplifier(ip) {
        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to connect to amplifier');
            }
            
            console.log(`✅ Connected to amplifier ${ip}`);
            
        } catch (err) {
            console.error('❌ Failed to connect to amplifier:', err);
            this.showError(err.message);
        }
    }

    async disconnectFromAmplifier(ip) {
        try {
            const response = await fetch('/api/disconnect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to disconnect from amplifier');
            }
            
            console.log(`✅ Disconnected from amplifier ${ip}`);
            
        } catch (err) {
            console.error('❌ Failed to disconnect from amplifier:', err);
        }
    }

    async openOSDPRO(ip) {
        try {
            console.log(`🖥️ === OSD PRO BUTTON CLICKED ===`);
            console.log(`🖥️ Target IP: ${ip}`);
            
            // Check if external app has already been opened
            if (this.externalAppOpened) {
                console.log(`❌ OSD PRO already opened, blocking duplicate request`);
                this.showError('OSD PRO is already open. Close all amplifier panels to reset.');
                return;
            }
            
            // Mark that the external app has been opened
            this.externalAppOpened = true;
            console.log(`✅ External app flag set to true`);
            
            // Call the backend to open the external app
            console.log(`🌐 Calling backend to open OSD PRO...`);
            const response = await fetch('/api/open-external-app', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            console.log(`🌐 Backend response status: ${response.status}`);
            const result = await response.json();
            console.log(`🌐 Backend response: ${JSON.stringify(result)}`);
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to open OSD PRO');
            }
            
            console.log(`✅ OSD PRO opened for amplifier ${ip}`);
            
            // Update all OSD PRO buttons to show opened state
            this.updateOSDPROButtons();
            
            // Start the OSD PRO initiation sequence
            console.log(`🚀 Starting OSD PRO initiation sequence for ${ip}`);
            console.log('Starting OSD PRO initiation...');
            
            const initiateResponse = await fetch('/api/osd-pro-initiate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    ip: ip,
                    windowTitle: 'OSD PRO'
                })
            });
            
            console.log(`🌐 Initiate response status: ${initiateResponse.status}`);
            const initiateResult = await initiateResponse.json();
            console.log(`🌐 Initiate response: ${JSON.stringify(initiateResult)}`);
            
            if (!initiateResponse.ok) {
                throw new Error(initiateResult.error || 'Failed to initiate OSD PRO sequence');
            }
            
            console.log(`✅ OSD PRO initiation sequence started for ${ip}`);
            
            // Automatically start screen capture after OSD PRO opens
            console.log(`⏰ Setting up screen capture timer (2 seconds)...`);
            setTimeout(async () => {
                try {
                    console.log(`📸 === SCREEN CAPTURE TRIGGERED ===`);
                    console.log(`📸 Automatically starting screen capture for ${ip}`);
                    await this.startLiveCapture(ip);
                } catch (err) {
                    console.error('Failed to auto-start screen capture:', err);
                }
            }, 2000); // Wait 2 seconds for OSD PRO to fully load
            
            // Automatically start auto-clicking after screen capture starts
            console.log(`⏰ Setting up auto-click timer (5 seconds)...`);
            setTimeout(async () => {
                try {
                    console.log(`🔄 === AUTO-CLICK TRIGGERED ===`);
                    console.log(`🔄 Starting auto-click after 5 seconds delay for testing`);
                    await this.startAutoClick(ip);
                } catch (err) {
                    console.error('❌ Failed to start auto-click:', err);
                    this.showError(err.message);
                }
            }, 5000); // Reduced to 5 seconds for testing
            
            // Also test auto-click immediately for debugging
            console.log(`🧪 === IMMEDIATE AUTO-CLICK TEST ===`);
            setTimeout(async () => {
                try {
                    console.log(`🧪 Testing auto-click immediately after 1 second`);
                    await this.startAutoClick(ip);
                } catch (err) {
                    console.error('❌ Failed immediate auto-click test:', err);
                }
            }, 1000); // Test after 1 second
            
        } catch (err) {
            console.error('❌ Failed to open OSD PRO:', err);
            this.showError(err.message);
            // Reset the flag if opening failed
            this.externalAppOpened = false;
        }
    }

    updateOSDPROButton(button) {
        if (this.externalAppOpened) {
            button.textContent = '📱';
            button.title = 'OSD PRO already open';
            button.style.opacity = '0.5';
            button.style.cursor = 'not-allowed';
        } else {
            button.textContent = '🖥️';
            button.title = 'Open OSD PRO';
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    }

    updateOSDPROButtons() {
        // Update all OSD PRO buttons in all panels
        this.amplifierPanels.forEach((panel, ip) => {
            const autoScriptBtn = panel.querySelector('.auto-script-btn');
            if (autoScriptBtn) {
                this.updateOSDPROButton(autoScriptBtn);
            }
        });
    }

    // Screen capture methods

    async startLiveCapture(ip) {
        try {
            const response = await fetch('/api/capture/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    ip: ip, 
                    interval: 3000, // Capture every 3 seconds
                    windowTitle: 'OSD PRO'
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to start live capture');
            }
            
            console.log(`✅ Started live capture for ${ip}`);
            
            // Update UI state
            const captureState = this.captureStates.get(ip);
            if (captureState) {
                captureState.isCapturing = true;
            }
            
            console.log('Live capture started');
            
        } catch (err) {
            console.error('❌ Failed to start live capture:', err);
            this.showError(err.message);
            console.log('Failed to start capture');
        }
    }

    async stopLiveCapture(ip) {
        try {
            const response = await fetch('/api/capture/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip: ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to stop live capture');
            }
            
            console.log(`✅ Stopped live capture for ${ip}`);
            
            // Update UI state
            const captureState = this.captureStates.get(ip);
            if (captureState) {
                captureState.isCapturing = false;
            }
            
            console.log('Live capture stopped');
            
        } catch (err) {
            console.error('❌ Failed to stop live capture:', err);
            this.showError(err.message);
            console.log('Failed to stop capture');
        }
    }

    async captureSingle(ip) {
        try {
            console.log('Capturing...');
            
            const response = await fetch('/api/capture', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    windowTitle: 'OSD PRO',
                    resize: true,
                    maxWidth: 800,
                    maxHeight: 600
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to capture screen');
            }
            
            // Update capture state
            const captureState = this.captureStates.get(ip);
            if (captureState) {
                captureState.lastCapture = result.timestamp;
            }
            
            console.log(`Captured at ${new Date(result.timestamp).toLocaleTimeString()}`);
            
        } catch (err) {
            console.error('❌ Failed to capture screen:', err);
            this.showError(err.message);
            console.log('Capture failed');
        }
    }

    
    
    // Auto-click methods
    async clickAmplifierOnce(ip) {
        try {
            console.log(`👆 Attempting to click amplifier ${ip} - will try multiple coordinates to find '1.DP-43' device`);
            
            // Try multiple coordinates for the "1.DP-43" device
            const coordinates = [
                { x: 60, y: 160, description: "Initial guess" },
                { x: 80, y: 180, description: "Slightly right and down" },
                { x: 40, y: 140, description: "Slightly left and up" },
                { x: 100, y: 200, description: "Further right and down" },
                { x: 50, y: 120, description: "More left and up" }
            ];
            
            let success = false;
            let lastError = null;
            let successfulCoords = null;
            
            for (const coords of coordinates) {
                try {
                    console.log(`🎯 Trying single click at coordinates ${coords.x}, ${coords.y} (${coords.description})`);
                    
                    const response = await fetch('/api/click-amplifier', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ 
                            ip: ip,
                            windowTitle: 'OSD PRO',
                            x: coords.x, // Try specific X coordinate
                            y: coords.y  // Try specific Y coordinate
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok && result.success) {
                        console.log(`✅ Successfully clicked at coordinates (${coords.x}, ${coords.y})`);
                        success = true;
                        successfulCoords = coords;
                        
                        // Update auto-click state
                        const autoClickState = this.autoClickStates.get(ip);
                        if (autoClickState) {
                            autoClickState.lastClick = new Date().toISOString();
                        }
                        
                        console.log(`✅ Clicked on '1.DP-43' device at ${new Date(result.timestamp).toLocaleTimeString()}`);
                        
                        // Show visual feedback
                        this.showClickFeedback(ip, result);
                        break;
                    } else {
                        lastError = result.error || 'Unknown error';
                        console.log(`❌ Coordinates (${coords.x}, ${coords.y}) failed: ${lastError}`);
                    }
                } catch (err) {
                    lastError = err.message;
                    console.log(`❌ Coordinates (${coords.x}, ${coords.y}) error: ${lastError}`);
                }
            }
            
            if (!success) {
                throw new Error(`Failed to click at all coordinates. Last error: ${lastError}`);
            }
            
        } catch (err) {
            console.error('❌ Failed to click amplifier:', err);
            this.showError(err.message);
            console.log('Click failed');
        }
    }

    async startAutoClick(ip) {
        console.log(`🎯 === AUTO-CLICK START ===`);
        console.log(`🎯 Target IP: ${ip}`);
        try {
            console.log(`🔄 Starting auto-click for ${ip} - will try multiple coordinates to find '1.DP-43' device`);
            
            // Try multiple coordinates for the "1.DP-43" device
            const coordinates = [
                { x: 60, y: 160, description: "Initial guess" },
                { x: 80, y: 180, description: "Slightly right and down" },
                { x: 40, y: 140, description: "Slightly left and up" },
                { x: 100, y: 200, description: "Further right and down" },
                { x: 50, y: 120, description: "More left and up" }
            ];
            
            let success = false;
            let lastError = null;
            
            for (const coords of coordinates) {
                try {
                    console.log(`🎯 Trying coordinates ${coords.x}, ${coords.y} (${coords.description})`);
                    console.log(`🌐 Calling fetch to start auto-click...`);
                    
                    const requestBody = { 
                        ip: ip, 
                        interval: 15000, // Auto-click every 15 seconds
                        windowTitle: 'OSD PRO',
                        x: coords.x, // Try specific X coordinate
                        y: coords.y  // Try specific Y coordinate
                    };
                    
                    console.log(`🌐 Request body: ${JSON.stringify(requestBody)}`);
                    console.log(`🌐 IP value being sent: "${ip}" (type: ${typeof ip})`);
                    
                    const response = await fetch('/api/auto-click/start', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    
                    console.log(`🌐 Fetch response status: ${response.status}`);
                    const result = await response.json();
                    console.log(`🌐 Fetch response result: ${JSON.stringify(result)}`);
                    
                    if (response.ok && result.success) {
                        console.log(`✅ Successfully started auto-click at coordinates (${coords.x}, ${coords.y})`);
                        success = true;
                        
                        // Update UI state
                        const autoClickState = this.autoClickStates.get(ip);
                        if (autoClickState) {
                            autoClickState.isAutoClicking = true;
                        }
                        
                        console.log(`Auto-click started (${result.interval}ms interval) - Target: 1.DP-43 device at (${coords.x}, ${coords.y})`);
                        break;
                    } else {
                        lastError = result.error || 'Unknown error';
                        console.log(`❌ Coordinates (${coords.x}, ${coords.y}) failed: ${lastError}`);
                    }
                } catch (err) {
                    lastError = err.message;
                    console.log(`❌ Coordinates (${coords.x}, ${coords.y}) error: ${lastError}`);
                }
            }
            
            if (!success) {
                throw new Error(`Failed to start auto-click at all coordinates. Last error: ${lastError}`);
            }
            
        } catch (err) {
            console.error('❌ Failed to start auto-click:', err);
            this.showError(err.message);
            console.log('Failed to start auto-click');
        }
    }

    async stopAutoClick(ip) {
        try {
            const response = await fetch('/api/auto-click/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip: ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to stop auto-click');
            }
            
            console.log(`✅ Stopped auto-click for ${ip}`);
            
            // Update UI state
            const autoClickState = this.autoClickStates.get(ip);
            if (autoClickState) {
                autoClickState.isAutoClicking = false;
            }
            
            console.log('Auto-click stopped');
            
        } catch (err) {
            console.error('❌ Failed to stop auto-click:', err);
            this.showError(err.message);
            console.log('Failed to stop auto-click');
        }
    }

    
    
    showClickFeedback(ip, result) {
        // Create a temporary visual indicator showing where the click occurred
        const panel = this.amplifierPanels.get(ip);
        if (!panel) return;
        
        const feedback = document.createElement('div');
        feedback.className = 'click-feedback';
        feedback.innerHTML = `
            <div class="click-ripple"></div>
            <div class="click-info">Clicked at (${result.ClickX}, ${result.ClickY})</div>
        `;
        
        // Position the feedback at the click location (relative to the panel)
        feedback.style.position = 'absolute';
        feedback.style.left = '50%';
        feedback.style.top = '50%';
        feedback.style.transform = 'translate(-50%, -50%)';
        feedback.style.zIndex = '1000';
        
        panel.appendChild(feedback);
        
        // Remove the feedback after 2 seconds
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 2000);
    }

    
    handleAmplifierClicked(data) {
        const { amplifierIP, result } = data;
        
        // Update auto-click state
        const autoClickState = this.autoClickStates.get(amplifierIP);
        if (autoClickState) {
            autoClickState.lastClick = new Date().toISOString();
        }
        
        console.log(`Clicked at ${new Date(result.timestamp).toLocaleTimeString()}`);
        this.showClickFeedback(amplifierIP, result);
    }

    handleAutoClickStarted(data) {
        const { amplifierIP, interval } = data;
        
        // Update UI state
        const autoClickState = this.autoClickStates.get(amplifierIP);
        if (autoClickState) {
            autoClickState.isAutoClicking = true;
        }
        
        console.log(`Auto-click started (${interval}ms interval)`);
    }

    handleAutoClickStopped(data) {
        const { amplifierIP } = data;
        
        // Update UI state
        const autoClickState = this.autoClickStates.get(amplifierIP);
        if (autoClickState) {
            autoClickState.isAutoClicking = false;
        }
        
        console.log('Auto-click stopped');
    }

    handleAutoClickResult(data) {
        const { amplifierIP, result } = data;
        
        if (result.success) {
            console.log(`Auto-clicked at ${new Date(result.timestamp).toLocaleTimeString()}`);
            this.showClickFeedback(amplifierIP, result);
        } else {
            console.log(`Auto-click failed: ${result.error}`);
        }
    }

    handleOsdProStep(data) {
        const { amplifierIP, step, message, error, amplifiers } = data;
        
        console.log(`📍 OSD PRO Step ${step} for ${amplifierIP}: ${message}`);
        
        if (error) {
            console.log(`Step ${step} failed: ${error}`);
        } else if (amplifiers) {
            console.log(`Step ${step}: Found ${amplifiers.length} amplifiers`);
        } else {
            console.log(`Step ${step}: ${message}`);
        }
    }

    handleOsdProCompleted(data) {
        const { amplifierIP, message, clickResult, amplifierReadResult, connectResult } = data;
        
        console.log(`✅ OSD PRO sequence completed for ${amplifierIP}: ${message}`);
        console.log('OSD PRO sequence completed successfully!');
        
        // Show success notification
        this.showSuccessNotification(`Successfully connected to amplifier ${amplifierIP} in OSD PRO`);
    }

    showSuccessNotification(message) {
        // Create a temporary success notification
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-weight: 500;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        
        // Remove notification after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    updateMeter(amplifierIP, channelType, channelId, dbValue) {
        const amplifierData = this.activeAmplifiers.get(amplifierIP);
        if (!amplifierData) {
            return;
        }
        
        const channelKey = `${channelType}-${channelId}`;
        const meter = amplifierData.meters[channelKey];
        
        if (!meter) {
            console.error(`Unknown channel: ${channelKey} for amplifier ${amplifierIP}`);
            return;
        }
        
        // Clamp value to range -60 to +60
        const clampedDb = Math.max(-60, Math.min(60, dbValue));
        
        // Update vertical VU meter segments
        if (meter.bar) {
            const segments = meter.bar.querySelectorAll('.vu-segment');
            if (segments.length === 0) {
                // Initialize segments if not already done
                meter.segments = meter.bar.querySelectorAll('.vu-segment');
            }
            
            const segmentArray = meter.segments || segments;
            
            // Calculate how many segments should be lit based on dB value
            // Segment mapping (from bottom to top): -60, -54, -48, -42, -36, -30, -24, -18, -12, -6, -3, 0, +3, +6, +10, +20, +30, +40, +50, +60
            const segmentThresholds = [-60, -54, -48, -42, -36, -30, -24, -18, -12, -6, -3, 0, 3, 6, 10, 20, 30, 40, 50, 60];
            
            segmentArray.forEach((segment, index) => {
                const threshold = segmentThresholds[index];
                if (clampedDb >= threshold) {
                    segment.classList.add('active');
                } else {
                    segment.classList.remove('active');
                }
            });
        }
    }

    updateMeterColor(fillElement, dbValue) {
        let color;
        
        if (dbValue > 0) {
            // Red for clipping (> 0dB)
            color = '#f44336';
        } else if (dbValue > -6) {
            // Yellow for warning (-6dB to 0dB)
            color = '#FF9800';
        } else {
            // Green for normal (< -6dB)
            color = '#4CAF50';
        }
        
        fillElement.style.background = `linear-gradient(to top, ${color} 0%, ${color} 100%)`;
    }

    updateCompactMeterColor(valueElement, dbValue) {
        let color;
        let bgColor;
        
        if (dbValue > 0) {
            // Red for clipping (> 0dB)
            color = '#f44336';
            bgColor = 'rgba(244, 67, 54, 0.1)';
        } else if (dbValue > -6) {
            // Yellow for warning (-6dB to 0dB)
            color = '#FF9800';
            bgColor = 'rgba(255, 152, 0, 0.1)';
        } else {
            // Green for normal (< -6dB)
            color = '#4CAF50';
            bgColor = 'rgba(76, 175, 80, 0.1)';
        }
        
        valueElement.style.color = color;
        valueElement.style.background = bgColor;
        valueElement.style.border = `1px solid ${color}40`;
    }

    updateMuteStatus(amplifierIP, channelType, channelId, isMuted) {
        const panel = this.amplifierPanels.get(amplifierIP);
        if (!panel) {
            return;
        }
        
        const channelKey = `${channelType}-${channelId}`;
        const button = panel.querySelector(`[data-channel="${channelKey}"][data-amplifier="${amplifierIP}"]`);
        
        if (button) {
            const icon = button.querySelector('.mute-icon');
            if (isMuted) {
                button.classList.add('muted');
                icon.textContent = '🔇';
            } else {
                button.classList.remove('muted');
                icon.textContent = '🔊';
            }
        }
    }

    updateAmplifierInfo(amplifierIP, info) {
        const amplifierData = this.activeAmplifiers.get(amplifierIP);
        const panel = this.amplifierPanels.get(amplifierIP);
        
        if (!amplifierData || !panel) {
            return;
        }
        
        // Update stored info
        amplifierData.info = info;
        
        // Update display
        const modelElement = panel.querySelector('.amplifier-model');
        const presetElement = panel.querySelector('.amplifier-preset');
        const dataIPElement = panel.querySelector('.amplifier-data-ip');
        const volumeElement = panel.querySelector('.volume-value');
        const startStopBtn = panel.querySelector('.start-stop-btn');
        
        if (modelElement) modelElement.textContent = `Model: ${info.model || '--'}`;
        if (presetElement) presetElement.textContent = `Default Preset: ${info.preset || '--'}`;
        if (dataIPElement) dataIPElement.textContent = `IP: ${info.dataIP || '--'}`;
        if (volumeElement) volumeElement.textContent = info.volume || '0';
        if (startStopBtn) startStopBtn.textContent = info.isStarted ? 'OFF' : 'START';
    }

    async loadIPs() {
        try {
            const response = await fetch('/api/ips');
            const result = await response.json();
            
            if (response.ok) {
                this.savedIPs = result.ips || [];
                this.connectedIPs = result.connectedIPs || [];
                this.updateConnectionStatus(this.connectedIPs.length > 0);
                this.renderIPCards();
                
                // Automatically create panels for connected amplifiers
                this.connectedIPs.forEach(ip => {
                    const savedIP = this.savedIPs.find(savedIP => savedIP.ip === ip);
                    if (savedIP && !this.amplifierPanels.has(ip)) {
                        this.addAmplifierPanel(ip, savedIP.name || ip);
                    }
                });
            }
        } catch (err) {
            console.error('Failed to load IPs:', err);
        }
    }

    openIPModal() {
        this.ipModal.style.display = 'block';
        this.loadSavedIPs();
    }

    closeIPModal() {
        this.ipModal.style.display = 'none';
        this.newIPInput.value = '';
        this.newIPNameInput.value = '';
    }

    async addNewIP() {
        const ip = this.newIPInput.value.trim();
        const name = this.newIPNameInput.value.trim();
        
        if (!ip) {
            this.showError('IP address is required');
            return;
        }
        
        if (!this.isValidIP(ip)) {
            this.showError('Invalid IP address format');
            return;
        }
        
        try {
            this.addIPBtn.disabled = true;
            this.addIPBtn.textContent = 'Adding...';
            
            const response = await fetch('/api/ips', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip, name })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to add IP');
            }
            
            this.newIPInput.value = '';
            this.newIPNameInput.value = '';
            this.loadSavedIPs();
            this.loadIPs();
            
        } catch (err) {
            this.showError(err.message);
        } finally {
            this.addIPBtn.disabled = false;
            this.addIPBtn.textContent = 'Add';
        }
    }

    async loadSavedIPs() {
        try {
            const response = await fetch('/api/ips');
            const result = await response.json();
            
            if (response.ok) {
                this.savedIPs = result.ips || [];
                this.renderSavedIPs();
            }
        } catch (err) {
            console.error('Failed to load saved IPs:', err);
        }
    }

    renderSavedIPs() {
        this.savedIPsList.innerHTML = '';
        
        if (this.savedIPs.length === 0) {
            this.savedIPsList.innerHTML = '<div class="no-ips">No saved IP addresses</div>';
            return;
        }
        
        this.savedIPs.forEach(ip => {
            const ipItem = document.createElement('div');
            ipItem.className = 'ip-item';
            if (ip.ip === this.currentIP) {
                ipItem.classList.add('current-ip');
            }
            
            ipItem.innerHTML = `
                <div class="ip-info">
                    <div class="ip-name">${ip.name || ip.ip}</div>
                    <div class="ip-address">${ip.ip}</div>
                </div>
                <div class="ip-actions">
                    <button class="delete-btn" data-id="${ip.id}">Delete</button>
                </div>
            `;
            
            this.savedIPsList.appendChild(ipItem);
        });
        
        // Add delete event listeners
        this.savedIPsList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.deleteIP(id);
            });
        });
    }

    async deleteIP(id) {
        if (!confirm('Are you sure you want to delete this IP address?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/ips/${id}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to delete IP');
            }
            
            this.loadSavedIPs();
            this.loadIPs();
            
        } catch (err) {
            this.showError(err.message);
        }
    }

    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }

    renderIPCards() {
        this.ipCardsList.innerHTML = '';
        
        if (this.savedIPs.length === 0) {
            this.ipCardsList.innerHTML = '<div class="no-ips">No saved amplifiers</div>';
            return;
        }
        
        this.savedIPs.forEach(ip => {
            const ipCard = document.createElement('div');
            ipCard.className = 'ip-card';
            if (this.amplifierPanels.has(ip.ip)) {
                ipCard.classList.add('active');
            }
            
            const isConnected = this.connectedIPs && this.connectedIPs.includes(ip.ip);
            if (isConnected) {
                ipCard.classList.add('connected');
            }
            
            ipCard.innerHTML = `
                <div class="ip-card-header">
                    <div class="ip-card-name">${ip.name || ip.ip}</div>
                    <div class="ip-card-status">${this.amplifierPanels.has(ip.ip) ? 'Displayed' : (isConnected ? 'Connected' : 'Available')}</div>
                </div>
                <div class="ip-card-ip">${ip.ip}</div>
            `;
            
            ipCard.addEventListener('click', () => this.addAmplifierPanel(ip.ip, ip.name || ip.ip));
            this.ipCardsList.appendChild(ipCard);
        });
        
        // Update OSD PRO button states
        this.updateOSDPROButtons();
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorToast.classList.add('show');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    hideError() {
        this.errorToast.classList.remove('show');
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioVisualizer();
});

// Export for potential testing
window.AudioVisualizer = AudioVisualizer;
