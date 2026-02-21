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
        
        // External app management
        this.externalAppOpened = false;
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
        this.loadIPs();
        this.startConnectionStatusMonitoring();
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
        switch (data.type) {
            case 'status':
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
            case 'temperature':
                this.updateTemperature(data.amplifierIP, data.temperature);
                break;
            case 'amplifierInfo':
                this.updateAmplifierInfo(data.amplifierIP, data.info);
                break;
            case 'limiterStatus':
                this.updateLimiterStatus(data.amplifierIP, data.channelType, data.channelId, data.isLimiting);
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
                        <span class="amplifier-temperature" id="temperature-${panelId}">--°C</span>
                    </div>
                </div>
                <button class="close-panel-btn-top-right" data-ip="${ip}">×</button>
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
        const closeBtn = panel.querySelector('.close-panel-btn-top-right');
        closeBtn.addEventListener('click', () => this.removeAmplifierPanel(ip));
        
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
                segments: null, // Will be set after DOM is ready
                dbDisplay: panel.querySelector(`#input-${i}-${panelId}-db`)
            };
        }
        for (let i = 1; i <= 4; i++) {
            amplifierData.meters[`output-${i}`] = {
                bar: panel.querySelector(`#output-${i}-${panelId}-bar`),
                segments: null, // Will be set after DOM is ready
                dbDisplay: panel.querySelector(`#output-${i}-${panelId}-db`)
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
                    <div class="db-value-display" id="${type}-${i}-${panelId}-db">-∞ dB</div>
                    <div class="vu-meter">
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
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment green"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment yellow"></div>
                                <div class="vu-segment yellow"></div>
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
                        <div class="limiter-light-container">
                            <div class="limiter-light" id="${type}-${i}-${panelId}-limiter" title="${type === 'input' ? 'Clip' : 'Limiter'}">
                                <div class="limiter-led"></div>
                            </div>
                            <div class="limiter-label">${type === 'input' ? 'CLIP' : 'LIMIT'}</div>
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

    async openAutoScript(ip) {
        try {
            // Check if external app has already been opened
            if (this.externalAppOpened) {
                this.showError('External app is already open. Close all amplifier panels to reset.');
                return;
            }
            
            // Mark that the external app has been opened
            this.externalAppOpened = true;
            
            // Call the backend to open the external app (using existing endpoint)
            const response = await fetch('/api/open-external-app', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to open auto script');
            }
            
            console.log(`✅ Auto script opened for amplifier ${ip}`);
            
            // Update all auto script buttons to show opened state
            this.updateAutoScriptButtons();
            
        } catch (err) {
            console.error('❌ Failed to open auto script:', err);
            this.showError(err.message);
            // Reset the flag if opening failed
            this.externalAppOpened = false;
        }
    }

    updateAutoScriptButton(button) {
        if (this.externalAppOpened) {
            button.textContent = '📱';
            button.title = 'External app already open';
            button.style.opacity = '0.5';
            button.style.cursor = 'not-allowed';
        } else {
            button.textContent = '🚀';
            button.title = 'Open Auto Script';
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    }

    updateAutoScriptButtons() {
        // Update all auto script buttons in all panels
        this.amplifierPanels.forEach((panel, ip) => {
            const autoScriptBtn = panel.querySelector('.auto-script-btn');
            if (autoScriptBtn) {
                this.updateAutoScriptButton(autoScriptBtn);
            }
        });
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
        
        // Update vertical VU meter segments
        if (meter.bar) {
            const segments = meter.bar.querySelectorAll('.vu-segment');
            if (segments.length === 0) {
                // Initialize segments if not already done
                meter.segments = meter.bar.querySelectorAll('.vu-segment');
            }
            
            const clampedDb = Math.max(0, Math.min(120, dbValue));
            const segmentArray = meter.segments || segments;
            
            // Calculate how many segments should be lit based on dB value
            // 24-segment VU meter mapping: 0dB to +120dB (bottom to top)
            // Segments 0-15 (Green): 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75
            // Segments 16-19 (Yellow): 80, 85, 90, 95
            // Segments 20-23 (Red): 100, 105, 110, 120
            const segmentThresholds = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 120];
            
            let litSegments = 0;
            segmentArray.forEach((segment, index) => {
                const threshold = segmentThresholds[index];
                if (clampedDb >= threshold) {
                    segment.classList.add('active');
                    litSegments++;
                } else {
                    segment.classList.remove('active');
                }
            });
        }
        
        // Update dB value display
        if (meter.dbDisplay) {
            const displayValue = this.formatDbValue(dbValue);
            meter.dbDisplay.textContent = displayValue;
            
            // Apply color coding based on dB value
            this.updateDbDisplayColor(meter.dbDisplay, dbValue);
        }
    }

    updateDbDisplayColor(displayElement, dbValue) {
        let color;
        let bgColor;
        
        if (dbValue >= 100) {
            // Red for critical (+100dB and above)
            color = '#f44336';
            bgColor = 'rgba(244, 67, 54, 0.1)';
        } else if (dbValue >= 80) {
            // Yellow for warning (+80dB to +99dB)
            color = '#FF9800';
            bgColor = 'rgba(255, 152, 0, 0.1)';
        } else {
            // Green for normal (0dB to +79dB)
            color = '#4CAF50';
            bgColor = 'rgba(76, 175, 80, 0.1)';
        }
        
        displayElement.style.color = color;
        displayElement.style.background = bgColor;
        displayElement.style.border = `1px solid ${color}40`;
    }

    formatDbValue(dbValue) {
        // Handle very low values as -∞
        if (dbValue <= -70) {
            return '-∞ dB';
        }
        // Round to 1 decimal place
        return `${dbValue.toFixed(1)} dB`;
    }

    updateMeterColor(fillElement, dbValue) {
        let color;
        
        if (dbValue >= 100) {
            // Red for critical (+100dB and above)
            color = '#f44336';
        } else if (dbValue >= 80) {
            // Yellow for warning (+80dB to +99dB)
            color = '#FF9800';
        } else {
            // Green for normal (0dB to +79dB)
            color = '#4CAF50';
        }
        
        fillElement.style.background = `linear-gradient(to top, ${color} 0%, ${color} 100%)`;
    }

    updateCompactMeterColor(valueElement, dbValue) {
        let color;
        let bgColor;
        
        if (dbValue >= 100) {
            // Red for critical (+100dB and above)
            color = '#f44336';
            bgColor = 'rgba(244, 67, 54, 0.1)';
        } else if (dbValue >= 80) {
            // Yellow for warning (+80dB to +99dB)
            color = '#FF9800';
            bgColor = 'rgba(255, 152, 0, 0.1)';
        } else {
            // Green for normal (0dB to +79dB)
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

    updateLimiterStatus(amplifierIP, channelType, channelId, isLimiting) {
        const panel = this.amplifierPanels.get(amplifierIP);
        if (!panel) {
            return;
        }
        
        const panelId = `panel-${amplifierIP.replace(/\./g, '-')}`;
        const limiterLight = panel.querySelector(`#${channelType}-${channelId}-${panelId}-limiter`);
        
        if (limiterLight) {
            // Remove both classes first
            limiterLight.classList.remove('active', 'clip-active');
            
            if (isLimiting) {
                // Use different classes for input vs output
                if (channelType === 'input') {
                    limiterLight.classList.add('clip-active'); // Orange for clipping
                } else {
                    limiterLight.classList.add('active'); // Red for limiting
                }
            }
        }
    }

    updateTemperature(amplifierIP, temperature) {
        const panel = this.amplifierPanels.get(amplifierIP);
        if (!panel) {
            return;
        }
        
        const panelId = `panel-${amplifierIP.replace(/\./g, '-')}`;
        const tempElement = panel.querySelector(`#temperature-${panelId}`);
        
        if (tempElement) {
            // Format temperature to 1 decimal place
            const tempText = `${temperature.toFixed(1)}°C`;
            tempElement.textContent = tempText;
            
            // Apply color coding based on temperature thresholds
            tempElement.classList.remove('temp-normal', 'temp-warning', 'temp-critical');
            
            if (temperature >= 70) {
                tempElement.classList.add('temp-critical');
            } else if (temperature >= 50) {
                tempElement.classList.add('temp-warning');
            } else {
                tempElement.classList.add('temp-normal');
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
