(function () {
	function restoreGridState() {
		// Restore grid visibility.
			const gridState = localStorage.getItem('gridState') || 0;
		for (let i = 0; i < gridState; i++) {
			Tools.change('Grid');
		}
	}

	// Selected Tool
	function saveSelectedTool(tool) {
		localStorage.setItem('selected-tool', JSON.stringify({
			name: tool.name,
			secondary: tool.secondary ? tool.secondary.active : false
		}));
	}
	function restoreSelectedTool() {
		var tool = JSON.parse(localStorage.getItem('selected-tool'));
		if (tool) {
			Tools.change(tool.name);
			if (tool.secondary) {
				Tools.change(tool.name);
			}
		} else {
			Tools.change('Hand');
		}
	}

	// Stroke Size
	function saveStrokeSize(size) {
		localStorage.setItem('stroke-size', size);
	}
	function restoreStrokeSize() {
		var size = localStorage.getItem('stroke-size');
		if (size) {
			Tools.setSize(parseFloat(size), 10);
		}
	}

	// Stroke Color
	function saveStrokeColor(color) {
		localStorage.setItem('stroke-color', color);
	}
	function restoreStrokeColor() {
		var color = localStorage.getItem('stroke-color');
		if (color) {
			Tools.setColor(color);
		}
	}

	// Stroke Opacity
	function saveStrokeOpacity(opacity) {
		localStorage.setItem('stroke-opacity', opacity);
	}
	function restoreStrokeOpacity() {
		var opacity = localStorage.getItem('stroke-opacity');
		if (opacity) {
			Tools.setOpacity(parseFloat(opacity, 10));
		}
	}

	window.addEventListener('DOMContentLoaded', function () {
		restoreGridState();
		restoreSelectedTool();
		restoreStrokeSize();
		restoreStrokeColor();
		restoreStrokeOpacity();

		Tools.events.toolChange.add(saveSelectedTool);
		Tools.events.strokeSizeChange.add(saveStrokeSize);
		Tools.events.colorChange.add(saveStrokeColor);
		Tools.events.opacityChange.add(saveStrokeOpacity);
	})
})();
