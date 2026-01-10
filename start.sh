#!/bin/bash

# Amplifier Audio Visualizer - Startup Script
# One-click launcher for the NPA43A Audio Visualizer application

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Application details
APP_NAME="Amplifier Audio Visualizer"
DEFAULT_PORT=8080
NODE_MIN_VERSION="14.0.0"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  $APP_NAME${NC}"
echo -e "${BLUE}========================================${NC}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Node.js is installed
check_nodejs() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js $NODE_MIN_VERSION or higher."
        echo "Visit: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | sed 's/v//')
    REQUIRED_VERSION=$NODE_MIN_VERSION
    
    if ! node -e "process.exit(require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION') ? 0 : 1)" 2>/dev/null; then
        print_error "Node.js version $NODE_VERSION is too old. Please install Node.js $NODE_MIN_VERSION or higher."
        exit 1
    fi
    
    print_status "Node.js version $NODE_VERSION detected"
}

# Function to check if npm is installed
check_npm() {
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm."
        exit 1
    fi
    
    NPM_VERSION=$(npm --version)
    print_status "npm version $NPM_VERSION detected"
}

# Function to install dependencies
install_dependencies() {
    print_status "Checking and installing dependencies..."
    
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
        print_status "Installing dependencies..."
        npm install
        if [ $? -eq 0 ]; then
            print_status "Dependencies installed successfully"
        else
            print_error "Failed to install dependencies"
            exit 1
        fi
    else
        print_status "Dependencies already installed"
    fi
}

# Function to check if port is available
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_warning "Port $port is already in use"
        echo "Trying to find an available port..."
        
        # Try ports 8080-8090
        for p in {8080..8090}; do
            if ! lsof -Pi :$p -sTCP:LISTEN -t >/dev/null 2>&1; then
                DEFAULT_PORT=$p
                print_status "Found available port: $p"
                break
            fi
        done
    else
        print_status "Port $DEFAULT_PORT is available"
    fi
}

# Function to start the application
start_application() {
    print_status "Starting $APP_NAME on port $DEFAULT_PORT..."
    echo ""
    echo -e "${GREEN}🚀 Launching application...${NC}"
    echo -e "${BLUE}📱 Opening browser automatically...${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop the application${NC}"
    echo ""
    
    # Open browser after a short delay to let server start
    (sleep 2 && open http://localhost:$DEFAULT_PORT 2>/dev/null || echo "Could not open browser automatically") &
    
    # Start the server
    if [ -f "src/server.js" ]; then
        PORT=$DEFAULT_PORT node src/server.js
    else
        print_error "Server file not found: src/server.js"
        exit 1
    fi
}

# Function to handle cleanup on exit
cleanup() {
    echo ""
    print_status "Shutting down $APP_NAME..."
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution flow
main() {
    # Check if we're in the correct directory
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Please run this script from the project root directory."
        exit 1
    fi
    
    # Run checks and setup
    check_nodejs
    check_npm
    install_dependencies
    check_port $DEFAULT_PORT
    
    # Start the application
    start_application
}

# Run main function
main "$@"
