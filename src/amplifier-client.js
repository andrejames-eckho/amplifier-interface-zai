const net = require('net');
const EventEmitter = require('events');

class NPA43AClient extends EventEmitter {
    constructor(amplifierIP, port = 8234) {
        super();
        this.amplifierIP = amplifierIP;
        this.port = port;
        this.client = null;
        this.deviceId = 0xFF;
        this.isConnected = false;
        this.pollingInterval = null;
        this.currentChannelIndex = 0;
        
        // Define polling sequence: In1-4, Out1-4
        this.pollingSequence = [
            { type: 'input', id: 1 },
            { type: 'input', id: 2 },
            { type: 'input', id: 3 },
            { type: 'input', id: 4 },
            { type: 'output', id: 1 },
            { type: 'output', id: 2 },
            { type: 'output', id: 3 },
            { type: 'output', id: 4 }
        ];
    }

    createCommand(channelType, channelId) {
        const type = channelType === 'input' ? 0x01 : 0x02;
        return Buffer.from([
            0xA5, 0xC3, 0x3C, 0x5A, // Start Header
            this.deviceId,           // Device ID
            0x63,                   // Read Command
            0x0E,                   // Function Code (Gains Level)
            0x02,                   // Data Length
            type,                   // Type (Input/Output)
            channelId,              // Channel ID
            0xEE                    // End Header
        ]);
    }

    parseResponse(buffer) {
        if (buffer.length < 12) {
            throw new Error(`Response too short: ${buffer.length} bytes`);
        }

        // Validate headers
        if (buffer[0] !== 0xA5 || buffer[1] !== 0xC3 || 
            buffer[2] !== 0x3C || buffer[3] !== 0x5A) {
            throw new Error('Invalid start header');
        }

        if (buffer[buffer.length - 1] !== 0xEE) {
            throw new Error('Invalid end header');
        }

        // Validate function code
        if (buffer[6] !== 0x0E) {
            throw new Error(`Invalid function code: 0x${buffer[6].toString(16)}`);
        }

        // Extract data
        const type = buffer[8];
        const channelId = buffer[9];
        const dbLow = buffer[10];
        const dbHigh = buffer[11];

        // Combine bytes into signed 16-bit integer
        const value = (dbHigh << 8) | dbLow;
        const signedValue = value >= 0x8000 ? value - 0x10000 : value;
        
        // Calculate final dB value
        const dbValue = signedValue / 10;

        return {
            channelType: type === 0x01 ? 'input' : 'output',
            channelId: channelId,
            db: dbValue,
            timestamp: Date.now()
        };
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to amplifier at ${this.amplifierIP}:${this.port}...`);
            
            this.client = new net.Socket();
            this.client.setTimeout(5000);

            this.client.connect(this.port, this.amplifierIP, () => {
                this.isConnected = true;
                console.log('✓ Connected to amplifier');
                this.emit('connected');
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('✗ Connection error:', err.message);
                this.isConnected = false;
                this.emit('error', err);
                reject(err);
            });

            this.client.on('timeout', () => {
                console.error('✗ Connection timeout');
                this.isConnected = false;
                this.client.destroy();
                this.emit('error', new Error('Connection timeout'));
                reject(new Error('Connection timeout'));
            });

            this.client.on('close', () => {
                this.isConnected = false;
                console.log('Connection to amplifier closed');
                this.emit('disconnected');
                this.stopPolling();
            });

            this.client.on('data', (data) => {
                this.handleResponse(data);
            });
        });
    }

    handleResponse(buffer) {
        try {
            const result = this.parseResponse(buffer);
            console.log(`Received: ${result.channelType} ${result.channelId} = ${result.db.toFixed(1)} dB`);
            this.emit('data', result);
        } catch (err) {
            console.error('✗ Parse error:', err.message);
            this.emit('error', err);
        }
    }

    async sendCommand(channelType, channelId) {
        if (!this.isConnected || !this.client) {
            throw new Error('Not connected to amplifier');
        }

        const command = this.createCommand(channelType, channelId);
        this.client.write(command);
    }

    startPolling(intervalMs = 250) {
        if (this.pollingInterval) {
            this.stopPolling();
        }

        console.log(`Starting polling with ${intervalMs}ms interval`);
        
        const poll = async () => {
            if (!this.isConnected) {
                return;
            }

            try {
                const channel = this.pollingSequence[this.currentChannelIndex];
                await this.sendCommand(channel.type, channel.id);
                
                // Move to next channel
                this.currentChannelIndex = (this.currentChannelIndex + 1) % this.pollingSequence.length;
            } catch (err) {
                console.error('Polling error:', err.message);
                this.emit('error', err);
            }
        };

        // Start immediately
        poll();
        
        // Then set up interval
        this.pollingInterval = setInterval(poll, intervalMs);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('Polling stopped');
        }
    }

    createMuteCommand(channelType, channelId, mute = true) {
        let type, id;
        
        if (channelType === 'all-output') {
            type = 0x02;
            id = 0x00;
        } else if (channelType === 'input') {
            type = 0x01;
            id = channelId;
        } else if (channelType === 'output') {
            type = 0x02;
            id = channelId;
        } else {
            throw new Error(`Invalid channel type: ${channelType}`);
        }
        
        return Buffer.from([
            0xA5, 0xC3, 0x3C, 0x5A, // Start Header
            this.deviceId,           // Device ID
            0x36,                   // Write Command
            0x03,                   // Function Code (Mute)
            0x03,                   // Data Length
            0x03,                   // Fixed
            type,                   // Type (Input/Output)
            id,                     // Channel ID
            mute ? 0x01 : 0x00,     // Mute state (1=mute, 0=unmute)
            0xEE                    // End Header
        ]);
    }

    createMuteStatusCommand(channelType, channelId) {
        let type, id;
        
        if (channelType === 'input') {
            type = 0x01;
            id = channelId;
        } else if (channelType === 'output') {
            type = 0x02;
            id = channelId;
        } else {
            throw new Error(`Invalid channel type: ${channelType}`);
        }
        
        return Buffer.from([
            0xA5, 0xC3, 0x3C, 0x5A, // Start Header
            this.deviceId,           // Device ID
            0x63,                   // Read Command
            0x03,                   // Function Code (Mute Status)
            0x02,                   // Data Length
            type,                   // Type (Input/Output)
            id,                     // Channel ID
            0xEE                    // End Header
        ]);
    }

    async setMute(channelType, channelId, mute = true) {
        if (!this.isConnected || !this.client) {
            throw new Error('Not connected to amplifier');
        }

        const command = this.createMuteCommand(channelType, channelId, mute);
        this.client.write(command);
        
        console.log(`Sent ${mute ? 'mute' : 'unmute'} command for ${channelType}${channelId !== undefined ? ' ' + channelId : ''}`);
    }

    async getMuteStatus(channelType, channelId) {
        if (!this.isConnected || !this.client) {
            throw new Error('Not connected to amplifier');
        }

        const command = this.createMuteStatusCommand(channelType, channelId);
        this.client.write(command);
    }

    disconnect() {
        this.stopPolling();
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.isConnected = false;
    }
}

module.exports = NPA43AClient;
