#!/usr/bin/env node

/**
 * Amplifier Audio Visualizer - Cross-platform Launcher
 * Enhanced startup script with better error handling and logging
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

// Configuration
const CONFIG = {
    APP_NAME: 'Amplifier Audio Visualizer',
    DEFAULT_PORT: 8080,
    MAX_PORT_ATTEMPTS: 10,
    NODE_MIN_VERSION: '14.0.0',
    LOG_FILE: path.join(__dirname, 'logs', 'app.log'),
    REQUIRED_FILES: ['package.json', 'src/server.js', 'public/index.html', 'public/app.js']
};

// Colors for console output
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Logging utilities
class Logger {
    constructor() {
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        const logDir = path.dirname(CONFIG.LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    log(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}`;
        
        // Console output with colors
        const colorMap = {
            INFO: COLORS.green,
            WARN: COLORS.yellow,
            ERROR: COLORS.red,
            DEBUG: COLORS.cyan
        };
        
        const color = colorMap[level] || COLORS.reset;
        console.log(`${color}[${level}]${COLORS.reset} ${message}`, ...args);
        
        // File output (without colors)
        fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n');
    }

    info(message, ...args) {
        this.log('INFO', message, ...args);
    }

    warn(message, ...args) {
        this.log('WARN', message, ...args);
    }

    error(message, ...args) {
        this.log('ERROR', message, ...args);
    }

    debug(message, ...args) {
        if (process.env.DEBUG) {
            this.log('DEBUG', message, ...args);
        }
    }
}

const logger = new Logger();

// Utility functions
class Utils {
    static async checkCommand(command) {
        return new Promise((resolve) => {
            exec(`which ${command}`, (error) => {
                resolve(!error);
            });
        });
    }

    static async getNodeVersion() {
        return new Promise((resolve, reject) => {
            exec('node --version', (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim().replace('v', ''));
                }
            });
        });
    }

    static async getNpmVersion() {
        return new Promise((resolve, reject) => {
            exec('npm --version', (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    static compareVersions(version1, version2) {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part > v2Part) return 1;
            if (v1Part < v2Part) return -1;
        }
        
        return 0;
    }

    static async isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = http.createServer();
            
            server.listen(port, () => {
                server.once('close', () => resolve(true));
                server.close();
            });
            
            server.on('error', () => resolve(false));
        });
    }

    static async findAvailablePort(startPort, maxAttempts = CONFIG.MAX_PORT_ATTEMPTS) {
        for (let i = 0; i < maxAttempts; i++) {
            const port = startPort + i;
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error(`No available ports found from ${startPort} to ${startPort + maxAttempts - 1}`);
    }

    static checkRequiredFiles() {
        const missing = CONFIG.REQUIRED_FILES.filter(file => !fs.existsSync(path.join(__dirname, file)));
        
        if (missing.length > 0) {
            throw new Error(`Missing required files: ${missing.join(', ')}`);
        }
    }
}

// Main application class
class AmplifierLauncher {
    constructor() {
        this.serverProcess = null;
        this.port = CONFIG.DEFAULT_PORT;
        this.isShuttingDown = false;
        
        this.setupSignalHandlers();
    }

    setupSignalHandlers() {
        const shutdown = (signal) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;
            
            logger.info(`Received ${signal}, shutting down gracefully...`);
            
            if (this.serverProcess) {
                this.serverProcess.kill('SIGTERM');
            }
            
            setTimeout(() => {
                logger.info('Goodbye!');
                process.exit(0);
            }, 2000);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    async checkPrerequisites() {
        logger.info('Checking system prerequisites...');
        
        // Check Node.js
        const hasNode = await Utils.checkCommand('node');
        if (!hasNode) {
            throw new Error('Node.js is not installed. Please install Node.js ' + CONFIG.NODE_MIN_VERSION + ' or higher.\nVisit: https://nodejs.org/');
        }

        const nodeVersion = await Utils.getNodeVersion();
        if (Utils.compareVersions(nodeVersion, CONFIG.NODE_MIN_VERSION) < 0) {
            throw new Error(`Node.js version ${nodeVersion} is too old. Please install Node.js ${CONFIG.NODE_MIN_VERSION} or higher.`);
        }
        
        logger.info(`Node.js version ${nodeVersion} detected`);
        
        // Check npm
        const hasNpm = await Utils.checkCommand('npm');
        if (!hasNpm) {
            throw new Error('npm is not installed. Please install npm.');
        }

        const npmVersion = await Utils.getNpmVersion();
        logger.info(`npm version ${npmVersion} detected`);
        
        // Check required files
        Utils.checkRequiredFiles();
        logger.info('All required files found');
    }

    async installDependencies() {
        logger.info('Checking dependencies...');
        
        const packageLockPath = path.join(__dirname, 'package-lock.json');
        const nodeModulesPath = path.join(__dirname, 'node_modules');
        
        const needsInstall = !fs.existsSync(nodeModulesPath) || 
                            !fs.existsSync(packageLockPath) ||
                            fs.statSync(packageLockPath).mtime > fs.statSync(nodeModulesPath).mtime;
        
        if (needsInstall) {
            logger.info('Installing dependencies...');
            await this.runCommand('npm', ['install'], { cwd: __dirname });
            logger.info('Dependencies installed successfully');
        } else {
            logger.info('Dependencies already installed');
        }
    }

    async findAvailablePort() {
        try {
            this.port = await Utils.findAvailablePort(CONFIG.DEFAULT_PORT);
            if (this.port !== CONFIG.DEFAULT_PORT) {
                logger.warn(`Port ${CONFIG.DEFAULT_PORT} is in use, using port ${this.port} instead`);
            } else {
                logger.info(`Port ${this.port} is available`);
            }
        } catch (error) {
            throw new Error(`Failed to find available port: ${error.message}`);
        }
    }

    async runCommand(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, { stdio: 'pipe', ...options });
            
            let stdout = '';
            let stderr = '';
            
            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });
            
            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    startServer() {
        logger.info(`Starting ${CONFIG.APP_NAME} on port ${this.port}...`);
        
        const env = { ...process.env, PORT: this.port.toString() };
        this.serverProcess = spawn('node', ['src/server.js'], {
            cwd: __dirname,
            stdio: 'inherit',
            env
        });
        
        this.serverProcess.on('error', (error) => {
            logger.error(`Failed to start server: ${error.message}`);
            process.exit(1);
        });
        
        this.serverProcess.on('close', (code) => {
            if (!this.isShuttingDown) {
                logger.error(`Server exited with code ${code}`);
                process.exit(code);
            }
        });
        
        // Give the server a moment to start
        setTimeout(() => {
            this.displayStartupInfo();
        }, 1000);
    }

    displayStartupInfo() {
        const url = `http://localhost:${this.port}`;
        console.log('\n' + '='.repeat(50));
        console.log(`${COLORS.green}🚀 ${CONFIG.APP_NAME} is running!${COLORS.reset}`);
        console.log('='.repeat(50));
        console.log(`${COLORS.blue}📱 Opening browser at:${COLORS.reset}`);
        console.log(`${COLORS.cyan}   ${url}${COLORS.reset}`);
        console.log('\n' + `${COLORS.yellow}Press Ctrl+C to stop the application${COLORS.reset}`);
        console.log('='.repeat(50) + '\n');
        
        // Automatically open browser
        this.openBrowser(url);
    }

    openBrowser(url) {
        const start = process.platform === 'darwin' ? 'open' : 
                    process.platform === 'win32' ? 'start' : 'xdg-open';
        
        require('child_process').exec(`${start} ${url}`, (error) => {
            if (error) {
                logger.warn(`Could not open browser automatically: ${error.message}`);
                logger.info(`Please open your browser and navigate to: ${url}`);
            } else {
                logger.info(`Browser opened automatically at: ${url}`);
            }
        });
    }

    async run() {
        try {
            console.log(`${COLORS.blue}========================================${COLORS.reset}`);
            console.log(`${COLORS.blue}  ${CONFIG.APP_NAME}${COLORS.reset}`);
            console.log(`${COLORS.blue}========================================${COLORS.reset}\n`);
            
            await this.checkPrerequisites();
            await this.installDependencies();
            await this.findAvailablePort();
            this.startServer();
            
        } catch (error) {
            logger.error(`Startup failed: ${error.message}`);
            process.exit(1);
        }
    }
}

// Run the launcher
if (require.main === module) {
    const launcher = new AmplifierLauncher();
    launcher.run();
}

module.exports = AmplifierLauncher;
