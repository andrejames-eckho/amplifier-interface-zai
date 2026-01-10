# Amplifier Audio Visualizer - Setup Guide

## Overview

The Amplifier Audio Visualizer is a web-based real-time audio monitoring dashboard for NPA43A amplifiers. This guide will help you set up and run the application with a single click.

## Quick Start (One-Click Launch)

### Method 1: Cross-platform Launcher (Recommended)
```bash
# On Mac/Linux
./launcher.js

# On Windows
node launcher.js
```

### Method 2: Platform-Specific Scripts

**Mac/Linux:**
```bash
./start.sh
```

**Windows:**
```bash
start.bat
```

### Method 3: Manual Start
```bash
npm install
npm start
```

## System Requirements

- **Node.js** version 14.0.0 or higher
- **npm** (comes with Node.js)
- **Modern web browser** (Chrome, Firefox, Safari, Edge)
- **Network access** to NPA43A amplifiers

### Installing Node.js

1. Visit [https://nodejs.org/](https://nodejs.org/)
2. Download and install the LTS version
3. Verify installation:
   ```bash
   node --version
   npm --version
   ```

## Application Features

### Core Functionality
- **Real-time audio monitoring** for 8 channels (4 inputs, 4 outputs)
- **Multi-amplifier support** - monitor multiple amplifiers simultaneously
- **Channel assignment** - map display channels to specific amplifier channels
- **IP management** - save and switch between multiple amplifier IPs
- **Visual meters** with color-coded audio levels
- **Mute status indicators** for all channels

### Advanced Features
- **Per-channel IP assignment** - monitor different amplifiers on different channels
- **Channel number mapping** - assign display channels to actual amplifier channels
- **WebSocket real-time updates** - smooth, responsive interface
- **Persistent settings** - IP addresses and assignments are saved automatically
- **Error handling and logging** - comprehensive error reporting

## Installation Steps

### 1. Download or Clone the Application
```bash
# If using git
git clone <repository-url>
cd amplifier-interface-zai

# Or download and extract the ZIP file
```

### 2. Automatic Setup (Recommended)
Run one of the one-click launchers:
- `./launcher.js` (cross-platform)
- `./start.sh` (Mac/Linux)
- `start.bat` (Windows)

The launcher will automatically:
- ✅ Check Node.js and npm versions
- ✅ Install required dependencies
- ✅ Find an available port
- ✅ Start the application
- ✅ Open your browser automatically

### 3. Manual Setup (Alternative)
```bash
# Install dependencies
npm install

# Start the application
npm start
```

## Configuration

### Port Configuration
- **Default port:** 8080
- **Auto-port detection:** If port 8080 is busy, the app will automatically try ports 8081-8090
- **Manual port setting:** Set environment variable `PORT=3000` before starting

### Amplifier Connection
1. Open the application in your browser
2. Click the hamburger menu (☰) in the top-left
3. Click "Manage IPs"
4. Add your amplifier's IP address
5. Click on the amplifier card to connect

### Channel Configuration
- **IP Assignment:** Each channel can monitor a different amplifier IP
- **Channel Mapping:** Display channels can be mapped to actual amplifier channels (1-4)
- **Settings are saved automatically** and persist between sessions

## Usage Guide

### Connecting to Amplifiers
1. **Add Amplifier IP:** Use the IP management modal to add amplifier addresses
2. **Select Amplifier:** Click on amplifier cards in the sidebar to switch between them
3. **Monitor Channels:** View real-time audio levels for all 8 channels

### Channel Configuration
1. **Per-Channel IP:** Use the "Monitor IP" dropdown to assign channels to specific amplifiers
2. **Channel Numbers:** Use the "Channel" dropdown to map display channels to amplifier channels
3. **Save Settings:** All configurations are saved automatically

### Reading the Meters
- **Green:** Normal levels (< -6dB)
- **Yellow:** Warning levels (-6dB to 0dB)
- **Red:** Clipping (> 0dB)
- **Mute Indicator:** Shows when a channel is muted

## Troubleshooting

### Common Issues

#### "Node.js is not installed"
**Solution:** Install Node.js from [https://nodejs.org/](https://nodejs.org/)

#### "Port is already in use"
**Solution:** The application will automatically find an available port. Check the console output for the actual URL.

#### "Cannot connect to amplifier"
**Solutions:**
1. Verify the amplifier IP address is correct
2. Check network connectivity to the amplifier
3. Ensure the amplifier is powered on and connected to the network
4. Verify firewall settings are not blocking the connection

#### "Application won't start"
**Solutions:**
1. Check the log file at `logs/app.log` for detailed error information
2. Ensure all required files are present
3. Try running `npm install` manually
4. Check Node.js version with `node --version`

### Debug Mode
Enable debug logging:
```bash
DEBUG=1 ./launcher.js
```

### Log Files
- **Application logs:** `logs/app.log`
- **Node modules:** `node_modules/`
- **Configuration files:** `src/ip-addresses.json`, `src/channel-assignments.json`

## Network Requirements

### Firewall Settings
Ensure the following ports are open:
- **Application port:** 8080 (or auto-detected port)
- **Amplifier communication:** 8234 (NPA43A default port)

### Network Topology
- The application server and amplifiers should be on the same network
- If using VLANs, ensure routing is configured between the application and amplifier networks
- Consider using static IP addresses for amplifiers in production environments

## Advanced Configuration

### Environment Variables
```bash
PORT=8080              # Application port
DEBUG=1                # Enable debug logging
NODE_ENV=production    # Production mode
```

### Custom Amplifier Settings
Edit `src/amplifier-client.js` to modify:
- Connection timeout values
- Polling intervals
- Protocol-specific settings

### Multiple Instance Support
You can run multiple instances on different ports:
```bash
PORT=8080 ./launcher.js &
PORT=8081 ./launcher.js &
PORT=8082 ./launcher.js &
```

## Security Considerations

### Network Security
- The application connects to amplifiers using TCP port 8234
- No authentication is built into the NPA43A protocol
- Consider network segmentation for production deployments

### Application Security
- The web interface runs on localhost by default
- No sensitive data is stored in plain text
- IP addresses are stored locally in JSON files

## Performance Optimization

### System Resources
- **CPU Usage:** Minimal (< 5% on modern systems)
- **Memory Usage:** ~50MB for the application
- **Network Usage:** ~1KB/s per connected amplifier

### Browser Performance
- **Recommended browsers:** Chrome, Firefox, Safari, Edge
- **JavaScript required:** Modern JavaScript features are used
- **WebSocket support:** Required for real-time updates

## Support and Maintenance

### Regular Maintenance
- **Log rotation:** Monitor log file size in `logs/app.log`
- **Backup configuration:** Save `src/ip-addresses.json` and `src/channel-assignments.json`
- **Update dependencies:** Run `npm update` periodically

### Getting Help
1. Check the log files for detailed error information
2. Review this troubleshooting section
3. Ensure all system requirements are met
4. Test network connectivity to amplifiers

## Development Information

### Project Structure
```
amplifier-interface-zai/
├── public/                 # Web interface files
│   ├── index.html         # Main HTML page
│   ├── app.js            # Frontend JavaScript
│   └── style.css         # CSS styling
├── src/                   # Server-side files
│   ├── server.js         # Main application server
│   ├── amplifier-client.js # Amplifier communication
│   ├── ip-addresses.json # Saved IP addresses
│   └── channel-assignments.json # Channel configurations
├── logs/                  # Application logs
├── launcher.js           # Cross-platform launcher
├── start.sh              # Mac/Linux startup script
├── start.bat             # Windows startup script
└── package.json          # Node.js dependencies
```

### API Endpoints
- `GET /api/status` - Connection status
- `GET /api/ips` - Saved IP addresses
- `POST /api/ips` - Add new IP address
- `DELETE /api/ips/:id` - Delete IP address
- `POST /api/switch` - Switch amplifier
- `POST /api/channel-ip` - Assign channel to IP
- `POST /api/channel-number` - Assign channel number

## License

This project is licensed under the MIT License. See LICENSE file for details.

---

**For technical support or questions, refer to the log files or check the troubleshooting section above.**
