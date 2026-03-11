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
        this.scanNetworkBtn = document.getElementById('scanNetworkBtn');
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

        if (this.scanNetworkBtn) {
            this.scanNetworkBtn.addEventListener('click', () => this.scanNetwork());
        }

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
        panel.className = 'amplifier-panel ultra-compact';
        panel.id = panelId;
        panel.dataset.ip = ip;

        panel.innerHTML = `
        <div class="uc-header">
            <div class="uc-info">
                <h3 class="uc-name">${name || ip}</h3>
                <div class="uc-details">
                    <span class="uc-ip">IP: ${ip}</span>
                    <span class="uc-temp" id="temperature-${panelId}">--°C</span>
                </div>
            </div>
            <div class="uc-header-actions">
                <button class="close-panel-btn" data-ip="${ip}">×</button>
            </div>
        </div>
        
        <div class="uc-channels">
            <div class="uc-inputs">
                <span class="uc-label">IN</span>
                <div class="uc-meters-container">
                    ${this.createChannelMeters('input', ip, 4)}
                </div>
            </div>
            
            <div class="uc-outputs">
                <span class="uc-label">OUT</span>
                <div class="uc-meters-container">
                    ${this.createChannelMeters('output', ip, 4)}
                </div>
            </div>
        </div>
    `;

        // Add close button event listener
        const closeBtn = panel.querySelector('.close-panel-btn');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeAmplifierPanel(ip);
        });

        // Add inline renaming event listener
        const nameElement = panel.querySelector('.uc-name');
        nameElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNameEdit(ip, nameElement);
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
                bar: null, // Input channels don't have VU bars
                segments: null,
                dbDisplay: null // Input channels don't have dB displays
            };
        }
        for (let i = 1; i <= 4; i++) {
            amplifierData.meters[`output-${i}`] = {
                bar: panel.querySelector(`#output-${i}-${panelId}-bar`),
                segments: null, // Will be set after DOM is ready
                dbDisplay: null // Output channels don't have dB displays in compact mode
            };
        }

        return panel;
    }

    createChannelMeters(type, ip, count) {
        const panelId = `panel-${ip.replace(/\./g, '-')}`;
        let meters = '';

        for (let i = 1; i <= count; i++) {
            if (type === 'input') {
                meters += `
                <div class="uc-meter-box" data-channel="${type}-${i}" data-amplifier="${ip}">
                    <div class="uc-meter-top">
                        <span class="uc-ch-label">${i}</span>
                        <div class="uc-led" id="${type}-${i}-${panelId}-limiter" title="Clip"></div>
                    </div>
                    <button class="uc-mute-btn mute-icon" data-channel="${type}-${i}" data-amplifier="${ip}">🔊</button>
                </div>
            `;
            } else {
                meters += `
                <div class="uc-meter-box" data-channel="${type}-${i}" data-amplifier="${ip}">
                    <div class="uc-meter-top">
                        <span class="uc-ch-label">${i}</span>
                        <div class="uc-led" id="${type}-${i}-${panelId}-limiter" title="Limit"></div>
                    </div>
                    <div class="uc-vu-bar" id="${type}-${i}-${panelId}-bar">
                        ${Array(24).fill('<div class="vu-segment"></div>').join('')}
                    </div>
                    <button class="uc-mute-btn mute-icon" data-channel="${type}-${i}" data-amplifier="${ip}">🔊</button>
                </div>
            `;
            }
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

        // Update VU meter only for output channels (input channels don't have VU meters in compact mode)
        if (channelType === 'output' && meter.bar) {
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

        // dB value displays have been removed from compact interface
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

    updateMuteStatus(amplifierIP, channelType, channelId, isMuted) {
        const panel = this.amplifierPanels.get(amplifierIP);
        if (!panel) {
            return;
        }

        const channelKey = `${channelType}-${channelId}`;
        const button = panel.querySelector(`[data-channel="${channelKey}"][data-amplifier="${amplifierIP}"] .uc-mute-btn`) || panel.querySelector(`.uc-mute-btn[data-channel="${channelKey}"]`);

        if (button) {
            if (isMuted) {
                button.classList.add('muted');
                button.textContent = '🔇';
            } else {
                button.classList.remove('muted');
                button.textContent = '🔊';
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

    async scanNetwork() {
        if (!this.scanNetworkBtn) return;

        try {
            // Update UI state
            const originalText = this.scanNetworkBtn.textContent;
            this.scanNetworkBtn.textContent = 'Scanning...';
            this.scanNetworkBtn.disabled = true;
            this.scanNetworkBtn.classList.add('scanning');

            // Call the API
            const response = await fetch('/api/scan-network');
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Network scan failed');
            }

            if (result.ips && result.ips.length > 0) {
                let addedCount = 0;

                // Add each discovered IP that isn't already saved
                for (const ip of result.ips) {
                    const isAlreadySaved = this.savedIPs.some(saved => saved.ip === ip);

                    if (!isAlreadySaved) {
                        // Automatically add the discovered IP
                        const addResponse = await fetch('/api/ips', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                ip: ip,
                                name: `NPA Amp (${ip.split('.').pop()})`
                            })
                        });

                        if (addResponse.ok) {
                            addedCount++;
                        }
                    }
                }

                if (addedCount > 0) {
                    // Refresh the list if we added new IPs
                    await this.loadIPs();
                    this.loadSavedIPs();
                    // Show a success message briefly
                    this.scanNetworkBtn.textContent = `Added ${addedCount} device(s)!`;
                    setTimeout(() => {
                        this.scanNetworkBtn.textContent = originalText;
                    }, 3000);
                } else {
                    this.scanNetworkBtn.textContent = 'No new devices found';
                    setTimeout(() => {
                        this.scanNetworkBtn.textContent = originalText;
                    }, 3000);
                }
            } else {
                this.scanNetworkBtn.textContent = 'No devices found';
                setTimeout(() => {
                    this.scanNetworkBtn.textContent = originalText;
                }, 3000);
            }
        } catch (err) {
            console.error('Network scan error:', err);
            this.showError(err.message || 'Error scanning network');
            this.scanNetworkBtn.textContent = 'Scan Failed';
            setTimeout(() => {
                this.scanNetworkBtn.textContent = 'Scan Network';
            }, 3000);
        } finally {
            // Restore UI state
            this.scanNetworkBtn.disabled = false;
            this.scanNetworkBtn.classList.remove('scanning');
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
                    <button class="rename-btn" data-id="${ip.id}" data-name="${ip.name || ip.ip}">Rename</button>
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

        // Add rename event listeners
        this.savedIPsList.querySelectorAll('.rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                const name = e.target.dataset.name;
                this.renameIP(id, name);
            });
        });
    }

    async renameIP(id, currentName) {
        const newName = prompt('Enter a new name for this amplifier:', currentName);
        if (newName === null || newName.trim() === '' || newName === currentName) {
            return;
        }

        try {
            const response = await fetch(`/api/ips/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newName.trim() })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to rename amplifier');
            }

            // Update local state and UI
            this.loadSavedIPs();
            this.loadIPs();

            // Also update any active panels
            const renamedIP = this.savedIPs.find(ip => ip.id === id);
            if (renamedIP && this.amplifierPanels.has(renamedIP.ip)) {
                const panel = this.amplifierPanels.get(renamedIP.ip);
                const nameElement = panel.querySelector('.uc-name');
                if (nameElement) {
                    nameElement.textContent = newName.trim();
                }
                const ampData = this.activeAmplifiers.get(renamedIP.ip);
                if (ampData) {
                    ampData.name = newName.trim();
                }
            }

        } catch (err) {
            this.showError(err.message);
        }
    }

    toggleNameEdit(ip, nameElement) {
        if (nameElement.querySelector('input')) return;

        const currentName = nameElement.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'uc-name-input';
        
        nameElement.textContent = '';
        nameElement.appendChild(input);
        input.focus();
        input.select();

        const save = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                const savedIP = this.savedIPs.find(sip => sip.ip === ip);
                if (savedIP) {
                    await this.renameIP(savedIP.id, currentName, newName);
                }
            } else {
                nameElement.textContent = currentName;
            }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    }

    // Overload renameIP to handle both prompt and inline scenarios
    async renameIP(id, currentName, inlineNewName = null) {
        let newName = inlineNewName;
        if (newName === null) {
            newName = prompt('Enter a new name for this amplifier:', currentName);
        }

        if (newName === null || newName.trim() === '' || newName === currentName) {
            // Restore name if it was an inline edit that got cancelled
            const renamedIP = this.savedIPs.find(ip => ip.id === id);
            if (renamedIP && this.amplifierPanels.has(renamedIP.ip)) {
                const panel = this.amplifierPanels.get(renamedIP.ip);
                const nameElement = panel.querySelector('.uc-name');
                if (nameElement && nameElement.querySelector('input')) {
                    nameElement.textContent = currentName;
                }
            }
            return;
        }

        try {
            const response = await fetch(`/api/ips/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newName.trim() })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to rename amplifier');
            }

            // Update local state and UI
            this.loadSavedIPs();
            this.loadIPs();

            // Also update any active panels
            const renamedIP = this.savedIPs.find(ip => ip.id === id);
            if (renamedIP && this.amplifierPanels.has(renamedIP.ip)) {
                const panel = this.amplifierPanels.get(renamedIP.ip);
                const nameElement = panel.querySelector('.uc-name');
                if (nameElement) {
                    nameElement.textContent = newName.trim();
                }
                const ampData = this.activeAmplifiers.get(renamedIP.ip);
                if (ampData) {
                    ampData.name = newName.trim();
                }
            }

        } catch (err) {
            this.showError(err.message);
            // Restore name on error
            const renamedIP = this.savedIPs.find(ip => ip.id === id);
            if (renamedIP && this.amplifierPanels.has(renamedIP.ip)) {
                const panel = this.amplifierPanels.get(renamedIP.ip);
                const nameElement = panel.querySelector('.uc-name');
                if (nameElement) {
                    nameElement.textContent = currentName;
                }
            }
        }
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
