const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class ScreenCapture {
    constructor() {
        this.captureDir = path.join(__dirname, '../captures');
        this.ensureCaptureDir();
    }

    ensureCaptureDir() {
        if (!fs.existsSync(this.captureDir)) {
            fs.mkdirSync(this.captureDir, { recursive: true });
        }
    }

    /**
     * Capture a specific window by title using PowerShell
     * @param {string} windowTitle - Title of the window to capture
     * @returns {Promise<Buffer>} - Image buffer
     */
    async captureWindow(windowTitle = 'OSD PRO') {
        try {
            // Use PowerShell to take a screenshot of a specific window
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function FindWindow($title) {
    $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$title*" }
    return $processes | Select-Object -First 1
}

function CaptureWindow($process) {
    if (-not $process) {
        Write-Error "Window not found"
        exit 1
    }
    
    $handle = $process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) {
        Write-Error "Window handle is zero"
        exit 1
    }
    
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bounds = $screen.Bounds
    
    # Create bitmap
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    
    # Capture screen
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    
    # Get window rect
    $rect = New-Object System.Drawing.Rectangle
    $rectSize = [System.Runtime.InteropServices.Marshal]::SizeOf($rect)
    if ([System.Runtime.InteropServices.NativeMethods]::GetWindowRect($handle, [ref]$rect)) {
        # Crop to window area
        $windowBitmap = New-Object System.Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
        $windowGraphics = [System.Drawing.Graphics]::FromImage($windowBitmap)
        $windowGraphics.DrawImage($bitmap, 0, 0, $rect, [System.Drawing.GraphicsUnit]::Pixel)
        
        # Save to memory stream
        $stream = New-Object System.IO.MemoryStream
        $windowBitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        
        # Convert to base64
        $bytes = $stream.ToArray()
        $base64 = [System.Convert]::ToBase64String($bytes)
        
        Write-Output $base64
    } else {
        Write-Error "Failed to get window rect"
        exit 1
    }
    
    $graphics.Dispose()
    $bitmap.Dispose()
}

# Add native method for GetWindowRect
$signature = @"
[DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr hWnd, ref System.Drawing.Rectangle rect);
"@
$type = Add-Type -MemberDefinition $signature -Name "NativeMethods" -PassThru

# Find and capture window
$process = FindWindow "${windowTitle}"
if ($process) {
    CaptureWindow $process
} else {
    Write-Error "Process with title containing '${windowTitle}' not found"
    exit 1
}
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
                        // Fallback to full screen capture
                        this.captureFullScreen().then(resolve).catch(reject);
                        return;
                    }

                    const base64Data = stdout.trim();
                    if (base64Data) {
                        try {
                            const buffer = Buffer.from(base64Data, 'base64');
                            resolve(buffer);
                        } catch (err) {
                            console.error('Failed to decode base64:', err);
                            reject(err);
                        }
                    } else {
                        reject(new Error('No data received from PowerShell'));
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    // Fallback to full screen capture
                    this.captureFullScreen().then(resolve).catch(reject);
                });
            });

        } catch (err) {
            console.error('Window capture failed:', err);
            // Fallback to full screen capture
            return this.captureFullScreen();
        }
    }

    /**
     * Capture the entire screen using PowerShell
     * @returns {Promise<Buffer>} - Image buffer
     */
    async captureFullScreen() {
        try {
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds

$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)

$bytes = $stream.ToArray()
$base64 = [System.Convert]::ToBase64String($bytes)

Write-Output $base64

$graphics.Dispose()
$bitmap.Dispose()
$stream.Dispose()
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
                        reject(new Error('Failed to capture screen'));
                        return;
                    }

                    const base64Data = stdout.trim();
                    if (base64Data) {
                        try {
                            const buffer = Buffer.from(base64Data, 'base64');
                            resolve(buffer);
                        } catch (err) {
                            console.error('Failed to decode base64:', err);
                            reject(err);
                        }
                    } else {
                        reject(new Error('No data received from PowerShell'));
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    reject(err);
                });
            });

        } catch (err) {
            console.error('Full screen capture failed:', err);
            throw err;
        }
    }

    /**
     * Check if a window with the given title exists
     * @param {string} windowTitle - Window title to search for
     * @returns {Promise<boolean>} - True if window exists
     */
    async isWindowOpen(windowTitle = 'OSD PRO') {
        try {
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms

$processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*${windowTitle}*" }
if ($processes) {
    Write-Output "true"
} else {
    Write-Output "false"
}
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.on('close', (code) => {
                    const result = stdout.trim().toLowerCase() === 'true';
                    resolve(result);
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve(false);
                });
            });

        } catch (err) {
            console.error('Window check failed:', err);
            return false;
        }
    }

    /**
     * Save captured image to file
     * @param {Buffer} imageBuffer - Image buffer
     * @param {string} filename - Optional filename
     * @returns {string} - Path to saved file
     */
    async saveCapture(imageBuffer, filename = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalFilename = filename || `capture-${timestamp}.png`;
        const filepath = path.join(this.captureDir, finalFilename);
        
        try {
            await fs.promises.writeFile(filepath, imageBuffer);
            return filepath;
        } catch (err) {
            console.error('Failed to save capture:', err);
            throw err;
        }
    }

    /**
     * Resize image for web display
     * @param {Buffer} imageBuffer - Original image buffer
     * @param {number} maxWidth - Maximum width
     * @param {number} maxHeight - Maximum height
     * @returns {Promise<Buffer>} - Resized image buffer
     */
    async resizeForWeb(imageBuffer, maxWidth = 800, maxHeight = 600) {
        try {
            return await sharp(imageBuffer)
                .resize(maxWidth, maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .png()
                .toBuffer();
        } catch (err) {
            console.error('Failed to resize image:', err);
            // Return original buffer if resize fails
            return imageBuffer;
        }
    }

    /**
     * Get list of running processes with window titles
     * @returns {Promise<Array>} - Array of process info
     */
    async getProcessList() {
        try {
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms

$processes = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Length -gt 0 } | 
    Select-Object ProcessName, MainWindowTitle | 
    ConvertTo-Json -Compress
`;

            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', psScript], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true
                });

                let stdout = '';

                ps.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                ps.on('close', (code) => {
                    try {
                        const processes = JSON.parse(stdout.trim());
                        resolve(Array.isArray(processes) ? processes : [processes]);
                    } catch (err) {
                        console.error('Failed to parse process list:', err);
                        resolve([]);
                    }
                });

                ps.on('error', (err) => {
                    console.error('PowerShell process error:', err);
                    resolve([]);
                });
            });

        } catch (err) {
            console.error('Failed to get process list:', err);
            return [];
        }
    }
}

module.exports = ScreenCapture;
