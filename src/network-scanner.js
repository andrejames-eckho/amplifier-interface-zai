const net = require('net');
const os = require('os');
const { exec } = require('child_process');

class NetworkScanner {
    constructor() {
        this.targetPort = 8234;
        this.connectionTimeout = 500; // ms — closed ports fail in <5ms, so 500ms is plenty
    }

    /**
     * Get the local IPv4 addresses and their subnet masks
     */
    getLocalNetworkInterfaces() {
        const results = [];
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.family === 'IPv4') {
                    results.push({ address: iface.address, netmask: iface.netmask });
                }
            }
        }
        return results;
    }

    /**
     * Read the ARP cache to find link-local /24 subnets that actually have devices.
     * Uses `arp -an` (available on macOS and Linux).
     * Returns a Set of /24 network addresses like "169.254.5.0".
     */
    getArpCacheSubnets() {
        return new Promise((resolve) => {
            const isWindows = process.platform === 'win32';

            // Windows `arp -a` format:  "  192.168.1.1   aa-bb-cc-dd-ee-ff   dynamic"
            // macOS/Linux format:       "? (169.254.5.5) at c8:17:f5:74:95:8c on en10..."
            // Pre-filter incomplete entries at the shell level to avoid maxBuffer overflow.
            const command = isWindows
                ? 'arp -a | findstr /V "incomplete"'
                : "arp -an | grep -v '(incomplete)'";

            exec(command, (err, stdout) => {
                const subnets = new Set();
                if (err) {
                    console.warn('Could not read ARP cache:', err.message);
                    resolve(subnets);
                    return;
                }

                const classC_Mask = this.ipToInt('255.255.255.0');

                for (const line of stdout.split('\n')) {
                    let ip = null;

                    if (isWindows) {
                        // Windows: IP followed by MAC in aa-bb-cc format, then type
                        const m = line.match(/\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}-){5}[0-9a-f]{2}\s+(dynamic|static)/i);
                        if (!m) continue;
                        ip = m[1];
                    } else {
                        if (line.includes('(incomplete)')) continue; // safety net
                        const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
                        if (!m) continue;
                        ip = m[1];
                    }

                    const ipInt = this.ipToInt(ip);
                    const netAddr = (ipInt & classC_Mask) >>> 0;
                    subnets.add(this.intToIp(netAddr));
                }

                if (subnets.size > 0) {
                    console.log(`ARP cache found ${subnets.size} /24 subnet(s):`, [...subnets].join(', '));
                }
                resolve(subnets);
            });
        });
    }

    /**
     * Convert an IP address string to a 32-bit integer
     */
    ipToInt(ip) {
        return ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    /**
     * Convert a 32-bit integer to an IP address string
     */
    intToIp(int) {
        return [
            (int >>> 24) & 0xFF,
            (int >>> 16) & 0xFF,
            (int >>> 8) & 0xFF,
            int & 0xFF
        ].join('.');
    }

    /**
     * Generate all host IPs in a /24 subnet given the network address string (e.g. "169.254.5.0").
     */
    getClassCIPs(networkAddr) {
        const classC_Mask = this.ipToInt('255.255.255.0');
        const netInt = this.ipToInt(networkAddr);
        const bcastInt = (netInt | (~classC_Mask >>> 0)) >>> 0;
        const ips = [];
        for (let i = netInt + 1; i < bcastInt; i++) {
            ips.push(this.intToIp(i));
        }
        return ips;
    }

    /**
     * Test if a device is actually an amplifier by attempting a brief protocol handshake
     */
    async verifyAmplifier(ip) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000); // Longer timeout for amplifier protocol
            
            let resolved = false;
            let dataReceived = Buffer.alloc(0);
            
            const finish = (isAmplifier) => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(isAmplifier);
                }
            };

            socket.on('connect', () => {
                // Send a basic amplifier command to query device info
                const queryCommand = Buffer.from([
                    0xA5, 0xC3, 0x3C, 0x5A, // Start Header
                    0xFF,                   // Device ID (broadcast)
                    0x63,                   // Read Command
                    0x0E,                   // Function Code (Gains Level)
                    0x02,                   // Data Length
                    0x01,                   // Type (Input)
                    0x01,                   // Channel ID (1)
                    0xEE                    // End Header
                ]);
                
                socket.write(queryCommand);
                
                // Listen for response with amplifier protocol pattern
                const dataHandler = (data) => {
                    dataReceived = Buffer.concat([dataReceived, data]);
                    
                    // Check for amplifier protocol response pattern
                    if (dataReceived.length >= 8) {
                        // Look for start header: A5 C3 3C 5A
                        const startIndex = dataReceived.indexOf(Buffer.from([0xA5, 0xC3, 0x3C, 0x5A]));
                        if (startIndex !== -1 && dataReceived.length > startIndex + 8) {
                            // Check for valid function code and end header
                            const fc = dataReceived[startIndex + 6];
                            const validFC = fc === 0x0E || fc === 0x03 || fc === 0x12 || fc === 0x15;
                            const hasEndHeader = dataReceived[startIndex + dataReceived[startIndex + 7] + 8] === 0xEE;
                            
                            if (validFC && hasEndHeader) {
                                finish(true);
                                return;
                            }
                        }
                    }
                    
                    // If we've received enough data but no valid pattern, it's not an amplifier
                    if (dataReceived.length > 50) {
                        finish(false);
                    }
                };
                
                socket.on('data', dataHandler);
                
                // Timeout if no valid response received
                setTimeout(() => finish(false), 1500);
            });
            
            socket.on('timeout', () => finish(false));
            socket.on('error', () => finish(false));

            try {
                socket.connect(this.targetPort, ip);
            } catch (err) {
                finish(false);
            }
        });
    }

    /**
     * Test if a specific IP/port is reachable via multiple methods
     */
    async testConnection(ip) {
        const results = {
            tcp: false,
            ping: false,
            reachable: false
        };

        // Method 1: Try TCP connection first (fastest if device is active)
        results.tcp = await this.testTCPConnection(ip);
        
        // Method 2: If TCP fails, try ping to wake up dormant devices
        if (!results.tcp) {
            results.ping = await this.testPingConnection(ip);
            
            // After ping, try TCP again (device may now respond)
            if (results.ping) {
                // Wait a brief moment for device to respond
                await new Promise(resolve => setTimeout(resolve, 100));
                results.tcp = await this.testTCPConnection(ip);
            }
        }

        results.reachable = results.tcp || results.ping;
        return results;
    }

    /**
     * Test TCP connection to specific port
     */
    testTCPConnection(ip) {
        return new Promise((resolve) => {
            let resolved = false;
            const socket = new net.Socket();
            socket.setTimeout(this.connectionTimeout);

            const finish = (result) => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(result);
                }
            };

            socket.on('connect', () => finish(true));
            socket.on('timeout', () => finish(false));
            socket.on('error', () => finish(false));

            try {
                socket.connect(this.targetPort, ip);
            } catch (err) {
                finish(false);
            }
        });
    }

    /**
     * Test ping connectivity to wake up dormant devices
     */
    testPingConnection(ip) {
        return new Promise((resolve) => {
            const isWindows = process.platform === 'win32';
            const pingCmd = isWindows 
                ? `ping -n 1 -w 1000 ${ip}` 
                : `ping -c 1 -W 1000 ${ip}`;

            exec(pingCmd, { timeout: 2000 }, (error, stdout, stderr) => {
                // Consider ping successful if we get any response (even with some errors)
                const success = !error || (error && (
                    stdout.includes('TTL=') || 
                    stdout.includes('bytes from') ||
                    stderr.includes('TTL=') ||
                    (isWindows && error.code === 0) // Windows ping success
                ));
                resolve(success);
            });
        });
    }

    /**
     * Pre-scan ping to populate ARP cache and wake dormant devices
     */
    async preScanPing(subnetsToScan) {
        console.log('Pre-scanning subnets to populate ARP cache...');
        
        const pingPromises = [];
        const isWindows = process.platform === 'win32';
        
        for (const subnet of subnetsToScan) {
            // Ping a few strategic addresses in each subnet to populate ARP cache
            const strategicIPs = [
                this.intToIp(this.ipToInt(subnet) + 1),  // First usable IP
                this.intToIp(this.ipToInt(subnet) + 254) // Near end of subnet
            ];
            
            for (const ip of strategicIPs) {
                pingPromises.push(
                    new Promise(resolve => {
                        const pingCmd = isWindows 
                            ? `ping -n 1 -w 500 ${ip} >nul 2>&1` 
                            : `ping -c 1 -W 500 ${ip} >/dev/null 2>&1`;
                        
                        exec(pingCmd, { timeout: 1000 }, () => {
                            resolve(); // Don't care about result, just want to send ping
                        });
                    })
                );
            }
        }
        
        // Wait for all pings to complete (with timeout)
        await Promise.race([
            Promise.all(pingPromises),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        
        console.log('Pre-scan ping complete');
    }

    /**
     * Scan the local network for devices with the target port open.
     * Strategy:
     *  1. Pre-scan ping to populate ARP cache and wake dormant devices
     *  2. Read the ARP cache to find /24 blocks with known devices (fast, targeted).
     *  3. Also scan the local NIC's own /24 and common private subnets.
     *  4. Use TCP+ping testing for comprehensive discovery
     */
    async scanNetwork() {
        const networkInterfaces = this.getLocalNetworkInterfaces();

        if (networkInterfaces.length === 0) {
            console.error('Could not determine local network interfaces');
            return [];
        }

        // --- Build the set of /24 subnets to scan ---
        const subnetsToScan = new Set();
        const classC_Mask = this.ipToInt('255.255.255.0');

        // 1. Add each local NIC's own /24
        for (const iface of networkInterfaces) {
            const ifaceInt = this.ipToInt(iface.address);
            const netAddr = (ifaceInt & classC_Mask) >>> 0;
            subnetsToScan.add(this.intToIp(netAddr));
        }

        // 2. Add common private fallbacks
        subnetsToScan.add('192.168.1.0');
        subnetsToScan.add('192.168.0.0');
        subnetsToScan.add('10.0.0.0');

        // 3. Pre-scan ping to populate ARP cache
        await this.preScanPing(subnetsToScan);

        // 4. Add ARP-cache subnets (now that we've refreshed the cache)
        const arpSubnets = await this.getArpCacheSubnets();
        for (const s of arpSubnets) subnetsToScan.add(s);

        // --- Expand subnets into individual IPs ---
        const ipsSet = new Set();
        const ipsToScan = [];

        for (const subnet of subnetsToScan) {
            console.log(`  → Scanning subnet ${subnet}/24`);
            for (const ip of this.getClassCIPs(subnet)) {
                if (!ipsSet.has(ip)) {
                    ipsSet.add(ip);
                    ipsToScan.push(ip);
                }
            }
        }

        if (ipsToScan.length === 0) {
            console.warn('No IP addresses to scan.');
            return [];
        }

        console.log(`Scanning ${ipsToScan.length} unique IP addresses...`);

        // --- Concurrent TCP scan with ping fallback ---
        const concurrencyLimit = 100; // Reduced concurrency for ping operations
        const discoveredIPs = [];
        const pingedIPs = []; // Track which IPs we pinged
        let inFlight = 0;
        let currentIndex = 0;

        return new Promise((resolve) => {
            const nextBatch = () => {
                while (inFlight < concurrencyLimit && currentIndex < ipsToScan.length) {
                    const ip = ipsToScan[currentIndex++];
                    inFlight++;

                    this.testConnection(ip).then(async (results) => {
                        inFlight--;
                        
                        if (results.reachable) {
                            let discoveryMethod = 'TCP';
                            if (results.ping && !results.tcp) {
                                discoveryMethod = 'Ping';
                            } else if (results.ping && results.tcp) {
                                discoveryMethod = 'Ping+TCP';
                            }
                            
                            // Verify it's actually an amplifier (only if TCP connection succeeded)
                            let isAmplifier = false;
                            if (results.tcp) {
                                isAmplifier = await this.verifyAmplifier(ip);
                            }
                            
                            if (isAmplifier) {
                                console.log(`✓ Discovered amplifier at ${ip} (${discoveryMethod})`);
                                discoveredIPs.push(ip);
                            } else {
                                console.log(`- Device at ${ip} (${discoveryMethod}) - not an amplifier`);
                            }
                            
                            if (results.ping) {
                                pingedIPs.push(ip);
                            }
                        }

                        if (currentIndex >= ipsToScan.length && inFlight === 0) {
                            const summary = `Scan complete. Found ${discoveredIPs.length} amplifier(s)`;
                            if (pingedIPs.length > 0) {
                                console.log(`${summary} (${pingedIPs.length} required ping wake-up): ${pingedIPs.join(', ')}`);
                            } else {
                                console.log(summary);
                            }
                            resolve(discoveredIPs);
                        } else {
                            nextBatch();
                        }
                    }).catch(err => {
                        inFlight--;
                        console.warn(`Error testing ${ip}:`, err.message);
                        
                        if (currentIndex >= ipsToScan.length && inFlight === 0) {
                            console.log(`Scan complete. Found ${discoveredIPs.length} device(s).`);
                            resolve(discoveredIPs);
                        } else {
                            nextBatch();
                        }
                    });
                }

                if (currentIndex >= ipsToScan.length && inFlight === 0) {
                    console.log(`Scan complete. Found ${discoveredIPs.length} device(s).`);
                    resolve(discoveredIPs);
                }
            };

            nextBatch();
        });
    }
}

module.exports = new NetworkScanner();
