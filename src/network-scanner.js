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
     * Test if a specific IP/port is reachable via TCP connect
     */
    testConnection(ip) {
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
     * Scan the local network for devices with the target port open.
     * Strategy:
     *  1. Read the ARP cache to find /24 blocks with known devices (fast, targeted).
     *  2. Also scan the local NIC's own /24 and common private subnets.
     *  3. Skip the full 169.254.0.0/16 sweep — it's too slow due to ARP timeouts on macOS.
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

        // 1. Add ARP-cache subnets (fastest way to find link-local devices)
        const arpSubnets = await this.getArpCacheSubnets();
        for (const s of arpSubnets) subnetsToScan.add(s);

        // 2. Add each local NIC's own /24
        for (const iface of networkInterfaces) {
            const ifaceInt = this.ipToInt(iface.address);
            const netAddr = (ifaceInt & classC_Mask) >>> 0;
            subnetsToScan.add(this.intToIp(netAddr));
        }

        // 3. Add common private fallbacks
        subnetsToScan.add('192.168.1.0');
        subnetsToScan.add('192.168.0.0');
        subnetsToScan.add('10.0.0.0');

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

        // --- Concurrent TCP scan ---
        const concurrencyLimit = 200;
        const discoveredIPs = [];
        let inFlight = 0;
        let currentIndex = 0;

        return new Promise((resolve) => {
            const nextBatch = () => {
                while (inFlight < concurrencyLimit && currentIndex < ipsToScan.length) {
                    const ip = ipsToScan[currentIndex++];
                    inFlight++;

                    this.testConnection(ip).then((isReachable) => {
                        inFlight--;
                        if (isReachable) {
                            console.log(`Discovered device at ${ip}:${this.targetPort}`);
                            discoveredIPs.push(ip);
                        }

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
