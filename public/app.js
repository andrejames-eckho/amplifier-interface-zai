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
        this.startConnectionStatusMonitoring();
    }

    initializeElements() {
        // Connection elements
        this.amplifierIPInput = document.getElementById('amplifierIP');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        
        // Channel mute buttons
        this.channelMuteBtns = document.querySelectorAll('.channel-mute-btn');
        
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
    }

    bindEvents() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        // Channel mute buttons - disabled as indicators only
        // this.channelMuteBtns.forEach(btn => {
        //     btn.addEventListener('click', () => {
        //         const channel = btn.dataset.channel;
        //         this.toggleChannelMute(channel, btn);
        //     });
        // });
        
        // Allow Enter key to connect
        this.amplifierIPInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.connectBtn.disabled) {
                this.connect();
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
            
            // If we haven't received a status update in 15 seconds, show warning
            if (timeSinceLastUpdate > 15000 && this.isConnected) {
                console.warn('⚠️ No status updates received for 15 seconds');
                this.statusText.textContent = 'Connected (checking...)';
                this.statusIndicator.classList.add('warning');
            }
        }, 5000);
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
            this.statusIndicator.classList.remove('connected', 'warning');
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = `Connected to ${amplifierIP}`;
            this.connectBtn.disabled = true;
            this.disconnectBtn.disabled = false;
            this.amplifierIPInput.disabled = true;
            this.channelMuteBtns.forEach(btn => btn.disabled = false);
        } else {
            this.statusIndicator.classList.remove('connected', 'warning');
            this.statusText.textContent = 'Disconnected';
            this.connectBtn.disabled = false;
            this.disconnectBtn.disabled = true;
            this.amplifierIPInput.disabled = false;
            this.channelMuteBtns.forEach(btn => btn.disabled = true);
            
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

    async connect() {
        const amplifierIP = this.amplifierIPInput.value.trim();
        
        if (!amplifierIP) {
            this.showError('Please enter an amplifier IP address');
            return;
        }
        
        if (!this.isValidIP(amplifierIP)) {
            this.showError('Please enter a valid IP address');
            return;
        }
        
        try {
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connecting...';
            
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amplifierIP })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Connection failed');
            }
            
            console.log('Connection request sent successfully');
            
        } catch (err) {
            this.showError(err.message);
        } finally {
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Connect';
        }
    }

    async disconnect() {
        try {
            const response = await fetch('/api/disconnect', {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Disconnect failed');
            }
            
            console.log('Disconnect request sent successfully');
            
        } catch (err) {
            this.showError(err.message);
        }
    }

    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
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
