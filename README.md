# NPA43A Web Audio Visualizer

A sophisticated web-based real-time audio visualization and control dashboard for the NPA43A Network DSP Power Amplifier. This application connects to the amplifier over a local area network (LAN) via TCP/IP and displays real-time audio signal levels for all 4 inputs and 4 outputs as professional VU meters, with comprehensive mute control capabilities.

## Features

### Real-time Audio Monitoring
- **8 Channel Visualization**: 4 inputs + 4 outputs with individual VU meters
- **Live Signal Levels**: Displays actual audio signal levels (not just volume settings)
- **Color-coded Indicators**: 
  - Green: Normal levels (< -6dB)
  - Yellow: Warning range (-6dB to 0dB)
  - Red: Clipping/overload (> 0dB)
- **Precise dB Display**: Real-time numerical values from -60dB to +60dB

### Multi-Amplifier Management
- **IP Address Storage**: Save and manage multiple amplifier IP addresses with custom names
- **Quick Switching**: Instantly switch between different amplifiers from the sidebar
- **Connection History**: Maintain a list of previously connected amplifiers
- **Validation**: IP address format validation and duplicate prevention

### Advanced Channel Configuration
- **Per-Channel IP Assignment**: Assign individual channels to monitor specific amplifiers
- **Channel Number Mapping**: Map display channels to different physical amplifier channels
- **Flexible Monitoring**: Mix channels from multiple amplifiers in a single interface
- **Persistent Configuration**: Channel assignments saved automatically and restored on restart

### Enhanced Connection Management
- **Intelligent Reconnection**: Automatic reconnection with exponential backoff
- **Connection Health Monitoring**: Real-time connection status with warning indicators
- **Multi-client Support**: Multiple browser connections simultaneously
- **WebSocket Communication**: Low-latency real-time updates

### Mute Control System
- **Channel-specific Mute**: Individual mute control for all 8 channels
- **Master Mute**: Global output mute functionality
- **Visual Mute Indicators**: Clear visual feedback for muted channels
- **Real-time Status Sync**: Mute status synchronized with amplifier state

### Professional UI/UX
- **Modern Responsive Design**: Works on desktop and mobile devices
- **Glass-morphism Interface**: Contemporary visual design with backdrop blur effects
- **Smooth Animations**: Polished transitions and visual feedback
- **Error Handling**: User-friendly error notifications and toast messages
- **Sidebar Navigation**: Hamburger menu for amplifier management and quick switching
- **Channel Configuration**: Per-channel IP and channel number assignment controls
- **Modal Interface**: Clean modal dialogs for IP address management

## System Architecture

- **Frontend**: Modern single-page application with WebSocket client, responsive VU meter interface, and advanced channel configuration
- **Backend**: Node.js Express server with WebSocket support, multi-client TCP management, and persistent configuration storage
- **Protocol Implementation**: Full NPA43A Central Control Codes support:
  - Function Code 0x0E (Gains Level reading)
  - Function Code 0x03 (Mute control and status)
- **Real-time Communication**: WebSocket for browser-server, multiple TCP connections for server-amplifier
- **Configuration Storage**: JSON-based persistent storage for IP addresses and channel assignments
- **Multi-Amplifier Support**: Concurrent TCP connections to multiple amplifiers with intelligent data routing

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

The server will start on port 8080 (or automatically find an available port). Open your browser and navigate to:

```
http://localhost:8080
```

## Installation

1. Clone or download this project
2. Run one of the one-click launchers above - they handle everything automatically!

### System Requirements
- **Node.js** version 14.0.0 or higher
- **npm** (comes with Node.js)
- **Modern web browser** (Chrome, Firefox, Safari, Edge)
- **Network access** to NPA43A amplifiers

### Installing Node.js
Visit [https://nodejs.org/](https://nodejs.org/) to download and install Node.js.

## Usage

### Starting the Server

**Recommended (One-Click):**
```bash
./launcher.js
```

**Manual:**
```bash
npm install
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

### Connecting to Amplifier

1. **Open Sidebar**: Click the hamburger menu (☰) to access amplifier management
2. **Add Amplifiers**: Use "Manage IPs" to add amplifier IP addresses with custom names
3. **Select Amplifier**: Click on any saved amplifier card to connect instantly
4. **Configure Channels**: Use the channel controls below each VU meter to:
   - Assign channels to specific amplifier IPs
   - Map display channels to different physical amplifier channels
5. **Monitor**: The VU meters will start displaying real-time audio levels immediately
6. **Control**: Use the mute buttons to monitor mute status (now indicator-only)

### Interface Controls

- **Sidebar Navigation**:
  - Hamburger menu (☰) for amplifier management
  - Quick amplifier switching with visual status indicators
  - "Manage IPs" button for IP address configuration

- **IP Management Modal**:
  - Add new amplifier IPs with custom names
  - View and delete saved IP addresses
  - IP format validation and duplicate prevention

- **VU Meters**:
  - 8 individual meters (4 inputs, 4 outputs)
  - Color-coded level indicators
  - Precise dB numerical display
  - Smooth animated transitions

- **Channel Configuration Controls**:
  - **Monitor IP Dropdown**: Assign each channel to a specific amplifier IP
  - **Channel Number Dropdown**: Map display channels to physical amplifier channels (1-4)
  - Persistent settings saved automatically

- **Mute Controls**:
  - Individual channel mute indicators with visual feedback
  - Mute status indicators (🔊/🔇 icons)
  - Synchronized with amplifier hardware state (read-only)

### Protocol Testing

For testing the TCP connection without the web interface:

```bash
npm test -- 192.168.1.100
```

(Replace with your amplifier's IP address)

## Technical Details

### Connection Configuration

- **Protocol**: TCP
- **Port**: 8234
- **Device ID**: 0xFF (Broadcast/Default)
- **Polling Interval**: 100ms for optimal responsiveness
- **Reconnection**: Exponential backoff with max 30 second delays

### Command Structure

The system implements multiple NPA43A protocol commands:

#### Gain Level Reading (Function Code 0x0E)
```
A5 C3 3C 5A FF 63 0E 02 [Type] [ID] EE
```
- `[Type]`: 01 (Input) or 02 (Output)
- `[ID]`: 01, 02, 03, or 04 (Channel Number)

#### Mute Control (Function Code 0x03)
```
A5 C3 3C 5A FF 36 03 03 03 [Type] [ID] [State] EE
```
- `[Type]`: 01 (Input), 02 (Output)
- `[ID]`: 00 (Master), 01-04 (Channel)
- `[State]`: 01 (Mute), 00 (Unmute)

### Response Parsing

#### Gain Level Responses
Responses are parsed to extract dB values using signed 16-bit integer conversion:

```
dB_Value = ((dB_High << 8) | dB_Low) / 10
```

#### Mute Status Responses
Binary mute status extraction:
```
Muted = (StatusByte === 0x01)
```

### Polling Sequence

The system polls all channels continuously:
1. **Audio Levels**: Input 1-4 → Output 1-4 (100ms intervals)
2. **Mute Status**: All channels + master mute (100ms intervals)
3. **Smart Caching**: Duplicate response filtering to reduce processing overhead

### Data Buffer Management

- **Fragmented TCP Handling**: Robust buffer management for incomplete packets
- **Message Validation**: Header/footer validation for data integrity
- **Overflow Protection**: Automatic buffer clearing on corruption detection

## Error Handling & Resilience

### Connection Management
- **Automatic Reconnection**: Exponential backoff strategy with configurable limits
- **Connection Health Monitoring**: Continuous monitoring with 10-second timeout detection
- **Graceful Degradation**: UI remains functional during connection interruptions
- **Multi-client Support**: Server handles multiple simultaneous browser connections

### Data Integrity
- **Protocol Validation**: Strict header/footer validation for all incoming packets
- **Buffer Management**: Intelligent handling of fragmented TCP responses
- **Duplicate Filtering**: Response caching prevents processing redundant data
- **Corruption Recovery**: Automatic buffer clearing on data corruption detection

### User Experience
- **Real-time Feedback**: Immediate visual feedback for all user actions
- **Error Notifications**: Non-intrusive toast messages for errors and warnings
- **Status Indicators**: Clear connection status with color-coded indicators
- **Input Validation**: IP address validation and sanitization

## API Endpoints

### Connection Management
- `POST /api/connect` - Connect to amplifier with IP address
- `POST /api/disconnect` - Disconnect from amplifier
- `GET /api/status` - Get current connection status and client count
- `POST /api/switch` - Switch to a different saved amplifier IP

### IP Address Management
- `GET /api/ips` - Get all saved IP addresses and current connection
- `POST /api/ips` - Add a new IP address with optional custom name
- `DELETE /api/ips/:id` - Delete a saved IP address

### Channel Configuration
- `GET /api/channel-assignments` - Get all channel IP and number assignments
- `POST /api/channel-ip` - Assign a channel to monitor a specific amplifier IP
- `POST /api/channel-number` - Map a display channel to a physical amplifier channel

### Mute Control
- `POST /api/mute` - Control mute for individual channels or master output
  ```json
  {
    "type": "input|output|all-output",
    "id": 1-4|null,
    "mute": true|false
  }
  ```

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Node.js Requirements

- Node.js 14.0+

## Project Structure

```
amplifier-interface-zai/
├── src/
│   ├── server.js              # Main server with WebSocket, Express, and multi-client management
│   ├── amplifier-client.js    # TCP client for NPA43A communication
│   └── protocol-test.js      # Command-line protocol testing
├── public/
│   ├── index.html            # Main web interface with sidebar and modals
│   ├── style.css             # Styling for VU meters, sidebar, and UI components
│   └── app.js                # Frontend WebSocket client and advanced channel logic
├── package.json              # Dependencies and scripts
├── README.md                 # This file
└── src/
    ├── ip-addresses.json     # Persistent storage for saved IP addresses (auto-generated)
    └── channel-assignments.json # Persistent storage for channel configurations (auto-generated)
```

## Development Phases

1. ✅ **Protocol Validation**: TCP connection and command testing
2. ✅ **Backend Wrapper**: Polling loop and WebSocket server
3. ✅ **Frontend Implementation**: VU meters and real-time updates
4. ✅ **Mute Control Integration**: Full bidirectional mute control
5. ✅ **Advanced Error Handling**: Robust connection management and data integrity
6. ✅ **UI/UX Polish**: Modern responsive design with animations
7. ✅ **Multi-Amplifier Support**: IP address management and quick switching
8. ✅ **Channel Configuration**: Per-channel IP assignment and channel number mapping
9. ✅ **Persistent Storage**: Configuration saving and automatic restoration

## Advanced Features

### Multi-Amplifier Monitoring
The system supports simultaneous monitoring of multiple NPA43A amplifiers, allowing you to:
- Mix channels from different amplifiers in a single interface
- Assign specific VU meters to monitor specific amplifier IPs
- Switch between amplifiers without losing channel configurations
- Maintain independent connections to multiple devices

### Channel Flexibility
Each of the 8 display channels (4 inputs, 4 outputs) can be independently configured:
- **IP Assignment**: Monitor any channel from any saved amplifier IP
- **Channel Mapping**: Map display channel 1-4 to any physical amplifier channel 1-4
- **Mixed Monitoring**: Combine input channels from one amp with output channels from another
- **Persistent Settings**: All configurations automatically saved and restored

### Intelligent Data Routing
The backend automatically manages multiple TCP connections and routes data intelligently:
- **Selective Broadcasting**: Only send relevant data for each channel's assigned IP
- **Connection Management**: Automatically connect/disconnect based on channel assignments
- **Load Balancing**: Distribute polling load across multiple amplifier connections
- **Error Isolation**: Issues with one amplifier don't affect monitoring of others

## Troubleshooting

### Connection Issues

1. **Verify Network**: Ensure the amplifier and server are on the same network
2. **Check IP**: Confirm the amplifier's IP address is correct (try 169.254.21.36 for direct connection)
3. **Firewall**: Make sure port 8234 is not blocked by firewall or network equipment
4. **Device Status**: Verify the amplifier is powered and connected to the network
5. **Network Latency**: High latency may cause connection timeouts

### Configuration Issues

1. **Lost IP Addresses**: Check if `src/ip-addresses.json` file exists and is readable
2. **Channel Assignments Reset**: Verify `src/channel-assignments.json` permissions and format
3. **Invalid Channel Mapping**: Ensure channel numbers are between 1-4 and IP addresses are valid
4. **Multi-Amplifier Conflicts**: Avoid assigning the same physical channel to multiple display channels
5. **Storage Corruption**: Delete JSON files to reset to default configuration if needed

### Performance Issues

1. **Network Quality**: Check network quality between server and amplifiers
2. **Browser Performance**: Use a modern browser for best WebSocket performance
3. **Server Resources**: Ensure adequate CPU and memory on the server machine
4. **Multiple Clients**: Too many simultaneous browser connections may impact performance
5. **Multi-Amplifier Load**: Multiple TCP connections increase server resource usage

### UI Issues

1. **Browser Compatibility**: Ensure you're using a supported browser version
2. **JavaScript Errors**: Check browser console for any JavaScript errors
3. **WebSocket Connection**: Verify WebSocket connection is established (check network tab)
4. **Cache Issues**: Try clearing browser cache if UI appears frozen

### Debug Mode

Enable detailed logging by setting the environment variable:
```bash
DEBUG=* npm start
```

This will provide extensive protocol-level debugging information.

## License

MIT License
