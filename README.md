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

### Advanced Connection Management
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

## System Architecture

- **Frontend**: Modern single-page application with WebSocket client and responsive VU meter interface
- **Backend**: Node.js Express server with WebSocket support and TCP client for amplifier communication
- **Protocol Implementation**: Full NPA43A Central Control Codes support:
  - Function Code 0x0E (Gains Level reading)
  - Function Code 0x03 (Mute control and status)
- **Real-time Communication**: WebSocket for browser-server, TCP for server-amplifier

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Starting the Server

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

The server will start on port 8080. Open your browser and navigate to:

```
http://localhost:8080
```

### Connecting to Amplifier

1. **Enter IP Address**: Input the amplifier's IP address in the connection panel (default: 169.254.21.36)
2. **Connect**: Click "Connect" to establish the TCP connection
3. **Monitor**: The VU meters will start displaying real-time audio levels immediately
4. **Control**: Use the mute buttons to control individual channels or master output

### Interface Controls

- **Connection Panel**: 
  - IP input field with validation
  - Connect/Disconnect buttons with status feedback
  - Real-time connection status indicator (green/yellow/red)

- **VU Meters**:
  - 8 individual meters (4 inputs, 4 outputs)
  - Color-coded level indicators
  - Precise dB numerical display
  - Smooth animated transitions

- **Mute Controls**:
  - Individual channel mute buttons with visual feedback
  - Mute status indicators (🔊/🔇 icons)
  - Synchronized with amplifier hardware state

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
│   ├── server.js              # Main server with WebSocket and Express
│   ├── amplifier-client.js    # TCP client for NPA43A communication
│   └── protocol-test.js      # Command-line protocol testing
├── public/
│   ├── index.html            # Main web interface
│   ├── style.css             # Styling for VU meters and UI
│   └── app.js                # Frontend WebSocket client and logic
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## Development Phases

1. ✅ **Protocol Validation**: TCP connection and command testing
2. ✅ **Backend Wrapper**: Polling loop and WebSocket server
3. ✅ **Frontend Implementation**: VU meters and real-time updates
4. ✅ **Mute Control Integration**: Full bidirectional mute control
5. ✅ **Advanced Error Handling**: Robust connection management and data integrity
6. ✅ **UI/UX Polish**: Modern responsive design with animations

## Troubleshooting

### Connection Issues

1. **Verify Network**: Ensure the amplifier and server are on the same network
2. **Check IP**: Confirm the amplifier's IP address is correct (try 169.254.21.36 for direct connection)
3. **Firewall**: Make sure port 8234 is not blocked by firewall or network equipment
4. **Device Status**: Verify the amplifier is powered and connected to the network
5. **Network Latency**: High latency may cause connection timeouts

### Performance Issues

1. **Network Quality**: Check network quality between server and amplifier
2. **Browser Performance**: Use a modern browser for best WebSocket performance
3. **Server Resources**: Ensure adequate CPU and memory on the server machine
4. **Multiple Clients**: Too many simultaneous browser connections may impact performance

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
