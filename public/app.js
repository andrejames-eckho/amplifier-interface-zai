class AudioVisualizer {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.lastStatusUpdate = 0;
        this.connectionStatusCheckInterval = null;
        
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
        
        // Channel mute buttons
        this.channelMuteBtns = document.querySelectorAll('.channel-mute-btn');
        
        // Channel IP dropdowns
        this.channelIPDropdowns = document.querySelectorAll('.channel-ip-dropdown');
        
        // Error toast
        this.errorToast = document.getElementById('errorToast');
        this.errorMessage = document.getElementById('errorMessage');
        
        // Meter elements
        this.meters = {};
        for (let i = 1; i <= 4; i++) {
            this.meters[`input-${i}`] = {
                value: document.getElementById(`input-${i}-value`),
                bar: document.getElementById(`input-${i}-bar`),
                fill: document.querySelector(`#input-${i}-bar .meter-fill`)
            };
            this.meters[`output-${i}`] = {
                value: document.getElementById(`output-${i}-value`),
                bar: document.getElementById(`output-${i}-bar`),
                fill: document.querySelector(`#output-${i}-bar .meter-fill`)
            };
        }
        
        // Track mute states
        this.muteStates = {
            master: false,
            channels: {}
        };
        
        // IP management
        this.savedIPs = [];
        this.currentIP = null;
        
        // Channel IP assignments
        this.channelIPAssignments = {};
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
        
        // Channel IP dropdown change events
        this.channelIPDropdowns.forEach(dropdown => {
            console.log(`🎣 Binding change event to dropdown: ${dropdown.dataset.channel}`);
            dropdown.addEventListener('change', (e) => {
                console.log(`🎯 Change event fired on ${e.target.dataset.channel}, value: ${e.target.value}`);
                this.handleChannelIPChange(e.target.dataset.channel, e.target.value);
            });
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
                this.statusText.textContent = `Connected to ${this.currentIP || 'amplifier'}`;
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
                this.updateConnectionStatus(data.connected, data.amplifierIP);
                break;
            case 'audioData':
                this.updateMeter(data.channelType, data.channelId, data.db);
                break;
            case 'muteStatus':
                this.updateMuteStatus(data.channelType, data.channelId, data.muted);
                break;
            case 'error':
                this.showError(data.message);
                break;
        }
    }

    updateConnectionStatus(connected, amplifierIP) {
        this.isConnected = connected;
        
        if (connected) {
            this.statusIndicator.classList.remove('disconnected', 'warning');
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = `Connected to ${amplifierIP}`;
            this.channelMuteBtns.forEach(btn => btn.disabled = false);
            
            // Enable channel IP dropdowns when connected
            this.channelIPDropdowns.forEach(dropdown => dropdown.disabled = false);
            
            // Clear any warning state when we get a status update
            this.statusIndicator.classList.remove('warning');
        } else {
            this.statusIndicator.classList.remove('connected', 'warning');
            this.statusIndicator.classList.add('disconnected');
            this.statusText.textContent = 'Disconnected';
            this.channelMuteBtns.forEach(btn => btn.disabled = true);
            
            // Disable channel IP dropdowns when disconnected
            this.channelIPDropdowns.forEach(dropdown => dropdown.disabled = true);
            
            // Reset all meters to -60dB
            this.resetAllMeters();
            
            // Reset mute states
            this.resetMuteStates();
        }
    }

    async toggleMasterMute() {
        // Disabled - now an indicator only
        console.log('Master mute is now indicator only - use amplifier to control mute');
    }

    async toggleChannelMute(channel, button) {
        // Disabled - now indicator only
        console.log('Channel mute is now indicator only - use amplifier to control mute');
    }


    updateChannelMuteButton(button, isMuted) {
        const icon = button.querySelector('.mute-icon');
        if (isMuted) {
            button.classList.add('muted');
            icon.textContent = '🔇';
        } else {
            button.classList.remove('muted');
            icon.textContent = '🔊';
        }
    }

    resetMuteStates() {
        this.muteStates.master = false;
        this.muteStates.channels = {};
        
        // Reset all channel mute buttons and meter containers
        this.channelMuteBtns.forEach(btn => {
            btn.classList.remove('muted');
            btn.querySelector('.mute-icon').textContent = '🔊';
        });
        
        // Reset all meter container styling
        document.querySelectorAll('.meter-container.muted').forEach(container => {
            container.classList.remove('muted');
        });
    }

    updateMuteStatus(channelType, channelId, isMuted) {
        // Only update if we're connected to avoid race conditions
        if (!this.isConnected) {
            return;
        }
        
        // Handle master mute status
        if (channelType === 'output' && channelId === 0) {
            this.muteStates.master = isMuted;
            return;
        }
        
        const channelKey = `${channelType}-${channelId}`;
        
        // Update local mute state to match amplifier
        this.muteStates.channels[channelKey] = isMuted;
        
        // Find the corresponding button and update it
        const button = document.querySelector(`[data-channel="${channelKey}"]`);
        if (button) {
            this.updateChannelMuteButton(button, isMuted);
        }
        
        // Also update the meter container styling
        const meterContainer = document.querySelector(`.meter-container[data-channel="${channelKey}"]`);
        if (meterContainer) {
            if (isMuted) {
                meterContainer.classList.add('muted');
            } else {
                meterContainer.classList.remove('muted');
            }
        }
    }

    updateMeter(channelType, channelId, dbValue) {
        const channelKey = `${channelType}-${channelId}`;
        const meter = this.meters[channelKey];
        
        if (!meter) {
            console.error(`Unknown channel: ${channelKey}`);
            return;
        }
        
        // Clamp value to range -60 to +60
        const clampedDb = Math.max(-60, Math.min(60, dbValue));
        
        // Update numeric display
        meter.value.textContent = clampedDb.toFixed(1);
        
        // Calculate bar height (0% at -60dB, 100% at +60dB)
        const percentage = ((clampedDb + 60) / 120) * 100;
        meter.fill.style.height = `${Math.max(0, Math.min(100, percentage))}%`;
        
        // Update color based on level
        this.updateMeterColor(meter.fill, clampedDb);
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

    resetAllMeters() {
        Object.keys(this.meters).forEach(channelKey => {
            const meter = this.meters[channelKey];
            meter.value.textContent = '-60.0';
            meter.fill.style.height = '0%';
            meter.fill.style.background = 'linear-gradient(to top, #4CAF50 0%, #8BC34A 50%, #CDDC39 75%, #FF9800 90%, #f44336 100%)';
        });
    }

    async loadIPs() {
        try {
            const response = await fetch('/api/ips');
            const result = await response.json();
            
            if (response.ok) {
                this.savedIPs = result.ips || [];
                this.currentIP = result.currentIP;
                this.updateConnectionStatus(this.isConnected, this.currentIP);
                this.renderIPCards(); // Render cards in hamburger menu
                this.populateChannelIPDropdowns(); // Populate channel dropdowns
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
            this.loadIPs(); // Refresh the main dropdown and cards
            
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
            this.loadIPs(); // Refresh the main dropdown and cards
            
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
            if (ip.ip === this.currentIP) {
                ipCard.classList.add('active');
            }
            
            ipCard.innerHTML = `
                <div class="ip-card-header">
                    <div class="ip-card-name">${ip.name || ip.ip}</div>
                    <div class="ip-card-status">${ip.ip === this.currentIP ? 'Current' : 'Available'}</div>
                </div>
                <div class="ip-card-ip">${ip.ip}</div>
            `;
            
            ipCard.addEventListener('click', () => this.switchToIP(ip.ip));
            this.ipCardsList.appendChild(ipCard);
        });
    }

    async switchToIP(ip) {
        if (ip === this.currentIP) {
            return; // Already connected to this IP
        }
        
        try {
            // Show loading state
            const cards = this.ipCardsList.querySelectorAll('.ip-card');
            cards.forEach(card => {
                if (card.querySelector('.ip-card-ip').textContent === ip) {
                    card.style.opacity = '0.6';
                    card.style.pointerEvents = 'none';
                }
            });
            
            const response = await fetch('/api/switch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Switch failed');
            }
            
            this.currentIP = ip;
            this.renderIPCards();
            
        } catch (err) {
            this.showError(err.message);
            // Reset card states on error
            this.renderIPCards();
        }
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

    populateChannelIPDropdowns() {
        console.log(`🔄 Populating channel IP dropdowns...`);
        console.log(`📋 Available IPs:`, this.savedIPs);
        console.log(`🎛️ Found ${this.channelIPDropdowns.length} dropdowns`);
        
        this.channelIPDropdowns.forEach(dropdown => {
            const channel = dropdown.dataset.channel;
            console.log(`📍 Processing dropdown for channel: ${channel}`);
            
            // Clear existing options except the default
            dropdown.innerHTML = '<option value="">Default</option>';
            
            // Add saved IPs
            this.savedIPs.forEach(ip => {
                const option = document.createElement('option');
                option.value = ip.ip;
                option.textContent = `${ip.name || ip.ip} (${ip.ip})`;
                
                // Set as selected if this channel is assigned to this IP
                if (this.channelIPAssignments[channel] === ip.ip) {
                    option.selected = true;
                    console.log(`✅ Pre-selecting IP ${ip.ip} for channel ${channel}`);
                }
                
                dropdown.appendChild(option);
            });
            
            // Enable/disable based on connection status
            dropdown.disabled = !this.isConnected;
            console.log(`🔌 Dropdown ${channel} enabled: ${!dropdown.disabled}`);
        });
        
        console.log(`✅ Channel IP dropdowns populated`);
    }

    handleChannelIPChange(channel, selectedIP) {
        console.log(`🔄 Channel IP Change triggered: ${channel} -> ${selectedIP}`);
        console.log(`🔗 Connection status: ${this.isConnected}`);
        
        // Temporarily allow changes even when not connected for testing
        if (!this.isConnected) {
            console.log('⚠️ Not connected, but allowing change for testing');
            // return; // Commented out for testing
        }
        
        // Update the channel IP assignment
        if (selectedIP === '') {
            delete this.channelIPAssignments[channel];
            console.log(`Channel ${channel} reverted to default IP monitoring`);
        } else {
            this.channelIPAssignments[channel] = selectedIP;
            console.log(`Channel ${channel} assigned to monitor IP: ${selectedIP}`);
        }
        
        console.log(`📤 Sending assignment to server...`);
        // Send assignment to server
        this.sendChannelIPAssignment(channel, selectedIP);
    }

    async sendChannelIPAssignment(channel, ip) {
        try {
            console.log(`📡 Sending request: POST /api/channel-ip with body:`, { channel, ip });
            
            const response = await fetch('/api/channel-ip', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channel, ip })
            });
            
            console.log(`📥 Response status: ${response.status} ${response.statusText}`);
            
            const result = await response.json();
            console.log(`📥 Response data:`, result);
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to assign IP to channel');
            }
            
            console.log(`✅ Channel ${channel} IP assignment updated successfully`);
            
        } catch (err) {
            console.error('❌ Failed to update channel IP assignment:', err);
            this.showError(err.message);
            
            // Revert dropdown to previous state on error
            const dropdown = document.querySelector(`[data-channel="${channel}"]`);
            if (dropdown) {
                dropdown.value = this.channelIPAssignments[channel] || '';
            }
        }
    }
}

// Initialize the application when DOM is loaded

document.addEventListener('DOMContentLoaded', () => {
    new AudioVisualizer();
});

// Export for potential testing
window.AudioVisualizer = AudioVisualizer;
