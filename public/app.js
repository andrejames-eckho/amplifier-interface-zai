class AudioVisualizer {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.lastStatusUpdate = 0;
        this.connectionStatusCheckInterval = null;
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
        this.loadIPs();
        this.startConnectionStatusMonitoring();
    }

    initializeElements() {
        // Sidebar elements
        this.sidebar = document.getElementById('sidebar');
        this.menuContent = document.getElementById('menuContent');
        this.ipCardsList = document.getElementById('ipCardsList');
        this.manageIPsFromMenu = document.getElementById('manageIPsFromMenu');
        
        // Connection elements
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        
        // Modal elements
        this.ipModal = document.getElementById('ipModal');
        this.closeModal = document.getElementById('closeModal');
        this.newIPInput = document.getElementById('newIP');
        this.newIPNameInput = document.getElementById('newIPName');
        this.addIPBtn = document.getElementById('addIPBtn');
        this.savedIPsList = document.getElementById('savedIPsList');
        
        // Channel mute buttons (no longer exist but keep for potential future use)
        this.channelMuteBtns = []; // Empty since we removed the meters
        
        // Channel IP dropdowns (no longer exist but keep for potential future use)
        this.channelIPDropdowns = []; // Empty since we removed the meters
        
        // Channel number dropdowns (no longer exist but keep for potential future use)
        this.channelNumberDropdowns = []; // Empty since we removed the meters
        
        // Error toast
        this.errorToast = document.getElementById('errorToast');
        this.errorMessage = document.getElementById('errorMessage');
        
        // Canvas elements
        this.dropCanvas = document.getElementById('dropCanvas');
        this.clearCanvasBtn = document.getElementById('clearCanvas');
        this.toggleGridBtn = document.getElementById('toggleGrid');
        this.canvasPlaceholder = this.dropCanvas?.querySelector('.canvas-placeholder');
        
        // Meter elements (virtual structure for storing real-time data)
        this.meters = {};
        for (let i = 1; i <= 4; i++) {
            this.meters[`input-${i}`] = {
                value: { textContent: '-60.0' }, // Virtual value storage
                bar: null,
                fill: null
            };
            this.meters[`output-${i}`] = {
                value: { textContent: '-60.0' }, // Virtual value storage
                bar: null,
                fill: null
            };
        }
        
        // Track mute states
        this.muteStates = {
            master: false,
            channels: {}
        };
        
        // IP management
        this.savedIPs = [];
        this.currentIP = null;
        
        // Channel IP assignments
        this.channelIPAssignments = {};
        
        // Channel number assignments (maps display channel to actual amplifier channel)
        this.channelNumberAssignments = {};
        
        // Source assignments for amplifiers (maps amplifier IP and channel to source)
        this.amplifierSourceAssignments = {};
        
        // Canvas and drag drop functionality
        this.dropCanvas = null;
        this.canvasItems = [];
        this.draggedElement = null;
        this.gridEnabled = false;
        this.canvasItemIdCounter = 0;
        
        // Available sources
        this.availableSources = [
            { id: 'microphone-1', name: 'Microphone 1', type: 'Input', icon: '🎤' },
            { id: 'line-in-1', name: 'Line Input 1', type: 'Input', icon: '🎵' },
            { id: 'streaming-1', name: 'Streaming 1', type: 'Digital', icon: '🌐' },
            { id: 'media-player', name: 'Media Player', type: 'Playback', icon: '💿' }
        ];
    }

    bindEvents() {
        // Sidebar events
        this.manageIPsFromMenu.addEventListener('click', () => this.openIPModal());
        this.closeModal.addEventListener('click', () => this.closeIPModal());
        this.addIPBtn.addEventListener('click', () => this.addNewIP());
        
        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === this.ipModal) {
                this.closeIPModal();
            }
        });
        
        // Allow Enter key to add IP
        this.newIPInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewIP();
            }
        });
        
        this.newIPNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewIP();
            }
        });
        
        // Channel IP dropdown change events (no longer exist in main UI)
        if (this.channelIPDropdowns.length > 0) {
            this.channelIPDropdowns.forEach(dropdown => {
                console.log(`🎣 Binding change event to dropdown: ${dropdown.dataset.channel}`);
                dropdown.addEventListener('change', (e) => {
                    console.log(`🎯 Change event fired on ${e.target.dataset.channel}, value: ${e.target.value}`);
                    this.handleChannelIPChange(e.target.dataset.channel, e.target.value);
                });
            });
        } else {
            console.log('⚪ No channel IP dropdowns to bind (expected - meters removed from main UI)');
        }
        
        // Channel number dropdown change events (no longer exist in main UI)
        if (this.channelNumberDropdowns.length > 0) {
            this.channelNumberDropdowns.forEach(dropdown => {
                console.log(`🎣 Binding change event to channel number dropdown: ${dropdown.dataset.channel}`);
                dropdown.addEventListener('change', (e) => {
                    console.log(`🎯 Channel number change event fired on ${e.target.dataset.channel}, value: ${e.target.value}`);
                    this.handleChannelNumberChange(e.target.dataset.channel, e.target.value);
                });
            });
        } else {
            console.log('⚪ No channel number dropdowns to bind (expected - meters removed from main UI)');
        }
        
        // Canvas controls
        if (this.clearCanvasBtn) {
            this.clearCanvasBtn.addEventListener('click', () => this.clearCanvas());
        }
        if (this.toggleGridBtn) {
            this.toggleGridBtn.addEventListener('click', () => this.toggleGrid());
        }
        
        // Initialize drag and drop
        this.initializeDragAndDrop();
    }

    initializeDragAndDrop() {
        console.log('🎯 Initializing drag and drop...');
        
        // Re-get canvas element in case it wasn't available during initial setup
        if (!this.dropCanvas) {
            this.dropCanvas = document.getElementById('dropCanvas');
            console.log('📦 Canvas element found:', !!this.dropCanvas);
        }
        
        if (!this.dropCanvas) {
            console.error('❌ Drop canvas element not found!');
            return;
        }

        // Add drop event listeners to canvas
        console.log('🎯 Adding drop listeners to canvas');
        this.dropCanvas.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropCanvas.addEventListener('drop', (e) => this.handleDrop(e));
        this.dropCanvas.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropCanvas.addEventListener('dragenter', (e) => this.handleDragEnter(e));
        
        console.log('✅ Drag and drop initialization complete');
    }

    handleDragStart(e) {
        console.log('🚀 Drag start triggered');
        const container = e.currentTarget;
        const channel = container.dataset.channel;
        console.log(`📊 Dragging channel: ${channel}`);
        
        // Store dragged element data
        this.draggedElement = {
            channel: channel,
            channelType: channel.split('-')[0], // 'input' or 'output'
            channelId: channel.split('-')[1], // '1', '2', etc.
            assignedIP: this.channelIPAssignments[channel] || this.currentIP || 'Default',
            assignedChannel: this.channelNumberAssignments[channel] || channel.split('-')[1],
            label: container.querySelector('.meter-label').textContent
        };

        console.log('📦 Dragged element data:', this.draggedElement);

        // Add visual feedback
        container.classList.add('dragging');
        
        // Set drag data
        e.dataTransfer.effectAllowed = 'copy';
        const dragData = JSON.stringify(this.draggedElement);
        e.dataTransfer.setData('text/plain', dragData);
        e.dataTransfer.setData('application/json', dragData);
        
        console.log('📤 Drag data set:', dragData);
        
        // Create custom drag image
        const dragImage = this.createDragImage(container);
        e.dataTransfer.setDragImage(dragImage, 50, 25);
        
        console.log('✅ Drag start complete');
    }

    handleDragEnd(e) {
        const container = e.currentTarget;
        container.classList.remove('dragging');
        
        // Clean up canvas drag states
        if (this.dropCanvas) {
            this.dropCanvas.classList.remove('drag-over');
        }
        
        this.draggedElement = null;
    }

    handleSourceDragStart(e) {
        console.log('🚀 Source drag start triggered');
        const sourceItem = e.currentTarget;
        const sourceId = sourceItem.dataset.source;
        const sourceName = sourceItem.querySelector('.source-name').textContent;
        const sourceType = sourceItem.querySelector('.source-type').textContent;
        const sourceIcon = sourceItem.querySelector('.source-icon').textContent;
        
        console.log(`📊 Dragging source: ${sourceId}`);
        
        // Store dragged source data
        this.draggedSource = {
            sourceId: sourceId,
            sourceName: sourceName,
            sourceType: sourceType,
            sourceIcon: sourceIcon
        };

        console.log('📦 Dragged source data:', this.draggedSource);

        // Add visual feedback
        sourceItem.classList.add('dragging');
        
        // Set drag data
        e.dataTransfer.effectAllowed = 'copy';
        const dragData = JSON.stringify(this.draggedSource);
        e.dataTransfer.setData('text/plain', dragData);
        e.dataTransfer.setData('application/json', dragData);
        e.dataTransfer.setData('source-type', 'audio-source');
        
        console.log('📤 Source drag data set:', dragData);
        
        // Create custom drag image
        const dragImage = this.createSourceDragImage(sourceItem);
        e.dataTransfer.setDragImage(dragImage, 50, 25);
        
        console.log('✅ Source drag start complete');
    }

    handleSourceDragEnd(e) {
        const sourceItem = e.currentTarget;
        sourceItem.classList.remove('dragging');
        
        // Clean up amplifier card drag states
        document.querySelectorAll('.ip-card').forEach(card => {
            card.classList.remove('drag-over');
        });
        
        this.draggedSource = null;
    }

    createSourceDragImage(sourceItem) {
        const dragImage = document.createElement('div');
        dragImage.style.cssText = `
            background: rgba(51, 65, 85, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.3);
            border-radius: 8px;
            padding: 10px;
            color: #f8fafc;
            font-size: 14px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 12px rgba(2, 6, 23, 0.3);
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        const sourceIcon = sourceItem.querySelector('.source-icon').textContent;
        const sourceName = sourceItem.querySelector('.source-name').textContent;
        dragImage.innerHTML = `${sourceIcon} ${sourceName}`;
        
        document.body.appendChild(dragImage);
        setTimeout(() => document.body.removeChild(dragImage), 0);
        
        return dragImage;
    }

    setupAmplifierDropZones() {
        const amplifierCards = document.querySelectorAll('.ip-card');
        
        amplifierCards.forEach(card => {
            card.addEventListener('dragover', (e) => this.handleAmplifierDragOver(e));
            card.addEventListener('drop', (e) => this.handleAmplifierDrop(e));
            card.addEventListener('dragleave', (e) => this.handleAmplifierDragLeave(e));
            card.addEventListener('dragenter', (e) => this.handleAmplifierDragEnter(e));
        });
    }

    handleAmplifierDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        
        // Only handle if dragging a source
        if (e.dataTransfer.types.includes('source-type')) {
            const card = e.currentTarget;
            card.classList.add('drag-over');
        }
    }

    handleAmplifierDragEnter(e) {
        e.preventDefault();
        
        // Only handle if dragging a source
        if (e.dataTransfer.types.includes('source-type')) {
            const card = e.currentTarget;
            card.classList.add('drag-over');
        }
    }

    handleAmplifierDragLeave(e) {
        const card = e.currentTarget;
        
        // Only remove if leaving the card entirely
        if (!card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over');
        }
    }

    handleAmplifierDrop(e) {
        e.preventDefault();
        const card = e.currentTarget;
        card.classList.remove('drag-over');

        // Only handle if dragging a source
        if (!e.dataTransfer.types.includes('source-type')) {
            return;
        }

        try {
            let data;
            const jsonData = e.dataTransfer.getData('application/json');
            const textData = e.dataTransfer.getData('text/plain');
            
            if (jsonData) {
                data = JSON.parse(jsonData);
            } else if (textData) {
                data = JSON.parse(textData);
            } else {
                throw new Error('No source drag data found');
            }
            
            console.log('📦 Source dropped on amplifier:', data);
            
            // Get amplifier IP from card
            const amplifierIP = card.querySelector('.ip-card-ip').textContent;
            
            // Show source selection modal or find the first available channel
            this.showSourceAssignmentModal(amplifierIP, data);
            
        } catch (err) {
            console.error('❌ Error parsing source drag data:', err);
            this.showError('Failed to assign source to amplifier');
        }
    }

    showSourceAssignmentModal(amplifierIP, sourceData) {
        // For now, assign to the first available channel
        // In a more advanced implementation, this could show a modal to select the channel
        const availableChannels = ['input-1', 'input-2', 'input-3', 'input-4'];
        
        // Find first unassigned channel or use first channel
        let targetChannel = availableChannels[0];
        const assignedSources = this.getAssignedSourcesForIP(amplifierIP);
        
        for (const channel of availableChannels) {
            if (!assignedSources[channel]) {
                targetChannel = channel;
                break;
            }
        }
        
        // Assign the source
        this.handleSourceAssignment(amplifierIP, targetChannel, sourceData.sourceId);
        
        // Update the dropdown to reflect the assignment
        const dropdown = document.querySelector(`.source-dropdown[data-amplifier="${amplifierIP}"][data-channel="${targetChannel}"]`);
        if (dropdown) {
            dropdown.value = sourceData.sourceId;
        }
        
        console.log(`✅ Assigned ${sourceData.sourceName} to ${amplifierIP} ${targetChannel}`);
    }

    handleDragOver(e) {
        console.log('🎯 Drag over canvas');
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }

    handleDragEnter(e) {
        console.log('📥 Drag enter canvas');
        e.preventDefault();
        this.dropCanvas.classList.add('drag-over');
    }

    handleDragLeave(e) {
        console.log('📤 Drag leave canvas');
        // Only remove drag-over if leaving the canvas entirely
        if (e.target === this.dropCanvas) {
            this.dropCanvas.classList.remove('drag-over');
        }
    }

    handleDrop(e) {
        console.log('🎉 Drop triggered on canvas');
        e.preventDefault();
        this.dropCanvas.classList.remove('drag-over');

        try {
            // Try to get data from different formats
            let data;
            const jsonData = e.dataTransfer.getData('application/json');
            const textData = e.dataTransfer.getData('text/plain');
            const sourceType = e.dataTransfer.getData('source-type');
            
            if (jsonData) {
                data = JSON.parse(jsonData);
            } else if (textData) {
                data = JSON.parse(textData);
            } else {
                throw new Error('No drag data found');
            }
            
            const rect = this.dropCanvas.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;

            // Snap to grid if enabled
            if (this.gridEnabled) {
                x = Math.round(x / 20) * 20;
                y = Math.round(y / 20) * 20;
            }

            // Handle different types of drops
            if (sourceType === 'channel-source') {
                this.addChannelSourceToCanvas(data, x, y);
            } else {
                // Handle legacy meter drops
                this.addCanvasItem(data, x, y);
            }
            
            console.log('✅ Canvas item added successfully');
        } catch (err) {
            console.error('❌ Error parsing drag data:', err);
            console.error('📋 Available data types:', e.dataTransfer.types);
            this.showError('Failed to add item to canvas');
        }
    }

    addChannelSourceToCanvas(data, x, y) {
        console.log('➕ Adding channel source to canvas with data:', data);
        console.log(`📍 Position: x=${x}, y=${y}`);
        
        const itemId = `canvas-item-${++this.canvasItemIdCounter}`;
        console.log(`🆔 Item ID: ${itemId}`);
        
        const canvasItem = {
            id: itemId,
            channelType: data.channel.split('-')[0],
            channelId: data.channel.split('-')[1],
            channelName: data.channelName,
            channelIcon: data.channelIcon, // Add the missing channelIcon
            amplifierIP: data.amplifierIP,
            assignedIP: data.assignedIP,
            assignedChannel: data.assignedChannel,
            label: `${data.channelName} (${data.amplifierIP})`,
            x: x,
            y: y,
            element: null
        };

        console.log('🎨 Creating DOM element');
        console.log('📦 Canvas item data:', canvasItem);
        // Create DOM element
        const element = this.createChannelSourceCanvasElement(canvasItem);
        canvasItem.element = element;

        // Position element
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        console.log('📦 Adding to canvas');
        // Add to canvas
        this.dropCanvas.appendChild(element);
        this.canvasItems.push(canvasItem);

        console.log(`📊 Now have ${this.canvasItems.length} canvas items`);

        // Hide placeholder if this is the first item
        if (this.canvasItems.length === 1 && this.canvasPlaceholder) {
            console.log('🙈 Hiding placeholder');
            this.canvasPlaceholder.classList.add('hidden');
        }

        // Make item draggable within the canvas
        console.log('🎯 Making item draggable');
        this.makeCanvasItemDraggable(canvasItem);

        // Update item with current meter value
        console.log('📈 Updating item value');
        this.updateCanvasItemValue(canvasItem);
        
        // For channel source items, also try to get the current value from the latest data
        if (canvasItem.channelName && canvasItem.amplifierIP) {
            console.log('🎯 Getting current value for channel source item');
            // Try to get current value from virtual meters or set to a default
            const channelKey = `${canvasItem.channelType}-${canvasItem.channelId}`;
            const meter = this.meters[channelKey];
            if (meter && meter.value && meter.value.textContent !== '-60.0') {
                const currentValue = parseFloat(meter.value.textContent);
                console.log(`📊 Setting initial value to: ${currentValue}dB`);
                this.updateCanvasItemValueWithDb(canvasItem, currentValue);
            }
        }
        
        console.log('✅ Channel source canvas item addition complete');
    }

    createChannelSourceCanvasElement(item) {
        const element = document.createElement('div');
        element.className = 'canvas-item channel-source-item meter-style';
        element.id = item.id;
        element.innerHTML = `
            <div class="canvas-item-header">
                <div class="canvas-item-title" contenteditable="false">${item.channelName}</div>
                <div class="canvas-item-controls">
                    <button class="canvas-item-rename" title="Rename">✏️</button>
                    <button class="canvas-item-remove" title="Remove">×</button>
                </div>
            </div>
            <div class="canvas-item-info">
                ${item.amplifierIP}
            </div>
            <div class="meter-display">
                <div class="meter-value">${item.channelIcon}</div>
                <div class="vertical-meter">
                    <div class="meter-bar-container">
                        <div class="meter-bar">
                            <div class="meter-fill"></div>
                        </div>
                        <div class="meter-scale">
                            <span>+60</span>
                            <span>+40</span>
                            <span>+20</span>
                            <span>+10</span>
                            <span>0</span>
                            <span>-6</span>
                            <span>-20</span>
                            <span>-40</span>
                            <span>-60</span>
                        </div>
                    </div>
                    <div class="meter-numeric">
                        <span class="meter-db-value">-60.0</span>
                        <span class="meter-unit">dB</span>
                    </div>
                </div>
            </div>
        `;

        // Add remove button handler
        const removeBtn = element.querySelector('.canvas-item-remove');
        removeBtn.addEventListener('click', () => this.removeCanvasItem(item.id));

        // Add rename button handler
        const renameBtn = element.querySelector('.canvas-item-rename');
        const titleElement = element.querySelector('.canvas-item-title');
        
        renameBtn.addEventListener('click', () => {
            this.startRenaming(item, titleElement);
        });

        // Add double-click to rename
        titleElement.addEventListener('dblclick', () => {
            this.startRenaming(item, titleElement);
        });

        // Handle rename completion
        titleElement.addEventListener('blur', () => {
            this.finishRenaming(item, titleElement);
        });

        titleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleElement.blur();
            } else if (e.key === 'Escape') {
                titleElement.textContent = item.customName || item.channelName;
                titleElement.contentEditable = false;
                titleElement.style.cursor = 'default';
            }
        });

        return element;
    }

    createDragImage(container) {
        const dragImage = document.createElement('div');
        dragImage.style.cssText = `
            background: rgba(51, 65, 85, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.3);
            border-radius: 8px;
            padding: 10px;
            color: #f8fafc;
            font-size: 14px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 12px rgba(2, 6, 23, 0.3);
        `;
        
        const channel = container.dataset.channel;
        const label = container.querySelector('.meter-label').textContent;
        dragImage.innerHTML = `${label} ${channel.split('-')[1].toUpperCase()}`;
        
        document.body.appendChild(dragImage);
        setTimeout(() => document.body.removeChild(dragImage), 0);
        
        return dragImage;
    }

    addCanvasItem(data, x, y) {
        console.log('➕ Adding canvas item with data:', data);
        console.log(`📍 Position: x=${x}, y=${y}`);
        
        const itemId = `canvas-item-${++this.canvasItemIdCounter}`;
        console.log(`🆔 Item ID: ${itemId}`);
        
        const canvasItem = {
            id: itemId,
            ...data,
            x: x,
            y: y,
            element: null
        };

        console.log('🎨 Creating DOM element');
        // Create DOM element
        const element = this.createCanvasItemElement(canvasItem);
        canvasItem.element = element;

        // Position element
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        console.log('📦 Adding to canvas');
        // Add to canvas
        this.dropCanvas.appendChild(element);
        this.canvasItems.push(canvasItem);

        console.log(`📊 Now have ${this.canvasItems.length} canvas items`);

        // Hide placeholder if this is the first item
        if (this.canvasItems.length === 1 && this.canvasPlaceholder) {
            console.log('🙈 Hiding placeholder');
            this.canvasPlaceholder.classList.add('hidden');
        }

        // Make item draggable within the canvas
        console.log('🎯 Making item draggable');
        this.makeCanvasItemDraggable(canvasItem);

        // Update item with current meter value
        console.log('📈 Updating item value');
        this.updateCanvasItemValue(canvasItem);
        
        console.log('✅ Canvas item addition complete');
    }

    createCanvasItemElement(item) {
        const element = document.createElement('div');
        element.className = 'canvas-item';
        element.id = item.id;
        element.innerHTML = `
            <div class="canvas-item-header">
                <div class="canvas-item-title">${item.label} ${item.channelId.toUpperCase()}</div>
                <button class="canvas-item-remove" title="Remove">×</button>
            </div>
            <div class="canvas-item-info">
                IP: ${item.assignedIP} | Channel: ${item.assignedChannel}
            </div>
            <div class="canvas-item-meter">
                <span class="canvas-item-value">-60.0</span>
                <span>dB</span>
                <div class="canvas-item-bar">
                    <div class="canvas-item-fill"></div>
                </div>
            </div>
        `;

        // Add remove button handler
        const removeBtn = element.querySelector('.canvas-item-remove');
        removeBtn.addEventListener('click', () => this.removeCanvasItem(item.id));

        return element;
    }

    makeCanvasItemDraggable(item) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        const element = item.element;

        const handleMouseDown = (e) => {
            if (e.target.classList.contains('canvas-item-remove')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = item.x;
            initialY = item.y;
            
            element.style.zIndex = 1000;
            element.classList.add('selected');
            e.preventDefault();
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            let newX = initialX + (e.clientX - startX);
            let newY = initialY + (e.clientY - startY);
            
            // Snap to grid if enabled
            if (this.gridEnabled) {
                newX = Math.round(newX / 20) * 20;
                newY = Math.round(newY / 20) * 20;
            }
            
            // Keep within canvas bounds
            const canvasRect = this.dropCanvas.getBoundingClientRect();
            const itemRect = element.getBoundingClientRect();
            
            newX = Math.max(0, Math.min(newX, canvasRect.width - itemRect.width));
            newY = Math.max(0, Math.min(newY, canvasRect.height - itemRect.height));
            
            item.x = newX;
            item.y = newY;
            
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            
            isDragging = false;
            element.style.zIndex = '';
            element.classList.remove('selected');
        };

        element.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    removeCanvasItem(itemId) {
        const itemIndex = this.canvasItems.findIndex(item => item.id === itemId);
        if (itemIndex === -1) return;

        const item = this.canvasItems[itemIndex];
        
        // Remove DOM element
        if (item.element) {
            item.element.remove();
        }
        
        // Remove from array
        this.canvasItems.splice(itemIndex, 1);
        
        // Show placeholder if canvas is empty
        if (this.canvasItems.length === 0 && this.canvasPlaceholder) {
            this.canvasPlaceholder.classList.remove('hidden');
        }
    }

    clearCanvas() {
        // Remove all canvas items
        this.canvasItems.forEach(item => {
            if (item.element) {
                item.element.remove();
            }
        });
        
        this.canvasItems = [];
        this.canvasItemIdCounter = 0;
        
        // Show placeholder
        if (this.canvasPlaceholder) {
            this.canvasPlaceholder.classList.remove('hidden');
        }
    }

    toggleGrid() {
        this.gridEnabled = !this.gridEnabled;
        
        if (this.dropCanvas) {
            if (this.gridEnabled) {
                this.dropCanvas.classList.add('grid-enabled');
                this.toggleGridBtn.textContent = 'Disable Grid';
            } else {
                this.dropCanvas.classList.remove('grid-enabled');
                this.toggleGridBtn.textContent = 'Toggle Grid';
            }
        }
    }

    updateCanvasItemValue(item) {
        if (!item.element) return;

        // For channel source items, we can't get value from meters since they were removed
        // Instead, we'll rely on updateCanvasItemValueWithDb which is called directly
        // from updateCanvasItemsForChannel with the actual dB value
        
        // Check if this is a channel source item (has channelName and amplifierIP)
        if (item.channelName && item.amplifierIP) {
            // This is a channel source item - value will be updated via updateCanvasItemValueWithDb
            return;
        }

        // Fallback for legacy items (if any exist)
        const channelKey = `${item.channelType}-${item.channelId}`;
        const meter = this.meters[channelKey];
        
        if (meter) {
            const value = meter.value.textContent;
            const fillElement = item.element.querySelector('.canvas-item-fill');
            const valueElement = item.element.querySelector('.canvas-item-value');
            
            if (valueElement) {
                valueElement.textContent = value;
            }
            
            if (fillElement) {
                const dbValue = parseFloat(value);
                const percentage = ((dbValue + 60) / 120) * 100;
                fillElement.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
                
                // Update color based on level
                let color;
                if (dbValue > 0) {
                    color = '#f44336';
                } else if (dbValue > -6) {
                    color = '#FF9800';
                } else {
                    color = '#4CAF50';
                }
                fillElement.style.background = color;
            }
        }
    }

    updateAllCanvasItems() {
        this.canvasItems.forEach(item => {
            this.updateCanvasItemValue(item);
        });
    }

    updateCanvasItemsForChannel(channelType, channelId, dbValue) {
        console.log(`🔄 Updating canvas items for ${channelType}-${channelId} with ${dbValue}dB`);
        console.log(`📊 Current canvas items:`, this.canvasItems.map(item => ({
            id: item.id,
            channelType: item.channelType,
            channelId: item.channelId,
            channelName: item.channelName,
            amplifierIP: item.amplifierIP
        })));
        
        this.canvasItems.forEach(item => {
            // Check if this canvas item matches the updated channel
            const isChannelSourceMatch = item.channelType === channelType && item.channelId === channelId;
            const isLegacyMatch = item.channelType === channelType && item.channelId === channelId;
            
            console.log(`🔍 Checking item ${item.id}: ${item.channelName} - channelType: ${item.channelType}, channelId: ${item.channelId} - Match: ${isChannelSourceMatch || isLegacyMatch}`);
            
            if (isChannelSourceMatch || isLegacyMatch) {
                console.log(`✅ Updating item ${item.id} (${item.channelName}) with ${dbValue}dB`);
                this.updateCanvasItemValueWithDb(item, dbValue);
            }
        });
    }

    updateCanvasItemValueWithDb(item, dbValue) {
        if (!item.element) return;

        // Update the numeric dB value
        const dbValueElement = item.element.querySelector('.meter-db-value');
        if (dbValueElement) {
            dbValueElement.textContent = dbValue.toFixed(1);
        }
        
        // Update the vertical meter bar
        const fillElement = item.element.querySelector('.meter-fill');
        if (fillElement) {
            // Calculate bar height (0% at -60dB, 100% at +60dB)
            const percentage = ((dbValue + 60) / 120) * 100;
            fillElement.style.height = `${Math.max(0, Math.min(100, percentage))}%`;
            
            // Update color - always green
            const color = '#4CAF50'; // Green
            fillElement.style.background = `linear-gradient(to top, ${color} 0%, ${color} 100%)`;
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        console.log(`Connecting to WebSocket at ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.lastStatusUpdate = Date.now();
            this.loadIPs(); // Load IPs when WebSocket connects
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
                
                // Update last status update timestamp for monitoring
                if (data.type === 'status') {
                    this.lastStatusUpdate = Date.now();
                }
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.ws = null;
            
            // Attempt to reconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
            } else {
                this.showError('Lost connection to server. Please refresh the page.');
            }
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            this.showError('WebSocket connection error');
        };
    }

    startConnectionStatusMonitoring() {
        // Check if we're receiving status updates regularly
        this.connectionStatusCheckInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = now - this.lastStatusUpdate;
            
            // Only show warning if we're supposed to be connected but haven't received updates for 20 seconds
            if (timeSinceLastUpdate > 20000 && this.isConnected) {
                if (!this.statusIndicator.classList.contains('warning')) {
                    console.warn('⚠️ No status updates received for 20 seconds');
                    this.statusText.textContent = 'Connected (checking...)';
                    this.statusIndicator.classList.add('warning');
                }
            } else if (this.isConnected && this.statusIndicator.classList.contains('warning') && timeSinceLastUpdate < 20000) {
                // Clear warning state if we start receiving updates again
                this.statusIndicator.classList.remove('warning');
                this.statusText.textContent = `Connected to ${this.currentIP || 'amplifier'}`;
            }
        }, 10000); // Check every 10 seconds instead of 5
    }

    stopConnectionStatusMonitoring() {
        if (this.connectionStatusCheckInterval) {
            clearInterval(this.connectionStatusCheckInterval);
            this.connectionStatusCheckInterval = null;
        }
    }

    handleMessage(data) {
        console.log('📨 Frontend received message:', data);
        switch (data.type) {
            case 'status':
                console.log('🔄 Updating connection status to:', data.connected);
                this.updateConnectionStatus(data.connected, data.amplifierIP);
                break;
            case 'audioData':
                console.log(`🎵 Audio data received: ${data.channelType}-${data.channelId} = ${data.db}dB`);
                this.updateMeter(data.channelType, data.channelId, data.db);
                break;
            case 'muteStatus':
                console.log(`🔇 Mute status received: ${data.channelType}-${data.channelId} = ${data.muted}`);
                this.updateMuteStatus(data.channelType, data.channelId, data.muted);
                break;
            case 'error':
                console.error('❌ Error message received:', data.message);
                this.showError(data.message);
                break;
            default:
                console.log('❓ Unknown message type:', data.type);
        }
    }

    updateConnectionStatus(connected, amplifierIP) {
        this.isConnected = connected;
        
        if (connected) {
            this.statusIndicator.classList.remove('disconnected', 'warning');
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = `Connected to ${amplifierIP}`;
            
            // Channel controls are no longer in the main UI, but keep this for potential future use
            // this.channelMuteBtns.forEach(btn => btn.disabled = false);
            // this.channelIPDropdowns.forEach(dropdown => dropdown.disabled = false);
            // this.channelNumberDropdowns.forEach(dropdown => dropdown.disabled = false);
            
            // Clear any warning state when we get a status update
            this.statusIndicator.classList.remove('warning');
        } else {
            this.statusIndicator.classList.remove('connected', 'warning');
            this.statusIndicator.classList.add('disconnected');
            this.statusText.textContent = 'Disconnected';
            
            // Channel controls are no longer in the main UI, but keep this for potential future use
            // this.channelMuteBtns.forEach(btn => btn.disabled = true);
            // this.channelIPDropdowns.forEach(dropdown => dropdown.disabled = true);
            // this.channelNumberDropdowns.forEach(dropdown => dropdown.disabled = true);
            
            // Reset all meters to -60dB
            this.resetAllMeters();
            
            // Reset mute states
            this.resetMuteStates();
        }
    }

    async toggleMasterMute() {
        // Disabled - now an indicator only
        console.log('Master mute is now indicator only - use amplifier to control mute');
    }

    async toggleChannelMute(channel, button) {
        // Disabled - now indicator only
        console.log('Channel mute is now indicator only - use amplifier to control mute');
    }


    updateChannelMuteButton(button, isMuted) {
        const icon = button.querySelector('.mute-icon');
        if (isMuted) {
            button.classList.add('muted');
            icon.textContent = '🔇';
        } else {
            button.classList.remove('muted');
            icon.textContent = '🔊';
        }
    }

    resetMuteStates() {
        this.muteStates.master = false;
        this.muteStates.channels = {};
        
        // Reset all channel mute buttons and meter containers (no longer exist in main UI)
        // this.channelMuteBtns.forEach(btn => {
        //     btn.classList.remove('muted');
        //     btn.querySelector('.mute-icon').textContent = '🔊';
        // });
        
        // Reset all meter container styling (no longer exist in main UI)
        // document.querySelectorAll('.meter-container.muted').forEach(container => {
        //     container.classList.remove('muted');
        // });
    }

    updateMuteStatus(channelType, channelId, isMuted) {
        // Only update if we're connected to avoid race conditions
        if (!this.isConnected) {
            return;
        }
        
        // Handle master mute status
        if (channelType === 'output' && channelId === 0) {
            this.muteStates.master = isMuted;
            return;
        }
        
        const channelKey = `${channelType}-${channelId}`;
        
        // Update local mute state to match amplifier
        this.muteStates.channels[channelKey] = isMuted;
        
        // Find the corresponding button and update it (no longer exist in main UI)
        // const button = document.querySelector(`[data-channel="${channelKey}"]`);
        // if (button) {
        //     this.updateChannelMuteButton(button, isMuted);
        // }
        
        // Also update the meter container styling (no longer exist in main UI)
        // const meterContainer = document.querySelector(`.meter-container[data-channel="${channelKey}"]`);
        // if (meterContainer) {
        //     if (isMuted) {
        //         meterContainer.classList.add('muted');
        //     } else {
        //         meterContainer.classList.remove('muted');
        //     }
        // }
    }

    updateMeter(channelType, channelId, dbValue) {
        const channelKey = `${channelType}-${channelId}`;
        const meter = this.meters[channelKey];
        
        console.log(`📊 updateMeter called: ${channelKey} = ${dbValue}dB`);
        
        if (!meter) {
            console.error(`Unknown channel: ${channelKey}`);
            return;
        }
        
        // Clamp value to range -60 to +60
        const clampedDb = Math.max(-60, Math.min(60, dbValue));
        
        console.log(`📈 Clamped value: ${clampedDb}dB`);
        
        // Update virtual meter value
        meter.value.textContent = clampedDb.toFixed(1);
        
        // Update corresponding canvas items with real-time data
        console.log(`🔄 Calling updateCanvasItemsForChannel for ${channelType}-${channelId}`);
        this.updateCanvasItemsForChannel(channelType, channelId, clampedDb);
    }

    updateMeterColor(fillElement, dbValue) {
        let color;
        
        if (dbValue > 0) {
            // Red for clipping (> 0dB)
            color = '#f44336';
        } else if (dbValue > -6) {
            // Yellow for warning (-6dB to 0dB)
            color = '#FF9800';
        } else {
            // Green for normal (< -6dB)
            color = '#4CAF50';
        }
        
        fillElement.style.background = `linear-gradient(to top, ${color} 0%, ${color} 100%)`;
    }

    resetAllMeters() {
        Object.keys(this.meters).forEach(channelKey => {
            const meter = this.meters[channelKey];
            meter.value.textContent = '-60.0';
        });
        
        // Also reset all canvas items to -60dB
        this.canvasItems.forEach(item => {
            this.updateCanvasItemValueWithDb(item, -60.0);
        });
    }

    async loadIPs() {
        try {
            const response = await fetch('/api/ips');
            const result = await response.json();
            
            if (response.ok) {
                this.savedIPs = result.ips || [];
                this.currentIP = result.currentIP;
                this.updateConnectionStatus(this.isConnected, this.currentIP);
                this.renderIPCards(); // Render cards in hamburger menu
                this.populateChannelIPDropdowns(); // Populate channel dropdowns
                this.loadChannelNumberAssignments(); // Load channel number assignments
                this.loadSourceAssignments(); // Load source assignments
            }
        } catch (err) {
            console.error('Failed to load IPs:', err);
        }
    }

    async loadChannelNumberAssignments() {
        try {
            const response = await fetch('/api/channel-assignments');
            const result = await response.json();
            
            if (response.ok) {
                this.channelNumberAssignments = result.channelNumberAssignments || {};
                this.populateChannelNumberDropdowns(); // Populate channel number dropdowns
            }
        } catch (err) {
            console.error('Failed to load channel number assignments:', err);
        }
    }



    openIPModal() {
        this.ipModal.style.display = 'block';
        this.loadSavedIPs();
    }

    closeIPModal() {
        this.ipModal.style.display = 'none';
        this.newIPInput.value = '';
        this.newIPNameInput.value = '';
    }

    async addNewIP() {
        const ip = this.newIPInput.value.trim();
        const name = this.newIPNameInput.value.trim();
        
        if (!ip) {
            this.showError('IP address is required');
            return;
        }
        
        if (!this.isValidIP(ip)) {
            this.showError('Invalid IP address format');
            return;
        }
        
        try {
            this.addIPBtn.disabled = true;
            this.addIPBtn.textContent = 'Adding...';
            
            const response = await fetch('/api/ips', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip, name })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to add IP');
            }
            
            this.newIPInput.value = '';
            this.newIPNameInput.value = '';
            this.loadSavedIPs();
            this.loadIPs(); // Refresh the main dropdown and cards
            
        } catch (err) {
            this.showError(err.message);
        } finally {
            this.addIPBtn.disabled = false;
            this.addIPBtn.textContent = 'Add';
        }
    }

    async loadSavedIPs() {
        try {
            const response = await fetch('/api/ips');
            const result = await response.json();
            
            if (response.ok) {
                this.savedIPs = result.ips || [];
                this.renderSavedIPs();
            }
        } catch (err) {
            console.error('Failed to load saved IPs:', err);
        }
    }

    renderSavedIPs() {
        this.savedIPsList.innerHTML = '';
        
        if (this.savedIPs.length === 0) {
            this.savedIPsList.innerHTML = '<div class="no-ips">No saved IP addresses</div>';
            return;
        }
        
        this.savedIPs.forEach(ip => {
            const ipItem = document.createElement('div');
            ipItem.className = 'ip-item';
            if (ip.ip === this.currentIP) {
                ipItem.classList.add('current-ip');
            }
            
            ipItem.innerHTML = `
                <div class="ip-info">
                    <div class="ip-name">${ip.name || ip.ip}</div>
                    <div class="ip-address">${ip.ip}</div>
                </div>
                <div class="ip-actions">
                    <button class="delete-btn" data-id="${ip.id}">Delete</button>
                </div>
            `;
            
            this.savedIPsList.appendChild(ipItem);
        });
        
        // Add delete event listeners
        this.savedIPsList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.deleteIP(id);
            });
        });
    }

    async deleteIP(id) {
        if (!confirm('Are you sure you want to delete this IP address?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/ips/${id}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to delete IP');
            }
            
            this.loadSavedIPs();
            this.loadIPs(); // Refresh the main dropdown and cards
            
        } catch (err) {
            this.showError(err.message);
        }
    }

    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }


    renderIPCards() {
        this.ipCardsList.innerHTML = '';
        
        if (this.savedIPs.length === 0) {
            this.ipCardsList.innerHTML = '<div class="no-ips">No saved amplifiers</div>';
            return;
        }
        
        this.savedIPs.forEach(ip => {
            const ipCard = document.createElement('div');
            ipCard.className = 'ip-card';
            if (ip.ip === this.currentIP) {
                ipCard.classList.add('active');
            }
            
            ipCard.innerHTML = `
                <div class="ip-card-header">
                    <div class="ip-card-name">${ip.name || ip.ip}</div>
                    <div class="ip-card-status">${ip.ip === this.currentIP ? 'Current' : 'Available'}</div>
                </div>
                <div class="ip-card-ip">${ip.ip}</div>
                
                <div class="amplifier-sources">
                    <div class="sources-section">
                        <div class="sources-label">Inputs</div>
                        <div class="sources-list">
                            <div class="channel-source-item" data-channel="input-1" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🎙️</div>
                                <div class="channel-info">
                                    <div class="channel-name">Input 1</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="input-2" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🎙️</div>
                                <div class="channel-info">
                                    <div class="channel-name">Input 2</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="input-3" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🎙️</div>
                                <div class="channel-info">
                                    <div class="channel-name">Input 3</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="input-4" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🎙️</div>
                                <div class="channel-info">
                                    <div class="channel-name">Input 4</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="sources-section">
                        <div class="sources-label">Outputs</div>
                        <div class="sources-list">
                            <div class="channel-source-item" data-channel="output-1" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🔊</div>
                                <div class="channel-info">
                                    <div class="channel-name">Output 1</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="output-2" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🔊</div>
                                <div class="channel-info">
                                    <div class="channel-name">Output 2</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="output-3" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🔊</div>
                                <div class="channel-info">
                                    <div class="channel-name">Output 3</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                            <div class="channel-source-item" data-channel="output-4" data-amplifier="${ip.ip}" draggable="true">
                                <div class="channel-icon">🔊</div>
                                <div class="channel-info">
                                    <div class="channel-name">Output 4</div>
                                    <div class="channel-type">Channel</div>
                                </div>
                                <div class="drag-handle">⋮⋮</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            ipCard.addEventListener('click', () => this.switchToIP(ip.ip));
            this.ipCardsList.appendChild(ipCard);
        });
        
        // Add event listeners to channel source items
        this.bindChannelSourceEvents();
    }

    bindChannelSourceEvents() {
        const channelSources = this.ipCardsList.querySelectorAll('.channel-source-item');
        
        channelSources.forEach(sourceItem => {
            sourceItem.addEventListener('dragstart', (e) => {
                this.handleChannelSourceDragStart(e);
            });
            sourceItem.addEventListener('dragend', (e) => {
                this.handleChannelSourceDragEnd(e);
            });
        });
    }

    handleChannelSourceDragStart(e) {
        console.log('🚀 Channel source drag start triggered');
        const sourceItem = e.currentTarget;
        const channel = sourceItem.dataset.channel;
        const amplifierIP = sourceItem.dataset.amplifier;
        const channelName = sourceItem.querySelector('.channel-name').textContent;
        const channelType = sourceItem.querySelector('.channel-type').textContent;
        const channelIcon = sourceItem.querySelector('.channel-icon').textContent;
        
        console.log(`📊 Dragging channel source: ${channel} from ${amplifierIP}`);
        
        // Store dragged channel source data
        this.draggedChannelSource = {
            channel: channel,
            amplifierIP: amplifierIP,
            channelName: channelName,
            channelType: channelType,
            channelIcon: channelIcon,
            assignedIP: this.channelIPAssignments[channel] || amplifierIP,
            assignedChannel: this.channelNumberAssignments[channel] || channel.split('-')[1]
        };

        console.log('📦 Dragged channel source data:', this.draggedChannelSource);

        // Add visual feedback
        sourceItem.classList.add('dragging');
        
        // Set drag data
        e.dataTransfer.effectAllowed = 'copy';
        const dragData = JSON.stringify(this.draggedChannelSource);
        e.dataTransfer.setData('text/plain', dragData);
        e.dataTransfer.setData('application/json', dragData);
        e.dataTransfer.setData('source-type', 'channel-source');
        
        console.log('📤 Channel source drag data set:', dragData);
        
        // Create custom drag image
        const dragImage = this.createChannelSourceDragImage(sourceItem);
        e.dataTransfer.setDragImage(dragImage, 50, 25);
        
        console.log('✅ Channel source drag start complete');
    }

    handleChannelSourceDragEnd(e) {
        const sourceItem = e.currentTarget;
        sourceItem.classList.remove('dragging');
        
        // Clean up canvas drag states
        if (this.dropCanvas) {
            this.dropCanvas.classList.remove('drag-over');
        }
        
        this.draggedChannelSource = null;
    }

    createChannelSourceDragImage(sourceItem) {
        const dragImage = document.createElement('div');
        dragImage.style.cssText = `
            background: rgba(51, 65, 85, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.3);
            border-radius: 8px;
            padding: 10px;
            color: #f8fafc;
            font-size: 14px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 12px rgba(2, 6, 23, 0.3);
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        const channelIcon = sourceItem.querySelector('.channel-icon').textContent;
        const channelName = sourceItem.querySelector('.channel-name').textContent;
        const amplifierIP = sourceItem.dataset.amplifier;
        dragImage.innerHTML = `${channelIcon} ${channelName} (${amplifierIP})`;
        
        document.body.appendChild(dragImage);
        setTimeout(() => document.body.removeChild(dragImage), 0);
        
        return dragImage;
    }

    bindSourceDropdownEvents() {
        const sourceDropdowns = this.ipCardsList.querySelectorAll('.source-dropdown');
        sourceDropdowns.forEach(dropdown => {
            dropdown.addEventListener('change', (e) => {
                const amplifierIP = e.target.dataset.amplifier;
                const channel = e.target.dataset.channel;
                const sourceId = e.target.value;
                
                this.handleSourceAssignment(amplifierIP, channel, sourceId);
            });
            
            // Prevent dropdown clicks from triggering card click (IP switching)
            dropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
    }

    getAssignedSourcesForIP(ip) {
        if (!this.amplifierSourceAssignments[ip]) {
            return {};
        }
        return this.amplifierSourceAssignments[ip];
    }

    handleSourceAssignment(amplifierIP, channel, sourceId) {
        console.log(`🔄 Assigning source ${sourceId} to ${amplifierIP} channel ${channel}`);
        
        // Initialize assignments for this amplifier if needed
        if (!this.amplifierSourceAssignments[amplifierIP]) {
            this.amplifierSourceAssignments[amplifierIP] = {};
        }
        
        // Update assignment
        if (sourceId === '') {
            delete this.amplifierSourceAssignments[amplifierIP][channel];
            console.log(`🗑️ Removed source assignment for ${amplifierIP} channel ${channel}`);
        } else {
            this.amplifierSourceAssignments[amplifierIP][channel] = sourceId;
            console.log(`✅ Assigned source ${sourceId} to ${amplifierIP} channel ${channel}`);
        }
        
        // Send assignment to server for persistence
        this.sendSourceAssignment(amplifierIP, channel, sourceId);
    }

    async sendSourceAssignment(amplifierIP, channel, sourceId) {
        try {
            const response = await fetch('/api/source-assignment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amplifierIP, channel, sourceId })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to assign source');
            }
            
            console.log(`✅ Source assignment saved to server`);
        } catch (err) {
            console.error('❌ Failed to save source assignment:', err);
            this.showError(err.message);
        }
    }

    async loadSourceAssignments() {
        try {
            const response = await fetch('/api/source-assignments');
            const result = await response.json();
            
            if (response.ok) {
                this.amplifierSourceAssignments = result.assignments || {};
                console.log('📋 Loaded source assignments:', this.amplifierSourceAssignments);
                // Re-render IP cards to show loaded assignments
                this.renderIPCards();
            }
        } catch (err) {
            console.error('Failed to load source assignments:', err);
        }
    }

    async switchToIP(ip) {
        if (ip === this.currentIP) {
            return; // Already connected to this IP
        }
        
        try {
            // Show loading state
            const cards = this.ipCardsList.querySelectorAll('.ip-card');
            cards.forEach(card => {
                if (card.querySelector('.ip-card-ip').textContent === ip) {
                    card.style.opacity = '0.6';
                    card.style.pointerEvents = 'none';
                }
            });
            
            // First, bulk assign all channels to this IP
            console.log(`🔄 Bulk assigning all channels to IP: ${ip}`);
            const bulkResponse = await fetch('/api/bulk-assign', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const bulkResult = await bulkResponse.json();
            
            if (!bulkResponse.ok) {
                throw new Error(bulkResult.error || 'Failed to bulk assign channels');
            }
            
            console.log(`✅ Bulk assignment successful:`, bulkResult);
            
            // Update local assignments with server response
            this.channelIPAssignments = bulkResult.channelIPAssignments;
            this.channelNumberAssignments = bulkResult.channelNumberAssignments;
            
            // Update dropdowns to reflect new assignments
            this.populateChannelIPDropdowns();
            this.populateChannelNumberDropdowns();
            
            // Then switch the main connection to this IP
            const response = await fetch('/api/switch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ip })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Switch failed');
            }
            
            this.currentIP = ip;
            this.renderIPCards();
            
        } catch (err) {
            this.showError(err.message);
            // Reset card states on error
            this.renderIPCards();
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorToast.classList.add('show');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    hideError() {
        this.errorToast.classList.remove('show');
    }

    populateChannelIPDropdowns() {
        console.log(`🔄 Populating channel IP dropdowns...`);
        console.log(`📋 Available IPs:`, this.savedIPs);
        console.log(`🎛️ Found ${this.channelIPDropdowns.length} dropdowns`);
        
        // Channel dropdowns no longer exist in main UI, but keep function for potential future use
        if (this.channelIPDropdowns.length === 0) {
            console.log('⚪ No channel IP dropdowns found (expected - meters removed from main UI)');
            return;
        }
        
        this.channelIPDropdowns.forEach(dropdown => {
            const channel = dropdown.dataset.channel;
            console.log(`📍 Processing dropdown for channel: ${channel}`);
            
            // Clear existing options except the default
            dropdown.innerHTML = '<option value="">Default</option>';
            
            // Add saved IPs
            this.savedIPs.forEach(ip => {
                const option = document.createElement('option');
                option.value = ip.ip;
                option.textContent = `${ip.name || ip.ip} (${ip.ip})`;
                
                // Set as selected if this channel is assigned to this IP
                if (this.channelIPAssignments[channel] === ip.ip) {
                    option.selected = true;
                    console.log(`✅ Pre-selecting IP ${ip.ip} for channel ${channel}`);
                }
                
                dropdown.appendChild(option);
            });
            
            // Enable/disable based on connection status
            dropdown.disabled = !this.isConnected;
            console.log(`🔌 Dropdown ${channel} enabled: ${!dropdown.disabled}`);
        });
        
        console.log(`✅ Channel IP dropdowns populated`);
    }

    populateChannelNumberDropdowns() {
        console.log(`🔄 Populating channel number dropdowns...`);
        console.log(`📋 Channel number assignments:`, this.channelNumberAssignments);
        console.log(`🎛️ Found ${this.channelNumberDropdowns.length} channel number dropdowns`);
        
        // Channel dropdowns no longer exist in main UI, but keep function for potential future use
        if (this.channelNumberDropdowns.length === 0) {
            console.log('⚪ No channel number dropdowns found (expected - meters removed from main UI)');
            return;
        }
        
        this.channelNumberDropdowns.forEach(dropdown => {
            const channel = dropdown.dataset.channel;
            console.log(`📍 Processing channel number dropdown for channel: ${channel}`);
            
            // Only set the selected value if this channel has an explicit assignment
            const assignedChannelNumber = this.channelNumberAssignments[channel];
            if (assignedChannelNumber) {
                dropdown.value = assignedChannelNumber.toString();
                console.log(`✅ Set channel number for ${channel}: ${assignedChannelNumber}`);
            } else {
                // No assignment - leave dropdown unselected (first option will be empty)
                dropdown.selectedIndex = 0;
                console.log(`⚪ No channel number assignment for ${channel} - leaving unselected`);
            }
            
            // Enable/disable based on connection status
            dropdown.disabled = !this.isConnected;
            console.log(`🔌 Channel number dropdown ${channel} enabled: ${!dropdown.disabled}`);
        });
        
        console.log(`✅ Channel number dropdowns populated`);
    }

    handleChannelIPChange(channel, selectedIP) {
        console.log(`🔄 Channel IP Change triggered: ${channel} -> ${selectedIP}`);
        console.log(`🔗 Connection status: ${this.isConnected}`);
        
        // Temporarily allow changes even when not connected for testing
        if (!this.isConnected) {
            console.log('⚠️ Not connected, but allowing change for testing');
            // return; // Commented out for testing
        }
        
        // Update the channel IP assignment
        if (selectedIP === '') {
            delete this.channelIPAssignments[channel];
            console.log(`Channel ${channel} reverted to default IP monitoring`);
        } else {
            this.channelIPAssignments[channel] = selectedIP;
            console.log(`Channel ${channel} assigned to monitor IP: ${selectedIP}`);
        }
        
        console.log(`📤 Sending assignment to server...`);
        // Send assignment to server
        this.sendChannelIPAssignment(channel, selectedIP);
    }

    async sendChannelIPAssignment(channel, ip) {
        try {
            console.log(`📡 Sending request: POST /api/channel-ip with body:`, { channel, ip });
            
            const response = await fetch('/api/channel-ip', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channel, ip })
            });
            
            console.log(`📥 Response status: ${response.status} ${response.statusText}`);
            
            const result = await response.json();
            console.log(`📥 Response data:`, result);
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to assign IP to channel');
            }
            
            console.log(`✅ Channel ${channel} IP assignment updated successfully`);
            
        } catch (err) {
            console.error('❌ Failed to update channel IP assignment:', err);
            this.showError(err.message);
            
            // Revert dropdown to previous state on error
            const dropdown = document.querySelector(`[data-channel="${channel}"]`);
            if (dropdown) {
                dropdown.value = this.channelIPAssignments[channel] || '';
            }
        }
    }

    handleChannelNumberChange(channel, selectedChannelNumber) {
        console.log(`🔄 Channel Number Change triggered: ${channel} -> ${selectedChannelNumber}`);
        console.log(`🔗 Connection status: ${this.isConnected}`);
        
        // Temporarily allow changes even when not connected for testing
        if (!this.isConnected) {
            console.log('⚠️ Not connected, but allowing channel number change for testing');
        }
        
        // Update the channel number assignment
        this.channelNumberAssignments[channel] = parseInt(selectedChannelNumber);
        console.log(`Channel ${channel} assigned to amplifier channel: ${selectedChannelNumber}`);
        
        console.log(`📤 Sending channel number assignment to server...`);
        // Send assignment to server
        this.sendChannelNumberAssignment(channel, selectedChannelNumber);
    }

    async sendChannelNumberAssignment(channel, channelNumber) {
        try {
            console.log(`📡 Sending request: POST /api/channel-number with body:`, { channel, channelNumber });
            
            const response = await fetch('/api/channel-number', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channel, channelNumber })
            });
            
            console.log(`📥 Response status: ${response.status} ${response.statusText}`);
            
            const result = await response.json();
            console.log(`📥 Response data:`, result);
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to assign channel number');
            }
            
            console.log(`✅ Channel ${channel} number assignment updated successfully`);
            
        } catch (err) {
            console.error('❌ Failed to update channel number assignment:', err);
            this.showError(err.message);
            
            // Revert dropdown to previous state on error
            const dropdown = document.querySelector(`.channel-number-dropdown[data-channel="${channel}"]`);
            if (dropdown) {
                const previousValue = this.channelNumberAssignments[channel];
                if (previousValue) {
                    dropdown.value = previousValue.toString();
                } else {
                    dropdown.selectedIndex = 0;
                }
            }
        }
    }

    startRenaming(item, titleElement) {
        // Make title editable
        titleElement.contentEditable = true;
        titleElement.style.cursor = 'text';
        titleElement.style.backgroundColor = 'rgba(51, 65, 85, 0.5)';
        titleElement.style.padding = '2px 4px';
        titleElement.style.borderRadius = '4px';
        
        // Focus and select all text
        titleElement.focus();
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    finishRenaming(item, titleElement) {
        // Make title non-editable
        titleElement.contentEditable = false;
        titleElement.style.cursor = 'default';
        titleElement.style.backgroundColor = 'transparent';
        titleElement.style.padding = '0';
        
        // Get the new name
        const newName = titleElement.textContent.trim();
        
        if (newName && newName !== (item.customName || item.channelName)) {
            // Update the item's custom name
            item.customName = newName;
            console.log(`✅ Renamed "${item.channelName}" to "${newName}"`);
            
            // Optionally save to server for persistence
            this.saveCanvasItemName(item.id, newName);
        } else if (!newName) {
            // Revert to original name if empty
            titleElement.textContent = item.customName || item.channelName;
        }
    }

    async saveCanvasItemName(itemId, customName) {
        try {
            const response = await fetch('/api/canvas-item-name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ itemId, customName })
            });
            
            if (!response.ok) {
                console.warn('Failed to save custom name to server');
            }
        } catch (err) {
            console.warn('Failed to save custom name:', err);
        }
    }
}

// Initialize the application when DOM is loaded

document.addEventListener('DOMContentLoaded', () => {
    new AudioVisualizer();
});

// Export for potential testing
window.AudioVisualizer = AudioVisualizer;
