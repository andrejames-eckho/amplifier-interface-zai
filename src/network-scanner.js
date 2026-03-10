const net = require('net');
const os = require('os');

class NetworkScanner {
    constructor() {
        this.targetPort = 8234;
        this.connectionTimeout = 2000; // ms timeout for each connection attempt
    }

    /**
     * Get the local IPv4 addresses and their subnet masks
     */
    getLocalNetworkInterfaces() {
        const results = [];
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip internal loopback and non-IPv4 addresses
                if (!iface.internal && iface.family === 'IPv4') {
                    results.push({
                        address: iface.address,
                        netmask: iface.netmask,
                    });
                }
            }
        }
        return results;
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
     * Generate all IP addresses in the subnet
     */
    getSubnetIPs(networkInfo) {
        if (!networkInfo || !networkInfo.address || !networkInfo.netmask) {
            return [];
        }

        const ipInt = this.ipToInt(networkInfo.address);
        const maskInt = this.ipToInt(networkInfo.netmask);

        let networkAddress = (ipInt & maskInt) >>> 0;
        let broadcastAddress = (networkAddress | (~maskInt >>> 0)) >>> 0;

        const totalIPs = broadcastAddress - networkAddress - 1;

        const ips = [];

        if (totalIPs > 1024) {
            // If the subnet is huge (like a /16 with 65k IPs, e.g. 169.254.x.x), 
            // scanning all of them takes too long and may hit system limits.
            // Let's scan:
            // 1. the immediate /24 subnet of the interface
            // 2. common default fallback subnets (e.g. 192.168.1.x, 192.168.0.x)
            // 3. known active IP if available (e.g., 169.254.21.x based on user context)
            console.log(`Subnet is too large (${totalIPs} IPs). Optimizing scan range...`);

            // Add the local /24 subnet
            const localClassC_Mask = this.ipToInt('255.255.255.0');
            const localClassC_Network = (ipInt & localClassC_Mask) >>> 0;
            const localClassC_Broadcast = (localClassC_Network | (~localClassC_Mask >>> 0)) >>> 0;

            for (let i = localClassC_Network + 1; i < localClassC_Broadcast; i++) {
                ips.push(this.intToIp(i));
            }

            // Also search common class C subnets and 169.254.21.x just in case
            const extraSubnets = [
                '192.168.1.0',
                '192.168.0.0',
                '169.254.21.0' // Known subnet for the device
            ];

            for (const subnet of extraSubnets) {
                const subNetInt = this.ipToInt(subnet);
                const subBcastInt = (subNetInt | (~localClassC_Mask >>> 0)) >>> 0;

                for (let i = subNetInt + 1; i < subBcastInt; i++) {
                    const extraIp = this.intToIp(i);
                    if (!ips.includes(extraIp)) {
                        ips.push(extraIp);
                    }
                }
            }

            return ips;
        }

        // Standard logic for smaller subnets like /24
        // Start from networkAddress + 1 to broadcastAddress - 1
        for (let i = networkAddress + 1; i < broadcastAddress; i++) {
            ips.push(this.intToIp(i));
        }
        return ips;
    }

    /**
     * Test if a specific IP/port is reachable
     */
    testConnection(ip) {
        return new Promise((resolve) => {
            let resolved = false;

            const socket = new net.Socket();
            socket.setTimeout(this.connectionTimeout);

            const cleanup = () => {
                socket.destroy();
            };

            const finish = (result) => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(result);
                }
            };

            socket.on('connect', () => {
                finish(true);
            });

            socket.on('timeout', () => {
                finish(false);
            });

            socket.on('error', () => {
                finish(false);
            });

            try {
                socket.connect(this.targetPort, ip);
            } catch (err) {
                finish(false);
            }
        });
    }

    /**
     * Scan the local network for devices with the target port open
     */
    async scanNetwork() {
        const networkInterfaces = this.getLocalNetworkInterfaces();

        if (networkInterfaces.length === 0) {
            console.error('Could not determine local network interfaces');
            return [];
        }

        let ipsToScan = [];

        for (const networkInfo of networkInterfaces) {
            console.log(`Analyzing interface ${networkInfo.address} with mask ${networkInfo.netmask}`);
            const ips = this.getSubnetIPs(networkInfo);
            ipsToScan = ipsToScan.concat(ips);
        }

        // Remove duplicates just in case some subnets overlap
        ipsToScan = [...new Set(ipsToScan)];

        if (ipsToScan.length === 0) {
            console.warn('No IP addresses to scan.');
            return [];
        }

        console.log(`Scanning ${ipsToScan.length} unique IP addresses across all interfaces...`);

        // Define a reasonable concurrency limit to prevent ENFILE errors
        // 1000 is usually safe on macOS/Linux for file descriptors
        const concurrencyLimit = 500;
        const discoveredIPs = [];
        let inFlight = 0;
        let currentIndex = 0;

        return new Promise((resolve) => {
            const nextBatch = async () => {
                while (inFlight < concurrencyLimit && currentIndex < ipsToScan.length) {
                    const ip = ipsToScan[currentIndex++];
                    inFlight++;

                    this.testConnection(ip).then((isReachable) => {
                        inFlight--;
                        if (isReachable) {
                            console.log(`Discovered device at ${ip}:${this.targetPort}`);
                            discoveredIPs.push(ip);
                        }

                        // If we're done scanning and no requests are in flight, finish up
                        if (currentIndex >= ipsToScan.length && inFlight === 0) {
                            resolve(discoveredIPs);
                        } else {
                            nextBatch(); // Schedule next connection
                        }
                    });
                }

                // Edge case: if loop terminates naturally but ipsToScan is empty
                if (currentIndex >= ipsToScan.length && inFlight === 0) {
                    console.log(`Scan complete. Found ${discoveredIPs.length} devices.`);
                    resolve(discoveredIPs);
                }
            };

            // Start the scanning queue
            nextBatch();
        });
    }
}

module.exports = new NetworkScanner();
