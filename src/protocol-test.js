#!/usr/bin/env node

const net = require('net');

class NPA43AProtocolTester {
    constructor(amplifierIP, port = 8234) {
        this.amplifierIP = amplifierIP;
        this.port = port;
        this.client = null;
        this.deviceId = 0xFF;
    }

    createCommand(channelType, channelId) {
        const type = channelType === 'input' ? 0x01 : 0x02;
        const command = Buffer.from([
            0xA5, 0xC3, 0x3C, 0x5A, // Start Header
            this.deviceId,           // Device ID
            0x63,                   // Read Command
            0x0E,                   // Function Code (Gains Level)
            0x02,                   // Data Length
            type,                   // Type (Input/Output)
            channelId,              // Channel ID
            0xEE                    // End Header
        ]);
        return command;
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
            rawHex: buffer.toString('hex').toUpperCase()
        };
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to amplifier at ${this.amplifierIP}:${this.port}...`);
            
            this.client = new net.Socket();
            this.client.setTimeout(5000);

            this.client.connect(this.port, this.amplifierIP, () => {
                console.log('✓ Connected to amplifier');
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('✗ Connection error:', err.message);
                reject(err);
            });

            this.client.on('timeout', () => {
                console.error('✗ Connection timeout');
                this.client.destroy();
                reject(new Error('Connection timeout'));
            });
        });
    }

    async sendCommand(channelType, channelId) {
        return new Promise((resolve, reject) => {
            const command = this.createCommand(channelType, channelId);
            console.log(`\nSending command for ${channelType} ${channelId}:`);
            console.log(`Hex: ${command.toString('hex').toUpperCase()}`);

            let responseBuffer = Buffer.alloc(0);

            const onData = (data) => {
                responseBuffer = Buffer.concat([responseBuffer, data]);
                
                // Try to parse when we have enough data
                if (responseBuffer.length >= 12) {
                    this.client.removeListener('data', onData);
                    this.client.removeListener('error', onError);
                    
                    try {
                        const result = this.parseResponse(responseBuffer);
                        console.log('Response received:');
                        console.log(`Hex: ${result.rawHex}`);
                        console.log(`Channel: ${result.channelType} ${result.channelId}`);
                        console.log(`Level: ${result.db.toFixed(1)} dB`);
                        resolve(result);
                    } catch (err) {
                        console.error('✗ Parse error:', err.message);
                        reject(err);
                    }
                }
            };

            const onError = (err) => {
                this.client.removeListener('data', onData);
                reject(err);
            };

            this.client.on('data', onData);
            this.client.on('error', onError);
            
            this.client.write(command);
        });
    }

    async disconnect() {
        if (this.client) {
            this.client.destroy();
            console.log('\n✓ Disconnected from amplifier');
        }
    }
}

async function main() {
    // Get amplifier IP from command line or use default
    const amplifierIP = process.argv[2] || '192.168.1.100';
    
    const tester = new NPA43AProtocolTester(amplifierIP);
    
    try {
        await tester.connect();
        
        // Test Input 1 and Output 1 as specified in PRD
        console.log('\n=== Testing Input 1 ===');
        await tester.sendCommand('input', 1);
        
        console.log('\n=== Testing Output 1 ===');
        await tester.sendCommand('output', 1);
        
    } catch (error) {
        console.error('Test failed:', error.message);
        process.exit(1);
    } finally {
        await tester.disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = NPA43AProtocolTester;
