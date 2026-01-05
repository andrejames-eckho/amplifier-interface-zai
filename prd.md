
# Product Requirements Document (PRD)
## Project: NPA43A Web Audio Visualizer

| Document Details | |
| :--- | :--- |
| **Project Name** | NPA43A Network Audio Visualizer |
| **Version** | 1.0 |
| **Status** | Ready for Development |
| **Device Reference** | NPA43A / NPA43AD Network DSP Power Amplifier |
| **Protocol Reference** | Central Control Codes (NPA23A-NPA43A series) |

---

## 1. Executive Summary
Develop a web-based real-time audio visualization dashboard for the NPA43A amplifier. The application will connect to the amplifier over a local area network (LAN) via TCP/IP, query the signal levels of the 4 Inputs and 4 Outputs, and display the audio levels (in dB) as vertical VU meters.

**Constraint:** The web application must visualize the **actual audio signal** (Code `0x0E`), not just the static volume setting.

---

## 2. System Architecture
**Browser Limitation:** Web browsers cannot send raw TCP packets directly. A backend proxy is required.

*   **Frontend (Client):** A Single Page Application (SPA) utilizing WebSockets to receive real-time data.
*   **Backend (Server):** A Node.js application acting as a TCP Client to the Amplifier and a WebSocket Server to the Frontend.
*   **Hardware:** NPA43A Amplifier connected to the same network as the Backend Server.

**Data Flow:**
1.  **Backend** connects to Amplifier IP:Port (TCP).
2.  **Backend** sends Polling Commands (Hex) in a loop.
3.  **Amplifier** returns Hex Data (Signal dB).
4.  **Backend** parses Hex and sends JSON to **Frontend** (WebSocket).
5.  **Frontend** renders dB value as a Meter Bar.

---

## 3. Technical Specifications (Protocol Details)

### 3.1 Connection Configuration
*   **Protocol:** TCP Client
*   **Port:** `8234`
*   **Device ID:** `0xFF` (Broadcast/Default ID)

### 3.2 Command Protocol (Read Status)
To visualize the signal, the system must use Function Code `0x0E` (Gains level reading).

**Command Structure (Hex):**
`A5 C3 3C 5A FF 63 0E 02 [Type] [ID] EE`

*   `A5 C3 3C 5A`: Start Header
*   `FF`: Device ID
*   `63`: Read Command
*   `0E`: Function Code (Gains Level)
*   `02`: Data Length
*   `[Type]`: `01` (Input) or `02` (Output)
*   `[ID]`: `01`, `02`, `03`, or `04` (Channel Number)
*   `EE`: End Header

**Example Commands:**
*   Input 1: `A5 C3 3C 5A FF 63 0E 02 01 01 EE`
*   Output 4: `A5 C3 3C 5A FF 63 0E 02 02 04 EE`

### 3.3 Response Parsing
**Response Structure (Hex):**
`A5 C3 3C 5A FF 63 0E 04 [Type] [ID] [dB_Low] [dB_High] EE`

**Data Extraction Algorithm:**
1.  Validate Header (`A5 C3 3C 5A`) and Footer (`EE`).
2.  Validate Function Code is `0E`.
3.  Extract `[dB_Low]` (Byte Index 10) and `[dB_High]` (Byte Index 11).
4.  Combine bytes into a signed 16-bit integer.
    *   `Value = (dB_High << 8) | dB_Low`
5.  Calculate Final dB:
    *   `dB_Value = Value / 10`

**Example Calculation (from Doc):**
*   Response: `... 02 04 EC FF EE` (Output 4)
*   Bytes: `EC` (Low), `FF` (High)
*   Int16: `0xFFEC` = -20
*   Result: -2.0 dB

---

## 4. Functional Requirements

### FR-1: Polling Engine
The system must continuously query the amplifier for all 8 channels (4 Inputs, 4 Outputs) sequentially.

*   **Sequence:** In1 -> In2 -> In3 -> In4 -> Out1 -> Out2 -> Out3 -> Out4 -> Repeat.
*   **Timing:** The documentation specifies a control sending interval of `>200ms`. The polling loop must adhere to this limit per command or total cycle to ensure stability.

### FR-2: Backend API (Node.js)
*   Must expose a WebSocket server (e.g., port 8080).
*   Must accept a configuration for the Amplifier IP Address.
*   Must emit a JSON object per channel update:
    ```json
    {
      "channelType": "input",
      "channelId": 1,
      "db": -2.0,
      "timestamp": 1678888888
    }
    ```

### FR-3: Frontend Visualization
*   **Layout:** Dashboard displaying 8 distinct meters.
*   **Visuals:**
    *   Vertical bars.
    *   Scale: -60dB (bottom) to +10dB (top).
    *   Color Gradient: Green (normal), Yellow (-6dB to 0dB), Red (>0dB / Clipping).
*   **Responsiveness:** Meters must update smoothly upon receiving new WebSocket data.

---

## 5. User Interface (UI) Requirements

### 5.1 Connection Screen
*   Input field: "Amplifier IP Address"
*   Button: "Connect"
*   Status Indicator: "Connected" (Green) / "Disconnected" (Red)

### 5.2 Visualizer Dashboard
*   **Section 1: Inputs**
    *   Label: "Input 1", "Input 2", etc.
    *   Display: Large dB numeric readout + Meter Bar.
*   **Section 2: Outputs**
    *   Label: "Output 1", "Output 2", etc.
    *   Display: Large dB numeric readout + Meter Bar.

---

## 6. Non-Functional Requirements

### NFR-1: Latency
*   End-to-end latency (Amplifier -> UI) should be minimized. Ideally < 500ms.

### NFR-2: Error Handling
*   If the TCP connection drops, the UI must indicate "Connection Lost" and stop the meters (drop to infinity/-60dB).
*   If invalid data is received, the system must log the error and discard the packet without crashing.

### NFR-3: Compatibility
*   Backend must run on Node.js (v14+).
*   Frontend must run on modern browsers (Chrome, Firefox, Edge, Safari).

---

## 7. Development Phases

### Phase 1: Protocol Validation (Command Line)
*   Create a Node.js script to connect to the Amp.
*   Hardcode the commands for Input 1 and Output 1.
*   Log the raw response to the console.
*   Verify the Hex-to-dB math manually.

### Phase 2: Backend Wrapper
*   Wrap the validated logic in a class structure.
*   Implement the polling loop (In 1-4, Out 1-4).
*   Set up the WebSocket server to broadcast parsed data.

### Phase 3: Frontend Implementation
*   Scaffold HTML/CSS for 8 meters.
*   Connect to WebSocket.
*   Update CSS height/width of meters based on JSON dB data.
*   Implement color thresholds (Green/Yellow/Red).

### Phase 4: Integration & Polish
*   Add IP configuration UI.
*   Handle disconnect/reconnect logic.
*   Performance tuning (reduce garbage collection/jank).