# NPA43A Web Audio Visualizer

A web-based real-time audio visualization dashboard for the NPA43A Network DSP Power Amplifier. This application connects to the amplifier over a local area network (LAN) via TCP/IP and displays real-time audio signal levels for all 4 inputs and 4 outputs as vertical VU meters.

## Features

- **Real-time Audio Visualization**: Displays actual audio signal levels (not just volume settings)
- **8 Channel Monitoring**: 4 inputs + 4 outputs with individual VU meters
- **Color-coded Levels**: Green (normal), Yellow (-6dB to 0dB), Red (>0dB/clipping)
- **Web-based Interface**: Access from any modern browser on the same network
- **WebSocket Communication**: Real-time updates with minimal latency
- **Connection Management**: Easy IP configuration and connection status monitoring

## System Architecture

- **Frontend**: Single Page Application with WebSocket client
- **Backend**: Node.js server with TCP client to amplifier and WebSocket server to browser
- **Protocol**: Implements NPA43A Central Control Codes with Function Code 0x0E (Gains Level)

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

1. Enter the amplifier's IP address in the connection panel
2. Click "Connect"
3. The VU meters will start displaying real-time audio levels

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

### Command Structure

The system uses Function Code `0x0E` (Gains Level reading) with the following command format:

```
A5 C3 3C 5A FF 63 0E 02 [Type] [ID] EE
```

- `[Type]`: 01 (Input) or 02 (Output)
- `[ID]`: 01, 02, 03, or 04 (Channel Number)

### Response Parsing

Responses are parsed to extract dB values using signed 16-bit integer conversion:

```
dB_Value = ((dB_High << 8) | dB_Low) / 10
```

### Polling Sequence

The system polls all 8 channels sequentially:
1. Input 1 → Input 2 → Input 3 → Input 4
2. Output 1 → Output 2 → Output 3 → Output 4
3. Repeat

Polling interval: 250ms per channel (adheres to >200ms requirement)

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## Node.js Requirements

- Node.js 14.0+

## Error Handling

- Automatic reconnection for WebSocket connections
- Connection status indicators
- Error notifications for failed connections
- Graceful handling of invalid data packets

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
4. ✅ **Integration & Polish**: Connection UI and error handling

## Troubleshooting

### Connection Issues

1. **Verify Network**: Ensure the amplifier and server are on the same network
2. **Check IP**: Confirm the amplifier's IP address is correct
3. **Firewall**: Make sure port 8234 is not blocked
4. **Device Status**: Verify the amplifier is powered and connected to the network

### Performance Issues

1. **Network Latency**: Check network quality between server and amplifier
2. **Browser Performance**: Use a modern browser for best WebSocket performance
3. **Server Resources**: Ensure adequate CPU and memory on the server machine

## License

MIT License
