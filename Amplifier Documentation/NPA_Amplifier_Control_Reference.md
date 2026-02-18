# NPA23A–NPA43A Amplifier Control Code Reference
> AI Agent Reference Document — Web Interface Integration

---

## 1. Connection Configuration

### RS232/485
| Parameter | Value |
|---|---|
| Baud Rate (RS485) | 115200 bit/s (fixed) |
| Baud Rate (RS232) | 2400 / 4800 / 9600 / 19200 / 38400 / 57600 / 115200 bit/s |
| Parity | NONE |
| Data Bits | 8 |
| Stop Bits | 1 |
| Send Interval | > 200ms between commands |
| Send Interval (Presets) | > 3000ms between commands |

### TCP/IP
| Parameter | Value |
|---|---|
| Protocol | TCP Client |
| IP Address | Device LCD display or Mconsole app |
| Port | **8234** |
| Send Interval | > 200ms (> 3000ms for Presets) |

---

## 2. Packet Structure

### Send Command (Write)
```
A5 C3 3C 5A  FF  36  [FC]  [LEN]  [DATA...]  EE
|___________|  |   |   |    |      |_________|  |
  Header      ID  W  Func  Len      Data       End
```

### Read/Query Command
```
A5 C3 3C 5A  FF  63  [FC]  [LEN]  [DATA...]  EE
|___________|  |   |   |    |      |_________|  |
  Header      ID  R  Func  Len      Data       End
```

### Key Bytes
| Byte(s) | Meaning |
|---|---|
| `A5 C3 3C 5A` | Start of packet (always fixed) |
| `FF` | Device ID (broadcast) |
| `36` | Write/Set command |
| `63` | Read/Query command |
| `[FC]` | Function code (see table below) |
| `[LEN]` | Number of data bytes that follow |
| `[DATA...]` | Payload bytes |
| `EE` | End of packet (always fixed) |

### Device Response
| Response | Meaning |
|---|---|
| `00` | Command received successfully |
| `01` | Command failed |

---

## 3. Function Code Table

| Hex Code | Function |
|---|---|
| `02` | Scene / Preset recall |
| `03` | Mute (per channel or all) |
| `04` | Volume (absolute dB value) |
| `05` | Gain adjustment in steps (+/-) |
| `06` | Input sensitivity (Line/Mic) |
| `07` | Phantom 48V power |
| `08` | AFC (Automatic Feedback Control) |
| `09` | Matrix routing (input → output) |
| `0A` | Camera control |
| `0B` | Mute — all channels |
| `0C` | Volume — all channels |
| `0D` | Analog / Dante input switch |
| `0E` | VU level — single channel |
| `0F` | VU level — all channels |
| `12` | Temperature |
| `14` | Protection status |
| `15` | Clip / Limiter status |
| `17` | Standby on/off |
| `18` | Device IP address |
| `19` | Device name |

---

## 4. Channel Numbering Convention

All commands use 1-based channel numbering.

| Value | Input | Output |
|---|---|---|
| `01` | Input 1 | Output 1 |
| `02` | Input 2 | Output 2 |
| `03` | Input 3 | Output 3 |
| `04` | Input 4 | Output 4 |
| `00` | All inputs | All outputs |

I/O type byte:
- `01` = Input channels
- `02` = Output channels

---

## 5. Command Reference

### 5.1 Preset / Scene (FC: `02`)

**Recall Preset:**
```
A5 C3 3C 5A FF 36 02 01 [PRESET_NUM] EE
```
- `PRESET_NUM`: `01` to `1E` (decimal 1–30)

**Read Current Preset:**
```
A5 C3 3C 5A FF 63 02 00 EE
```
**Response example:** `A5 C3 3C 5A FF 63 02 01 03 EE` → currently on Preset 3

---

### 5.2 Mute (FC: `03`)

**Command structure:**
```
A5 C3 3C 5A FF 36 03 03 [IO_TYPE] [CHANNEL] [STATE] EE
```
- `IO_TYPE`: `01`=Input, `02`=Output
- `CHANNEL`: `01`–`04` (specific), `00` for All
- `STATE`: `01`=Mute ON, `00`=Mute OFF

**Examples:**
```
All outputs mute ON:    A5 C3 3C 5A FF 36 03 03 02 00 01 EE
All outputs mute OFF:   A5 C3 3C 5A FF 36 03 03 02 00 00 EE
Input 1 mute ON:        A5 C3 3C 5A FF 36 03 03 01 01 01 EE
Output 3 mute OFF:      A5 C3 3C 5A FF 36 03 03 02 03 00 EE
```

**Read Mute Status:**
```
A5 C3 3C 5A FF 63 03 02 [IO_TYPE] [CHANNEL] EE
```
**Response example:** `A5 C3 3C 5A FF 63 03 03 02 04 01 EE` → Output 4 is muted

---

### 5.3 Volume — Absolute (FC: `04`)

**Set volume:**
```
A5 C3 3C 5A FF 36 04 04 [IO_TYPE] [CHANNEL] [LOW_BYTE] [HIGH_BYTE] EE
```

**Volume encoding (16-bit signed, 0.1dB steps):**
- Multiply dB value by 10 → get signed integer
- Split into low byte and high byte (little-endian signed hex)

**Excel formulas for encoding:**
```
Integer  = dB_value / 0.1
LOW_BYTE = RIGHT(DEC2HEX(integer, 2), 2)
HIGH_BYTE = MID(DEC2HEX(integer, 4), LEN(DEC2HEX(integer, 4)) - 3, 2)
```

**Encoding examples:**
| dB Value | Integer | Low Byte | High Byte |
|---|---|---|---|
| -60.0 dB | -600 | `A8` | `FD` |
| +12.0 dB | +120 | `78` | `00` |
| -2.0 dB | -20 | `EC` | `FF` |

**JavaScript encoding:**
```javascript
function encodeVolume(dB) {
  const val = Math.round(dB * 10);
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(val, 0);
  return [buf[0].toString(16).padStart(2,'0').toUpperCase(),
          buf[1].toString(16).padStart(2,'0').toUpperCase()];
}
```

**Read volume:**
```
A5 C3 3C 5A FF 63 04 02 [IO_TYPE] [CHANNEL] EE
```
**Response decode:** Last 2 data bytes = 16-bit signed little-endian → divide by 10 = dB

---

### 5.4 Gain Steps (FC: `05`)

**Adjust gain in steps:**
```
A5 C3 3C 5A FF 36 05 04 [IO_TYPE] [CHANNEL] [DIRECTION] [STEP] EE
```
- `DIRECTION`: `00`=increase (+), `01`=decrease (-)
- `STEP`: step size in 0.1dB units (e.g., `0A` = 1.0dB, `05` = 0.5dB)
- `CHANNEL`: `00` = all channels

**Examples:**
```
Input 1 gain +1.0dB:     A5 C3 3C 5A FF 36 05 04 01 01 00 0A EE
Output 2 gain -1.0dB:    A5 C3 3C 5A FF 36 05 04 02 02 01 0A EE
All inputs gain +1.0dB:  A5 C3 3C 5A FF 36 05 04 01 00 00 0A EE
```

---

### 5.5 Input Sensitivity (FC: `06`)

**Set sensitivity:**
```
A5 C3 3C 5A FF 36 06 03 [CHANNEL] 00 [LEVEL] EE
```
- `LEVEL`: `00`=12dBu, `01`=6dBu, `02`=0dBu

---

### 5.6 Matrix Routing (FC: `09`)

**Set matrix crosspoint:**
```
A5 C3 3C 5A FF 36 09 03 [INPUT_CH] [OUTPUT_CH] [STATE] EE
```
- `STATE`: `01`=connected (✓), `00`=disconnected (✗)

**Read matrix crosspoint:**
```
A5 C3 3C 5A FF 63 09 02 [INPUT_CH] [OUTPUT_CH] EE
```
**Response example:** `A5 C3 3C 5A FF 63 09 03 04 04 01 EE` → Input 4 → Output 4 is connected

---

### 5.7 Analog / Dante Input Switch (FC: `0D`)

**Set input source:**
```
A5 C3 3C 5A FF 36 0D 02 [CHANNEL] [SOURCE] EE
```
- `SOURCE`: `00`=Analog, `01`=Dante

**Read input source:**
```
A5 C3 3C 5A FF 63 0D 01 [CHANNEL] EE
```
**Response example:** `A5 C3 3C 5A FF 63 0D 02 04 01 EE` → Input 4 is using Dante

---

### 5.8 VU Level — Single Channel (FC: `0E`)

**Read VU level:**
```
A5 C3 3C 5A FF 63 0E 02 [IO_TYPE] [CHANNEL] EE
```
**Response decoding:** Same as volume — last 2 bytes = 16-bit signed LE / 10 = dB
**Example:** `A5 C3 3C 5A FF 63 0E 04 02 04 EC FF EE` → Output 4 VU = -2.0dB

---

### 5.9 VU Level — All Channels (FC: `0F`)

**Read all VU levels:**
```
Inputs:   A5 C3 3C 5A FF 63 0F 01 01 EE
Outputs:  A5 C3 3C 5A FF 63 0F 01 02 EE
```
**Response structure:**
- After header bytes, each channel = 2 bytes (16-bit signed LE, /10 = dB)
- Channels appear in order: Ch1, Ch2, Ch3, Ch4

**Response example:**
`A5 C3 3C 5A FF 63 0F 05 02 89 FF 0A 00 EE`
- Ch1: `89 FF` → -11.9dB
- Ch2: `0A 00` → +1.0dB

---

### 5.10 Temperature (FC: `12`)

**Read temperature:**
```
A5 C3 3C 5A FF 63 12 00 EE
```
**Response:** 2 data bytes, 16-bit signed (0.1°C per unit)

**Decode in JavaScript:**
```javascript
function decodeTemp(lowByte, highByte) {
  const raw = (highByte << 8) | lowByte;
  const signed = raw >= 32768 ? raw - 65536 : raw;
  return signed * 0.1; // °C
}
```
**Example:** `E6 00` → 0x00E6 = 230 → 23.0°C

---

### 5.11 Protection Status (FC: `14`)

**Read protection:**
```
A5 C3 3C 5A FF 63 14 00 EE
```
**Response:**
- `A5 C3 3C 5A FF 63 14 01 01 EE` → Protection ACTIVE
- `A5 C3 3C 5A FF 63 14 01 00 EE` → Protection not active

---

### 5.12 Clip / Limiter Status (FC: `15`)

**Read clip (inputs):**
```
A5 C3 3C 5A FF 63 15 01 01 EE
```
**Read limiter (outputs):**
```
A5 C3 3C 5A FF 63 15 01 02 EE
```
**Response:** One byte per channel → `01`=clipping/limiting, `00`=normal

**Example:** `A5 C3 3C 5A FF 63 15 05 01 01 00 01 00 EE`
- Inputs: Ch1=clipping, Ch2=normal, Ch3=clipping, Ch4=normal

---

### 5.13 Standby (FC: `17`)

**Set standby:**
```
Standby ON:  A5 C3 3C 5A FF 36 17 01 00 EE
Standby OFF: A5 C3 3C 5A FF 36 17 01 01 EE
```
**Read standby:**
```
A5 C3 3C 5A FF 63 17 00 EE
```
**Response:**
- `...17 01 00 EE` → Standby ON
- `...17 01 01 EE` → Standby OFF

---

### 5.14 Device IP (FC: `18`)

**Read IP:**
```
A5 C3 3C 5A FF 63 18 00 EE
```
**Response:** 4 data bytes = IP octets
**Example:** `C0 A8 08 4A` → 192.168.8.74

---

### 5.15 Device Name (FC: `19`)

**Read device name:**
```
A5 C3 3C 5A FF 63 19 00 EE
```
**Response:** Up to 24 bytes of ASCII characters (0x20–0x7E), padded with spaces

**ASCII ranges:**
- `0x41`–`0x5A` = A–Z
- `0x61`–`0x7A` = a–z
- `0x30`–`0x39` = 0–9
- `0x2D` = `-`, `0x2F` = `/`, `0x20` = space

---

## 6. JavaScript Utility Functions

```javascript
// Build a WRITE command packet
function buildWriteCmd(funcCode, data = []) {
  return [0xA5, 0xC3, 0x3C, 0x5A, 0xFF, 0x36, funcCode, data.length, ...data, 0xEE];
}

// Build a READ command packet
function buildReadCmd(funcCode, data = []) {
  return [0xA5, 0xC3, 0x3C, 0x5A, 0xFF, 0x63, funcCode, data.length, ...data, 0xEE];
}

// Encode dB value to 2-byte little-endian signed int (0.1dB steps)
function encodedB(dB) {
  const val = Math.round(dB * 10);
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(val, 0);
  return [buf[0], buf[1]];
}

// Decode 2-byte little-endian signed int back to dB
function decodedB(lowByte, highByte) {
  const raw = (highByte << 8) | lowByte;
  const signed = raw >= 32768 ? raw - 65536 : raw;
  return signed / 10;
}

// Parse incoming packet — returns { funcCode, ioType, channel, data }
function parseResponse(bytes) {
  if (bytes[0] !== 0xA5 || bytes[bytes.length - 1] !== 0xEE) return null;
  const funcCode = bytes[6];
  const len = bytes[7];
  const data = bytes.slice(8, 8 + len);
  return { funcCode, len, data };
}

// Convert hex string to byte array
function hexToBytes(hexStr) {
  return hexStr.trim().split(/\s+/).map(h => parseInt(h, 16));
}

// Convert byte array to hex string for display
function bytesToHex(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
```

---

## 7. Common Packet Examples (Ready to Send)

```
// Recall Preset 1
A5 C3 3C 5A FF 36 02 01 01 EE

// All outputs mute ON
A5 C3 3C 5A FF 36 03 03 02 00 01 EE

// Output 1 volume = 0.0dB (00 00)
A5 C3 3C 5A FF 36 04 04 02 01 00 00 EE

// Read all output VU levels
A5 C3 3C 5A FF 63 0F 01 02 EE

// Read device temperature
A5 C3 3C 5A FF 63 12 00 EE

// Standby ON
A5 C3 3C 5A FF 36 17 01 00 EE

// Standby OFF
A5 C3 3C 5A FF 36 17 01 01 EE

// Connect Input 1 → Output 1 in matrix
A5 C3 3C 5A FF 36 09 03 01 01 01 EE

// Disconnect Input 1 → Output 1 in matrix
A5 C3 3C 5A FF 36 09 03 01 01 00 EE
```

---

## 8. Important Rules for Implementation

1. **Always wait >200ms between sending commands** (>3s for preset changes)
2. **Every packet must start with `A5 C3 3C 5A`** and end with `EE`
3. **Device ID is `FF`** (broadcast); adjust if using device-specific addressing
4. **Volume and VU are always 16-bit signed little-endian** in 0.1dB steps
5. **Temperature is 16-bit signed little-endian** in 0.1°C steps
6. **Response `00` = success; `01` = failure** for write commands
7. **Read responses echo back the same function code** with data appended before `EE`
8. **All channel indices are 1-based** (`01`=Ch1, `04`=Ch4)
9. **Channel `00` means ALL channels** in mute and gain step commands
10. **Matrix routing is independent per crosspoint** — each Input×Output pair is set separately

---

*Source: Central Control Codes V2026.2.3 X — NPA23A–NPA43A Series*
