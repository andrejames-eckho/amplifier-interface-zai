#!/usr/bin/env node

const net = require('net');

class NPA43ATemperatureTester {
    constructor(amplifierIP, port = 8234) {
        this.amplifierIP = amplifierIP;
        this.port = port;
        this.client = null;
        this.deviceId = 0xFF;
    }

    createTemperatureCommand() {
        return Buffer.from([
            0xA5, 0xC3, 0x3C, 0x5A, // Start Header
            this.deviceId,           // Device ID
            0x63,                   // Read Command
            0x12,                   // Function Code (Temperature)
            0x00,                   // Data Length
            0xEE                    // End Header
        ]);
    }

    parseTemperatureResponse(buffer) {
        if (buffer.length < 11) {
            throw new Error(`Temperature response too short: ${buffer.length} bytes`);
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
        if (buffer[6] !== 0x12) {
            throw new Error(`Invalid function code: 0x${buffer[6].toString(16)}`);
        }

        // Check data length
        const dataLength = buffer[7];
        if (dataLength !== 0x02) {
            throw new Error(`Invalid temperature data length: expected 2 bytes, got ${dataLength}`);
        }

        // Extract temperature data
        const tempLow = buffer[8];
        const tempHigh = buffer[9];
        
        // Combine bytes into signed 16-bit integer (little-endian)
        const rawTemp = tempLow | (tempHigh << 8);
        const signedTemp = rawTemp >= 0x8000 ? rawTemp - 0x10000 : rawTemp;
        
        // Calculate final temperature in Celsius (0.1°C per unit)
        const temperature = signedTemp * 0.1;
        
        return {
            temperature: temperature,
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

    async readTemperature() {
        return new Promise((resolve, reject) => {
            const command = this.createTemperatureCommand();
            console.log('\n=== Sending Temperature Command ===');
            console.log(`Hex: ${command.toString('hex').toUpperCase()}`);
            console.log(`Bytes: [${Array.from(command).join(', ')}]`);

            let responseBuffer = Buffer.alloc(0);

            const onData = (data) => {
                responseBuffer = Buffer.concat([responseBuffer, data]);
                
                // Try to parse when we have enough data
                if (responseBuffer.length >= 10) {
                    this.client.removeListener('data', onData);
                    this.client.removeListener('error', onError);
                    
                    try {
                        const result = this.parseTemperatureResponse(responseBuffer);
                        console.log('\n=== Temperature Response Received ===');
                        console.log(`Hex: ${result.rawHex}`);
                        console.log(`Temperature: ${result.temperature.toFixed(1)}°C`);
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
    
    const tester = new NPA43ATemperatureTester(amplifierIP);
    
    try {
        await tester.connect();
        
        // Test temperature reading
        await tester.readTemperature();
        
    } catch (error) {
        console.error('Temperature test failed:', error.message);
        process.exit(1);
    } finally {
        await tester.disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = NPA43ATemperatureTester;
