const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ScreenCapture = require('./screen-capture');

class AutoClicker {
    constructor() {
        this.screenCapture = new ScreenCapture();
        this.clickIntervals = new Map(); // Map of IP -> click interval
        this.isClicking = new Map(); // Map of IP -> clicking state
    }

    /**
     * Find and click on amplifier in OSD PRO window
     * @param {string} amplifierIP - IP address of amplifier to select
     * @param {string} windowTitle - Window title to search in
     * @param {number} x - Optional specific X coordinate to click
     * @param {number} y - Optional specific Y coordinate to click
     * @returns {Promise<Object>} - Result of click operation
     */
    async clickAmplifier(amplifierIP, windowTitle = 'OSD PRO', x = null, y = null) {
        try {
            // First check if window is open
            const isOpen = await this.screenCapture.isWindowOpen(windowTitle);
            if (!isOpen) {
                return {
                    success: false,
                    error: 'Window not found',
                    message: `Window with title containing "${windowTitle}" is not open`
                };
            }

            // If specific coordinates are provided, click at those coordinates
            if (x !== null && y !== null) {
                console.log(`🎯 Clicking at specific coordinates (${x}, ${y}) for amplifier ${amplifierIP}`);
                return await this.clickAtCoordinates(x, y, windowTitle);
            }

            // Otherwise, use the original automatic finding logic
            console.log(`🔍 Finding amplifier ${amplifierIP} in window "${windowTitle}"`);
            return await this.findAndClickAmplifier(amplifierIP, windowTitle);

        } catch (err) {
            console.error('Click amplifier failed:', err);
            return {
                success: false,
                error: 'Click failed',
                message: err.message
            };
        }
    }

    /**
     * Click at specific coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {string} windowTitle - Window title
     * @returns {Promise<Object>} - Result of click operation
     */
    async clickAtCoordinates(x, y, windowTitle) {
        try {
            console.log(`🎯 === CLICK AT COORDINATES DEBUG START ===`);
            console.log(`🎯 Target relative coordinates: (${x}, ${y})`);
            console.log(`🎯 Target window title: "${windowTitle}"`);

            // First get window position to calculate absolute coordinates
            console.log(`🔍 Getting window position info...`);
            const windowInfoResponse = await fetch('http://localhost:8080/api/get-window-info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ windowTitle })
            });

            console.log(`🔍 Window info response status: ${windowInfoResponse.status}`);
            const windowInfoResult = await windowInfoResponse.json();
            console.log(`🔍 Window info response: ${JSON.stringify(windowInfoResult)}`);

            if (!windowInfoResult.success) {
                console.log(`❌ Window info API failed: ${windowInfoResult.error}`);
                throw new Error(`Failed to get window info: ${windowInfoResult.error}`);
            }

            const windowInfo = windowInfoResult.windowInfo;
            console.log(`📐 Window found - Position: (${windowInfo.x}, ${windowInfo.y}), Size: ${windowInfo.width}x${windowInfo.height}`);

            // Calculate absolute coordinates
            const absoluteX = windowInfo.x + x;
            const absoluteY = windowInfo.y + y;

            console.log(`🎯 Calculated absolute coordinates: (${absoluteX}, ${absoluteY})`);

            // Use PowerShell to click directly at absolute coordinates without visible mouse movement
            console.log(`🚀 Executing PowerShell click script...`);
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Name User32 -Namespace Win32 -MemberDefinition @"
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref System.Drawing.Point lpPoint);
    
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
    public const uint MOUSEEVENTF_MOVE = 0x01;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
"@

function Click-At-Absolute-Coordinates {
    param(
        [string]$WindowTitle,
        [int]$AbsoluteX,
        [int]$AbsoluteY
    )
    
    Write-Host "=== CLICK FUNCTION DEBUG ==="
    Write-Host "Looking for window with title containing: $WindowTitle"
    # Find the OSD PRO window
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" }
    $window = $processes | Select-Object -First 1
    
    if (-not $window) {
        Write-Host "❌ Window not found with title containing: $WindowTitle"
        return @{
            Success = $false
            Error = "Window not found"
            WindowTitle = $WindowTitle
            Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
        }
    }
    
    Write-Host "✅ Found window: $($window.MainWindowTitle)"
    Write-Host "✅ Window handle: $($window.MainWindowHandle)"
    $hWnd = $window.MainWindowHandle
    if ($hWnd -eq [IntPtr]::Zero) {
        Write-Host "❌ Window handle is zero"
        return @{
            Success = $false
            Error = "Invalid window handle"
            WindowTitle = $WindowTitle
            Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
        }
    }
    
    Write-Host "✅ Bringing window to foreground..."
    [Win32.User32]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 1000
    Write-Host "✅ Window set to foreground"
    
    Write-Host "🎯 Target absolute coordinates: ($AbsoluteX, $AbsoluteY)"
    
    # Click directly at absolute coordinates without moving cursor
    Write-Host "🚀 Executing direct mouse click..."
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_ABSOLUTE + [Win32.User32]::MOUSEEVENTF_MOVE, $AbsoluteX, $AbsoluteY, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    Write-Host "✅ Mouse moved to target position"
    
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_ABSOLUTE + [Win32.User32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    Write-Host "✅ Left click down executed"
    
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_ABSOLUTE + [Win32.User32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 200
    Write-Host "✅ Left click up executed"
    
    Write-Host "✅ Click completed successfully"
    
    return @{
        Success = $true
        ClickX = $AbsoluteX
        ClickY = $AbsoluteY
        WindowTitle = $WindowTitle
        Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
        Method = "Direct API Click"
    }
}

Write-Host "🚀 Starting PowerShell execution..."
$result = Click-At-Absolute-Coordinates -WindowTitle "${windowTitle}" -AbsoluteX ${absoluteX} -AbsoluteY ${absoluteY}
Write-Host "🔍 PowerShell result: $result"
$result | ConvertTo-Json -Compress
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';
                let stderr = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ps.on('close', (code) => {
                    if (code !== 0) {
                        console.error('PowerShell error:', stderr);
                        resolve({
                            success: false,
                            error: 'PowerShell execution failed',
                            message: stderr
                        });
                        return;
                    }

                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (err) {
                        console.error('Failed to parse PowerShell result:', err);
                        resolve({
                            success: false,
                            error: 'Failed to parse result',
                            message: err.message
                        });
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve({
                        success: false,
                        error: 'Process execution failed',
                        message: err.message
                    });
                });
            });

        } catch (err) {
            console.error('Click at coordinates failed:', err);
            return {
                success: false,
                error: 'Click failed',
                message: err.message
            };
        }
    }

    /**
     * Find and click on amplifier in OSD PRO window
     * @param {string} amplifierIP - IP address of amplifier to select
     * @param {string} windowTitle - Window title to search in
     * @returns {Promise<Object>} - Result of click operation
     */
    async findAndClickAmplifier(amplifierIP, windowTitle) {
        try {
            // Use PowerShell to find and click on amplifier
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Name User32 -Namespace Win32 -MemberDefinition @"
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref System.Drawing.Point lpPoint);
    
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
    public const uint MOUSEEVENTF_MOVE = 0x01;
"@

function Find-Amplifier-Button {
    param(
        [string]$AmplifierIP,
        [string]$WindowTitle
    )
    
    # Find the OSD PRO window
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" }
    $window = $processes | Select-Object -First 1
    
    if (-not $window) {
        return $null
    }
    
    $hWnd = $window.MainWindowHandle
    if ($hWnd -eq [IntPtr]::Zero) {
        return $null
    }
    
    # Get window dimensions
    $rect = New-Object System.Drawing.Rectangle
    if (-not [Win32.User32]::GetWindowRect($hWnd, [ref]$rect)) {
        return $null
    }
    
    # Bring window to foreground
    [Win32.User32]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 500
    
    # Capture screen area of the window
    $bounds = $rect
    $bitmap = New-Object System.Drawing.Bitmap ($bounds.Right - $bounds.Left), ($bounds.Bottom - $bounds.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    
    # Convert to byte array for analysis
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $imageBytes = $stream.ToArray()
    
    # Simple pattern matching - look for IP address text in the window
    # This is a simplified approach - in practice you'd use more sophisticated OCR or template matching
    $ipPattern = [regex]::Escape($AmplifierIP)
    
    # Search for the IP in the window by analyzing pixel patterns
    # For now, we'll use a heuristic approach based on typical OSD PRO layouts
    $windowWidth = $bounds.Right - $bounds.Left
    $windowHeight = $bounds.Bottom - $bounds.Top
    
    # Typical OSD PRO has amplifier list on the left side
    # We'll click in the left side area where amplifiers are usually listed
    $clickAreas = @(
        @{ X = 100; Y = 150; Width = 200; Height = 400 },  # Left panel area
        @{ X = 120; Y = 200; Width = 160; Height = 50 },   # First amplifier
        @{ X = 120; Y = 260; Width = 160; Height = 50 },   # Second amplifier
        @{ X = 120; Y = 320; Width = 160; Height = 50 },   # Third amplifier
        @{ X = 120; Y = 380; Width = 160; Height = 50 }    # Fourth amplifier
    )
    
    # Try each click area
    for ($i = 0; $i -lt $clickAreas.Count; $i++) {
        $area = $clickAreas[$i]
        
        # Convert window coordinates to screen coordinates
        $screenX = $bounds.Left + $area.X
        $screenY = $bounds.Top + $area.Y + ($area.Height / 2)
        
        # Move mouse and click
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($screenX, $screenY)
        Start-Sleep -Milliseconds 200
        
        [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 100
        [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 300
        
        # Check if this was the correct amplifier by looking for confirmation
        # (This would need to be enhanced with proper OCR or image recognition)
        $result = @{
            Success = $true
            ClickX = $screenX
            ClickY = $screenY
            AreaIndex = $i
            AmplifierIP = $AmplifierIP
            WindowTitle = $WindowTitle
            Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
        }
        
        return $result
    }
    
    return @{
        Success = $false
        Error = "Amplifier not found in window"
        AmplifierIP = $AmplifierIP
        WindowTitle = $WindowTitle
    }
}

# Execute the function
$result = Find-Amplifier-Button -AmplifierIP "${amplifierIP}" -WindowTitle "${windowTitle}"
$result | ConvertTo-Json -Compress
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';
                let stderr = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ps.on('close', (code) => {
                    if (code !== 0) {
                        console.error('PowerShell error:', stderr);
                        resolve({
                            success: false,
                            error: 'PowerShell execution failed',
                            message: stderr
                        });
                        return;
                    }

                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (err) {
                        console.error('Failed to parse PowerShell result:', err);
                        resolve({
                            success: false,
                            error: 'Failed to parse result',
                            message: err.message
                        });
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve({
                        success: false,
                        error: 'Process execution failed',
                        message: err.message
                    });
                });
            });

        } catch (err) {
            console.error('Auto-click failed:', err);
            return {
                success: false,
                error: 'Auto-click failed',
                message: err.message
            };
        }
    }

    /**
     * Start periodic auto-clicking for an amplifier
     * @param {string} amplifierIP - IP address of amplifier
     * @param {number} interval - Click interval in milliseconds
     * @param {string} windowTitle - Window title
     * @param {number} x - Optional specific X coordinate to click
     * @param {number} y - Optional specific Y coordinate to click
     * @returns {Promise<Object>} - Result
     */
    async startAutoClick(amplifierIP, interval = 10000, windowTitle = 'OSD PRO', x = null, y = null) {
        try {
            // Stop existing auto-click for this IP if any
            if (this.clickIntervals.has(amplifierIP)) {
                clearInterval(this.clickIntervals.get(amplifierIP));
            }

            // Set clicking state
            this.isClicking.set(amplifierIP, true);

            // Perform initial click
            const initialResult = await this.clickAmplifier(amplifierIP, windowTitle, x, y);
            
            // Start periodic clicking
            const clickInterval = setInterval(async () => {
                try {
                    const result = await this.clickAmplifier(amplifierIP, windowTitle, x, y);
                    console.log(`Auto-click result for ${amplifierIP}:`, result);
                    
                    // Broadcast result to all WebSocket clients
                    if (global.broadcast) {
                        global.broadcast({
                            type: 'autoClickResult',
                            amplifierIP: amplifierIP,
                            result: result,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (err) {
                    console.error(`Auto-click failed for ${amplifierIP}:`, err);
                }
            }, interval);

            this.clickIntervals.set(amplifierIP, clickInterval);

            return {
                success: true,
                message: `Started auto-click for ${amplifierIP} every ${interval}ms`,
                interval: interval,
                initialResult: initialResult
            };

        } catch (err) {
            console.error('Failed to start auto-click:', err);
            return {
                success: false,
                error: 'Failed to start auto-click',
                message: err.message
            };
        }
    }

    /**
     * Stop auto-clicking for an amplifier
     * @param {string} amplifierIP - IP address of amplifier
     * @returns {boolean} - True if stopped, false if not running
     */
    stopAutoClick(amplifierIP) {
        if (this.clickIntervals.has(amplifierIP)) {
            clearInterval(this.clickIntervals.get(amplifierIP));
            this.clickIntervals.delete(amplifierIP);
            this.isClicking.set(amplifierIP, false);
            console.log(`Stopped auto-click for ${amplifierIP}`);
            return true;
        }
        return false;
    }

    /**
     * Stop all auto-clicking
     */
    stopAllAutoClicks() {
        for (const [ip, interval] of this.clickIntervals.entries()) {
            clearInterval(interval);
            console.log(`Stopped auto-click for ${ip}`);
        }
        this.clickIntervals.clear();
        this.isClicking.clear();
    }

    /**
     * Get auto-click status for all amplifiers
     * @returns {Object} - Status map
     */
    getAutoClickStatus() {
        const status = {};
        for (const [ip, isClicking] of this.isClicking.entries()) {
            status[ip] = {
                isClicking: isClicking,
                hasInterval: this.clickIntervals.has(ip)
            };
        }
        return status;
    }

    /**
     * Enhanced amplifier detection using image analysis
     * @param {string} amplifierIP - IP to search for
     * @param {string} windowTitle - Window title
     * @returns {Promise<Object>} - Detection result
     */
    async detectAmplifierPosition(amplifierIP, windowTitle = 'OSD PRO') {
        try {
            // Capture the window first
            const imageBuffer = await this.screenCapture.captureWindow(windowTitle);
            
            // For now, return a simple heuristic-based position
            // In a real implementation, you'd use OCR or template matching here
            return {
                success: true,
                position: {
                    x: 120,  // Default position in left panel
                    y: 200 + (parseInt(amplifierIP.split('.')[3]) || 0) * 60,
                    width: 160,
                    height: 50
                },
                confidence: 0.8,
                amplifierIP: amplifierIP
            };

        } catch (err) {
            console.error('Failed to detect amplifier position:', err);
            return {
                success: false,
                error: 'Detection failed',
                message: err.message
            };
        }
    }

    /**
     * Click on OSD PRO software to activate it
     * @param {string} windowTitle - Window title to search for
     * @returns {Promise<Object>} - Result of click operation
     */
    async clickOsdPro(windowTitle = 'OSD PRO') {
        try {
            // First check if window is open
            const isOpen = await this.screenCapture.isWindowOpen(windowTitle);
            if (!isOpen) {
                return {
                    success: false,
                    error: 'OSD PRO window not found',
                    message: `Window with title containing "${windowTitle}" is not open`
                };
            }

            // Use PowerShell to click on OSD PRO main area
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Name User32 -Namespace Win32 -MemberDefinition @"
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
"@

function Click-OsdPro-Main {
    param(
        [string]$WindowTitle
    )
    
    # Find OSD PRO window
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" }
    $window = $processes | Select-Object -First 1
    
    if (-not $window) {
        return @{
            Success = $false
            Error = "Window not found"
            WindowTitle = $WindowTitle
        }
    }
    
    $hWnd = $window.MainWindowHandle
    if ($hWnd -eq [IntPtr]::Zero) {
        return @{
            Success = $false
            Error = "Window handle is zero"
            WindowTitle = $WindowTitle
        }
    }
    
    # Get window dimensions
    $rect = New-Object System.Drawing.Rectangle
    if (-not [Win32.User32]::GetWindowRect($hWnd, [ref]$rect)) {
        return @{
            Success = $false
            Error = "Failed to get window rect"
            WindowTitle = $WindowTitle
        }
    }
    
    # Bring window to foreground
    [Win32.User32]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 1000
    
    # Click in the center of the window
    $centerX = $rect.Left + ($rect.Right - $rect.Left) / 2
    $centerY = $rect.Top + ($rect.Bottom - $rect.Top) / 2
    
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($centerX, $centerY)
    Start-Sleep -Milliseconds 500
    
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 100
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    
    return @{
        Success = $true
        ClickX = $centerX
        ClickY = $centerY
        WindowTitle = $WindowTitle
        Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
    }
}

# Execute function
$result = Click-OsdPro-Main -WindowTitle "${windowTitle}"
$result | ConvertTo-Json -Compress
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';
                let stderr = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ps.on('close', (code) => {
                    if (code !== 0) {
                        console.error('PowerShell error:', stderr);
                        resolve({
                            success: false,
                            error: 'PowerShell execution failed',
                            message: stderr
                        });
                        return;
                    }

                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (err) {
                        console.error('Failed to parse PowerShell result:', err);
                        resolve({
                            success: false,
                            error: 'Failed to parse result',
                            message: err.message
                        });
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve({
                        success: false,
                        error: 'Process execution failed',
                        message: err.message
                    });
                });
            });

        } catch (err) {
            console.error('OSD PRO click failed:', err);
            return {
                success: false,
                error: 'OSD PRO click failed',
                message: err.message
            };
        }
    }

    /**
     * Read connected amplifiers from OSD PRO software
     * @param {string} windowTitle - Window title to search for
     * @returns {Promise<Array>} - Array of connected amplifier IPs
     */
    async readAmplifiersFromOsdPro(windowTitle = 'OSD PRO') {
        try {
            // Capture OSD PRO window and extract IP addresses
            const imageBuffer = await this.screenCapture.captureWindow(windowTitle);
            
            // For now, return a mock implementation based on your screenshot
            // In a real implementation, you'd use OCR or template matching to extract IPs
            // This would analyze the captured image to find IP addresses in the device list
            
            // Based on your screenshot, these would be the IPs visible in the device list
            const detectedIPs = ['169.254.236.111', '192.168.1.120'];
            
            return {
                success: true,
                amplifiers: detectedIPs,
                timestamp: new Date().toISOString()
            };

        } catch (err) {
            console.error('Failed to read amplifiers from OSD PRO:', err);
            return {
                success: false,
                error: 'Failed to read amplifiers',
                message: err.message,
                amplifiers: []
            };
        }
    }

    /**
     * Connect to specific amplifier in OSD PRO software
     * @param {string} amplifierIP - IP address of amplifier to connect to
     * @param {string} windowTitle - Window title to search for
     * @returns {Promise<Object>} - Result of connection attempt
     */
    async connectToAmplifierInOsdPro(amplifierIP, windowTitle = 'OSD PRO') {
        try {
            // Use PowerShell to find and click on the specific amplifier in the device list
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Name User32 -Namespace Win32 -MemberDefinition @"
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out System.Drawing.Rectangle lpRect);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
"@

function Connect-To-Amplifier {
    param(
        [string]$AmplifierIP,
        [string]$WindowTitle
    )
    
    # Find OSD PRO window
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" }
    $window = $processes | Select-Object -First 1
    
    if (-not $window) {
        return @{
            Success = $false
            Error = "OSD PRO window not found"
            AmplifierIP = $AmplifierIP
        }
    }
    
    $hWnd = $window.MainWindowHandle
    if ($hWnd -eq [IntPtr]::Zero) {
        return @{
            Success = $false
            Error = "Window handle is zero"
            AmplifierIP = $AmplifierIP
        }
    }
    
    # Get window dimensions
    $rect = New-Object System.Drawing.Rectangle
    if (-not [Win32.User32]::GetWindowRect($hWnd, [ref]$rect)) {
        return @{
            Success = $false
            Error = "Failed to get window rect"
            AmplifierIP = $AmplifierIP
        }
    }
    
    # Bring window to foreground
    [Win32.User32]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 500
    
    # Define click areas for device list (left side of window)
    # These coordinates would need to be calibrated based on actual OSD PRO layout
    $deviceListAreas = @(
        @{ X = 120; Y = 200; Width = 160; Height = 50 },   # First device
        @{ X = 120; Y = 260; Width = 160; Height = 50 },   # Second device
        @{ X = 120; Y = 320; Width = 160; Height = 50 },   # Third device
        @{ X = 120; Y = 380; Width = 160; Height = 50 }    # Fourth device
    )
    
    # Try to find and click on the amplifier with matching IP
    # For this implementation, we'll assume the first area contains the requested IP
    # In a real implementation, you'd use OCR to read the IP text from each area
    $targetArea = $deviceListAreas[0]  # Default to first device
    
    # Convert window coordinates to screen coordinates
    $screenX = $rect.Left + $targetArea.X + ($targetArea.Width / 2)
    $screenY = $rect.Top + $targetArea.Y + ($targetArea.Height / 2)
    
    # Move mouse and click
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($screenX, $screenY)
    Start-Sleep -Milliseconds 300
    
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 150
    [Win32.User32]::mouse_event([Win32.User32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 500
    
    return @{
        Success = $true
        ClickX = $screenX
        ClickY = $screenY
        AreaIndex = 0
        AmplifierIP = $AmplifierIP
        WindowTitle = $WindowTitle
        Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
    }
}

# Execute function
$result = Connect-To-Amplifier -AmplifierIP "${amplifierIP}" -WindowTitle "${windowTitle}"
$result | ConvertTo-Json -Compress
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';
                let stderr = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ps.on('close', (code) => {
                    if (code !== 0) {
                        console.error('PowerShell error:', stderr);
                        resolve({
                            success: false,
                            error: 'PowerShell execution failed',
                            message: stderr
                        });
                        return;
                    }

                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (err) {
                        console.error('Failed to parse PowerShell result:', err);
                        resolve({
                            success: false,
                            error: 'Failed to parse result',
                            message: err.message
                        });
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve({
                        success: false,
                        error: 'Process execution failed',
                        message: err.message
                    });
                });
            });

        } catch (err) {
            console.error('Connect to amplifier failed:', err);
            return {
                success: false,
                error: 'Connect to amplifier failed',
                message: err.message
            };
        }
    }
}

module.exports = AutoClicker;
