class AudioVisualizer {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
    }

    initializeElements() {
        // Connection elements
        this.amplifierIPInput = document.getElementById('amplifierIP');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        
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
    }

    bindEvents() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
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
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
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

    handleMessage(data) {
        switch (data.type) {
            case 'status':
                this.updateConnectionStatus(data.connected, data.amplifierIP);
                break;
            case 'audioData':
                this.updateMeter(data.channelType, data.channelId, data.db);
                break;
            case 'error':
                this.showError(data.message);
                break;
        }
    }

    updateConnectionStatus(connected, amplifierIP) {
        this.isConnected = connected;
        
        if (connected) {
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = `Connected to ${amplifierIP}`;
            this.connectBtn.disabled = true;
            this.disconnectBtn.disabled = false;
            this.amplifierIPInput.disabled = true;
        } else {
            this.statusIndicator.classList.remove('connected');
            this.statusText.textContent = 'Disconnected';
            this.connectBtn.disabled = false;
            this.disconnectBtn.disabled = true;
            this.amplifierIPInput.disabled = false;
            
            // Reset all meters to -60dB
            this.resetAllMeters();
        }
    }

    updateMeter(channelType, channelId, dbValue) {
        const channelKey = `${channelType}-${channelId}`;
        const meter = this.meters[channelKey];
        
        if (!meter) {
            console.error(`Unknown channel: ${channelKey}`);
            return;
        }
        
        // Clamp value to range -60 to +10
        const clampedDb = Math.max(-60, Math.min(10, dbValue));
        
        // Update numeric display
        meter.value.textContent = clampedDb.toFixed(1);
        
        // Calculate bar height (0% at -60dB, 100% at +10dB)
        const percentage = ((clampedDb + 60) / 70) * 100;
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
