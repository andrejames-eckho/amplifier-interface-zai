# 🚀 Quick Start Guide

## One-Click Launch Options

### Option 1: Double-Click These Files (Easiest)

**On Mac:**
- Double-click: `RUN.command` ⭐ **RECOMMENDED**
- Double-click: `Start Amplifier Visualizer.command`

**On Windows:**
- Double-click: `start.bat`

### Option 2: Terminal Commands

**Open Terminal/CMD and run:**

```bash
# Cross-platform (works everywhere)
node launcher.js

# Mac/Linux only
./launcher.js
./start.sh

# Windows only
start.bat
```

### Option 3: Manual Install & Start

```bash
npm install
npm start
```

## What Happens When You Run It?

1. ✅ System check (Node.js, npm)
2. ✅ Auto-install dependencies 
3. ✅ Find available port
4. ✅ Start application
5. ✅ **AUTOMATICALLY OPEN BROWSER** at http://localhost:8080

## 🌟 NEW: Automatic Browser Opening

All launchers now **automatically open your browser** to the web interface:

- ✅ `launcher.js` - Opens browser on Mac/Windows/Linux
- ✅ `RUN.command` - Mac double-click with auto-browser
- ✅ `Start Amplifier Visualizer.command` - Mac with auto-browser  
- ✅ `start.sh` - Mac/Linux with auto-browser
- ✅ `start.bat` - Windows with auto-browser

## Troubleshooting

**"Nothing happens when I double-click":**
- Use `RUN.command` instead of `launcher.js`
- Or open Terminal and run: `node launcher.js`

**"Permission denied":**
- On Mac: Right-click → Open With → Terminal
- Or run: `chmod +x RUN.command`

**"Node.js not found":**
- Install from https://nodejs.org/

**"Browser doesn't open":**
- Check if browser is blocked by security settings
- Manually open: http://localhost:8080

---

**🎯 Best option: Double-click `RUN.command`** - It does everything automatically!
