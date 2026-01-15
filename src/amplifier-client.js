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
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 2000;
        this.reconnectInterval = null;
        this.lastDataReceived = 0;
        this.connectionTimeout = null;
        
        // Response caching to reduce redundant processing
        this.responseCache = new Map();
        this.cacheTimeout = 50; // ms
        
        // Data buffering for handling fragmented TCP responses
        this.dataBuffer = Buffer.alloc(0);
        
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

        // Validate function code - accept both gain level (0x0E) and mute (0x03)
        if (buffer[6] !== 0x0E && buffer[6] !== 0x03) {
            throw new Error(`Invalid function code: 0x${buffer[6].toString(16)}`);
        }

        // Extract data based on function code
        const functionCode = buffer[6];
        const dataLength = buffer[7]; // Use actual data length from response
        const type = buffer[8];
        const channelId = buffer[9];
        
        if (functionCode === 0x0E) {
            // Gain level response - parse dB data
            // Check if we have enough data for the dB value
            if (buffer.length < 10 + 2) {
                throw new Error(`Insufficient data for dB value: need ${10 + 2} bytes, got ${buffer.length}`);
            }
            
            const dbLow = buffer[10];
            const dbHigh = buffer[11];

            // Combine bytes into signed 16-bit integer
            const value = (dbHigh << 8) | dbLow;
            const signedValue = value >= 0x8000 ? value - 0x10000 : value;
            
            // Calculate final dB value
            const dbValue = signedValue / 10;

            // Map the actual amplifier channel back to display channel (1-4)
            const displayChannel = { type: type === 0x01 ? 'input' : 'output', id: channelId };

            return {
                channelType: displayChannel.type,
                channelId: displayChannel.id,
                db: dbValue,
                timestamp: Date.now()
            };
        } else if (functionCode === 0x03) {
            // Mute response - parse mute status
            if (buffer.length < 11) {
                throw new Error(`Insufficient data for mute status: need 11 bytes, got ${buffer.length}`);
            }
            
            const muteStatus = buffer[10];
            
            // Map the actual amplifier channel back to display channel (1-4)
            const displayChannel = { type: type === 0x01 ? 'input' : 'output', id: channelId };
            
            return {
                channelType: displayChannel.type,
                channelId: displayChannel.id,
                muted: muteStatus === 0x01,
                timestamp: Date.now()
            };
        } else {
            throw new Error(`Unsupported function code: 0x${functionCode.toString(16)}`);
        }
    }


    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to amplifier at ${this.amplifierIP}:${this.port}...`);
            
            this.client = new net.Socket();
            this.client.setTimeout(5000);

            this.client.connect(this.port, this.amplifierIP, () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.lastDataReceived = Date.now();
                console.log('✓ Connected to amplifier');
                this.emit('connected');
                this.startConnectionMonitoring();
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('✗ Connection error:', err.message);
                this.isConnected = false;
                this.emit('error', err);
                this.scheduleReconnect();
                reject(err);
            });

            this.client.on('timeout', () => {
                console.error('✗ Connection timeout');
                this.isConnected = false;
                this.client.destroy();
                this.emit('error', new Error('Connection timeout'));
                this.scheduleReconnect();
                reject(new Error('Connection timeout'));
            });

            this.client.on('close', () => {
                const wasConnected = this.isConnected;
                this.isConnected = false;
                console.log('Connection to amplifier closed');
                this.stopConnectionMonitoring();
                
                if (wasConnected) {
                    this.emit('disconnected');
                    this.scheduleReconnect();
                }
            });

            this.client.on('data', (data) => {
                this.lastDataReceived = Date.now();
                this.handleResponse(data);
            });
        });
    }

    startConnectionMonitoring() {
        // Check for data reception every 5 seconds
        this.connectionTimeout = setInterval(() => {
            const now = Date.now();
            const timeSinceLastData = now - this.lastDataReceived;
            
            if (timeSinceLastData > 10000) { // 10 seconds without data
                console.warn('⚠️ No data received for 10 seconds, connection may be stale');
                this.isConnected = false;
                this.emit('disconnected');
                this.scheduleReconnect();
            }
        }, 5000);
    }

    stopConnectionMonitoring() {
        if (this.connectionTimeout) {
            clearInterval(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    scheduleReconnect() {
        if (this.reconnectInterval) {
            return; // Already scheduled
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached');
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        const maxDelay = 30000; // Max 30 seconds
        const actualDelay = Math.min(delay, maxDelay);

        console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${actualDelay}ms`);

        this.reconnectInterval = setTimeout(async () => {
            this.reconnectInterval = null;
            
            try {
                await this.connect();
            } catch (err) {
                console.error('❌ Reconnection failed:', err.message);
            }
        }, actualDelay);
    }

    findCompleteMessages(buffer) {
        const messages = [];
        let offset = 0;
        
        // First try to find standard protocol messages
        while (offset < buffer.length) {
            // Need at least 9 bytes to determine message length
            if (offset + 9 > buffer.length) {
                break;
            }
            
            // Look for start header
            if (buffer[offset] === 0xA5 && buffer[offset + 1] === 0xC3 && 
                buffer[offset + 2] === 0x3C && buffer[offset + 3] === 0x5A) {
                
                // Get data length from byte 7
                const dataLength = buffer[offset + 7];
                const totalMessageLength = 8 + dataLength + 1; // 8 bytes header + data + 1 byte end header
                
                // Check if we have enough data for complete message
                if (offset + totalMessageLength <= buffer.length) {
                    // Check if end header is correct
                    if (buffer[offset + totalMessageLength - 1] === 0xEE) {
                        // Found a complete message
                        const message = buffer.slice(offset, offset + totalMessageLength);
                        messages.push(message);
                        offset = offset + totalMessageLength;
                    } else {
                        // Invalid end header, skip this start header
                        offset++;
                    }
                } else {
                    // Incomplete message, stop here
                    break;
                }
            } else {
                // Skip this byte, it's not a start header
                if (buffer[offset] === 0xA5) {
                    offset++; // Might be start of next message, check next byte
                } else {
                    offset++; // Skip this byte
                }
            }
        }
        
        // If no standard messages found, try to find any pattern that might be valid
        if (messages.length === 0 && buffer.length >= 12) {
            // Look for any segment that has plausible structure
            for (let i = 0; i <= buffer.length - 12; i++) {
                // Check for start header pattern
                if (i + 4 <= buffer.length && 
                    buffer[i] === 0xA5 && buffer[i + 1] === 0xC3 && 
                    buffer[i + 2] === 0x3C && buffer[i + 3] === 0x5A) {
                    
                    // Check function code
                    if (i + 6 < buffer.length && (buffer[i + 6] === 0x0E || buffer[i + 6] === 0x03)) {
                        // Look for end header within reasonable distance
                        for (let endPos = i + 11; endPos < Math.min(i + 20, buffer.length); endPos++) {
                            if (buffer[endPos] === 0xEE) {
                                const message = buffer.slice(i, endPos + 1);
                                if (message.length >= 12) { // Minimum reasonable size
                                    messages.push(message);
                                    break;
                                }
                            }
                        }
                        if (messages.length > 0) break; // Take the first plausible match
                    }
                }
            }
        }
        
        return { messages, remainingOffset: offset };
    }

    handleResponse(buffer) {
        // Append new data to buffer
        this.dataBuffer = Buffer.concat([this.dataBuffer, buffer]);
        
        // Find complete messages in buffer
        const { messages, remainingOffset } = this.findCompleteMessages(this.dataBuffer);
        
        // Process each complete message
        messages.forEach((message, index) => {
            try {
                console.log(`🔍 Processing message ${index + 1}:`, message.toString('hex').toUpperCase());
                const result = this.parseResponse(message);
                
                // Create cache key that includes actual values to detect real changes
                const valueKey = result.db !== undefined ? result.db.toFixed(1) : (result.muted ? '1' : '0');
                const cacheKey = `${result.channelType}-${result.channelId}-${valueKey}`;
                const now = Date.now();
                
                // Check cache to avoid duplicate processing of identical values
                const cached = this.responseCache.get(cacheKey);
                if (cached && (now - cached.timestamp) < this.cacheTimeout) {
                    return; // Skip duplicate response with same value
                }
                
                // Update cache
                this.responseCache.set(cacheKey, {
                    ...result,
                    timestamp: now
                });
                
                // Clean old cache entries
                if (this.responseCache.size > 32) { // Increased cache size for 8 channels
                    for (const [key, value] of this.responseCache.entries()) {
                        if (now - value.timestamp > this.cacheTimeout * 4) {
                            this.responseCache.delete(key);
                        }
                    }
                }
                
                console.log(`✅ Received: ${result.channelType} ${result.channelId} = ${result.db !== undefined ? result.db.toFixed(1) + ' dB' : (result.muted ? 'MUTED' : 'UNMUTED')}`);
                
                // Update connection status - if we're receiving data, we're connected
                if (!this.isConnected) {
                    console.log('🔗 Connection status updated based on data reception');
                    this.isConnected = true;
                    this.emit('connected');
                }
                
                this.emit('data', result);
            } catch (err) {
                console.error('❌ Parse error:', err.message);
                console.error('❌ Message that failed to parse:', message.toString('hex').toUpperCase());
                this.emit('error', err);
            }
        });
        
        // Keep remaining incomplete data in buffer
        if (remainingOffset < this.dataBuffer.length) {
            this.dataBuffer = this.dataBuffer.slice(remainingOffset);
        } else {
            this.dataBuffer = Buffer.alloc(0);
        }
        
        // Prevent buffer from growing too large (corruption protection)
        if (this.dataBuffer.length > 4096) {
            console.warn('⚠️  Buffer overflow, clearing data buffer');
            this.dataBuffer = Buffer.alloc(0);
        }
    }

    async sendCommand(channelType, channelId) {
        if (!this.isConnected || !this.client) {
            throw new Error('Not connected to amplifier');
        }

        return new Promise((resolve, reject) => {
            const command = this.createCommand(channelType, channelId);
            let timeout = null;
            
            // Create a unique response handler for this specific command
            const expectedResponseKey = `${channelType}-${channelId}`;
            let responseHandler = null;
            
            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (responseHandler) {
                    this.client.removeListener('data', responseHandler);
                    responseHandler = null;
                }
            };
            
            responseHandler = (data) => {
                // Use the global handler to process this data
                this.handleResponse(data);
                
                // Check if this response matches our expected channel
                // This is a bit of a hack - we'll resolve after a short delay
                // to let the global handler process the data
                setTimeout(() => {
                    // Look for a recent response that matches our expected channel
                    const recentResponses = Array.from(this.responseCache.entries())
                        .filter(([key, value]) => key.startsWith(expectedResponseKey))
                        .filter(([key, value]) => Date.now() - value.timestamp < 200);
                    
                    if (recentResponses.length > 0) {
                        const [, latestResponse] = recentResponses[recentResponses.length - 1];
                        cleanup();
                        resolve(latestResponse);
                    }
                }, 50);
            };
            
            const onError = (err) => {
                cleanup();
                reject(err);
            };
            
            // Set timeout for response
            timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Command timeout'));
            }, 1000);
            
            this.client.once('data', responseHandler);
            this.client.once('error', onError);
            this.client.write(command);
        });
    }

    async sendBatchCommands(commands) {
        if (!this.isConnected || !this.client) {
            throw new Error('Not connected to amplifier');
        }

        const promises = commands.map(cmd => this.sendCommand(cmd.type, cmd.id));
        return Promise.allSettled(promises);
    }

    startPolling(intervalMs = 100) {
        if (this.pollingInterval) {
            this.stopPolling();
        }

        console.log(`Starting polling with ${intervalMs}ms interval`);
        
        const poll = async () => {
            if (!this.isConnected) {
                return;
            }

            try {
                // Send commands for all channels (1-4 inputs and outputs)
                this.pollingSequence.forEach(channel => {
                    const command = this.createCommand(channel.type, channel.id);
                    this.client.write(command);
                });
                
                // Also poll mute status for all channels
                this.pollingSequence.forEach(channel => {
                    const muteCommand = this.createMuteStatusCommand(channel.type, channel.id);
                    this.client.write(muteCommand);
                });
                
                // Poll master mute status
                const masterMuteCommand = this.createMuteStatusCommand('all-output', null);
                this.client.write(masterMuteCommand);
                
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
        
        console.log(`\n=== SENDING MUTE COMMAND ===`);
        console.log(`Target: ${channelType}${channelId !== undefined ? ' ' + channelId : ''}`);
        console.log(`Action: ${mute ? 'MUTE' : 'UNMUTE'}`);
        console.log(`Hex: ${command.toString('hex').toUpperCase()}`);
        console.log(`Bytes: [${Array.from(command).join(', ')}]`);
        
        // Log each byte with meaning
        console.log(`Breakdown:`);
        console.log(`  Header: 0x${command.slice(0,4).toString('hex').toUpperCase()} (A5 C3 3C 5A)`);
        console.log(`  Device ID: 0x${command[4].toString(16).toUpperCase()} (${command[4]})`);
        console.log(`  Command: 0x${command[5].toString(16).toUpperCase()} (${command[5]} = Write)`);
        console.log(`  Function: 0x${command[6].toString(16).toUpperCase()} (${command[6]} = Mute)`);
        console.log(`  Length: 0x${command[7].toString(16).toUpperCase()} (${command[7]} bytes)`);
        console.log(`  Fixed: 0x${command[8].toString(16).toUpperCase()} (${command[8]})`);
        console.log(`  Type: 0x${command[9].toString(16).toUpperCase()} (${command[9]} = ${command[9] === 0x01 ? 'Input' : 'Output'})`);
        console.log(`  Channel ID: 0x${command[10].toString(16).toUpperCase()} (${command[10]})`);
        console.log(`  Mute State: 0x${command[11].toString(16).toUpperCase()} (${command[11]} = ${command[11] === 0x01 ? 'Mute' : 'Unmute'})`);
        console.log(`  End: 0x${command[12].toString(16).toUpperCase()} (EE)`);
        
        this.client.write(command);
        
        console.log(`✓ Command sent to amplifier at ${this.amplifierIP}:${this.port}`);
        console.log(`=== END MUTE COMMAND ===\n`);
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
        this.stopConnectionMonitoring();
        
        // Clear any pending reconnection
        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.dataBuffer = Buffer.alloc(0); // Clear buffer on disconnect
    }
}

module.exports = NPA43AClient;
