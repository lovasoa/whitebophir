/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

var Tools = {};

Tools.params = {};

Tools.i18n = (function i18n() {
    var translations = JSON.parse(document.getElementById("translations").text);
    return {
        "t": function translate(s) {
            var key = s.toLowerCase().replace(/ /g, '_');
            return translations[key] || s;
        }
    };
})();
Tools.server_config = JSON.parse(document.getElementById("configuration").text);

document.getElementById('cabinetURL').setAttribute('href', Tools.server_config.CABINET_URL);
Tools.board = document.getElementById("board");
Tools.svg = document.getElementById("canvas");
Tools.drawingArea = Tools.svg.getElementById("drawingArea");

//Initialization
Tools.curTool = null;
Tools.drawingEvent = true;
Tools.showMarker = true;
Tools.showOtherCursors = true;
Tools.showMyCursor = false;

Tools.isIE = /MSIE|Trident/.test(window.navigator.userAgent);

Tools.socket = null;
Tools.connect = function () {
    var self = this;

    // Destroy socket if one already exists
    if (self.socket) {
        self.socket.destroy();
        delete self.socket;
        self.socket = null;
    }


    this.socket = io.connect('', {
        "path": window.location.pathname.split("/boards/")[0] + "/socket.io",
        "reconnection": true,
        "reconnectionDelay": 100, //Make the xhr connections as fast as possible
        "timeout": 1000 * 60 * 20 // Timeout after 20 minutes
    });

    const preloaderEl = document.getElementById("preloader");
    //Receive draw instructions from the server
    this.socket.on("broadcast", function (msg) {
        handleMessage(msg).finally(function afterload() {
            if (!preloaderEl.classList.contains('hide')) {
                preloaderEl.classList.add("hide");
                setTimeout(function () {
                    Tools.socket.emit('getSelectedElements', Tools.boardName);
                }, 300);
            }
        });
    });

    this.socket.on("addActionToHistory", function (msg) {
        Tools.addActionToHistory(msg, true);
    });

    this.socket.on("addActionToHistoryRedo", function (msg) {
        Tools.historyRedo.push(msg);
        Tools.enableToolsEl('redo');
    });

    this.socket.on("dublicateObject", function (msg) {
        var instrument = Tools.list[msg.tool];
        if (msg.tool === 'Pencil') {
            if (!msg.properties) {
                msg.properties = [['d', document.getElementById(msg.id).getAttribute('d')]];
                msg._children = [];
            }
        }
        msg.id = Tools.generateUID();
        Tools.drawAndSend(msg, instrument);
        Tools.list.Transform.selectElement(document.getElementById(msg.id), {dx: 20, dy: 20});
        Tools.addActionToHistory({type: "delete", id: msg.id})
    });

    this.socket.on("reconnect", function onReconnection() {
        Tools.socket.emit('joinboard', Tools.boardName);
    });
};

Tools.connect();

Tools.boardName = (function () {
    var path = window.location.pathname.split("/");
    return decodeURIComponent(path[path.length - 1]);
})();

Tools.boardTitle = Tools.boardName;

//Get the board as soon as the page is loaded
Tools.socket.emit("getboard", Tools.boardName);

Tools.HTML = {
	addTool: function (toolName) {
		var toolOpenedFromClick = false;
		const toolEl = document.getElementById('Tool-' + toolName);
		const toolParentEl = document.getElementById('Tool-' + toolName).parentElement;
		const subTools = toolParentEl.getElementsByClassName('sub-tool-item');

		const onClick = function (e) {
			Tools.change(toolName, toolEl.dataset.index);
			toolOpenedFromClick = true;
			toolParentEl.classList.add('opened');
			e.stopPropagation();
			document.addEventListener('touchstart', closeFromClick, { once: true});
		};

		const closeFromClick = function (e) {
			for (var el of e.composedPath()) {
				if (el && el.classList && el.classList.contains('sub-tool-item')) return;
				if (el && el.id === 'Tool-' + toolName) return;
			}
			toolOpenedFromClick = false;
			setTimeout(function () {toolParentEl.classList.remove('opened')}, 100);
		}

		const onMouseEnter = function (e) {
			toolParentEl.classList.add('opened');
		}

		const onMouseLeave = function (e) {
			if (!toolOpenedFromClick) toolParentEl.classList.remove('opened');
		}

		const subToolClick = function (e) {
			const subTool = e.composedPath().find(function (item) {
				return item.classList.contains('sub-tool-item');
			});
			Tools.change(toolName, subTool.dataset.index);
			toolParentEl.classList.remove('opened');
}

		for (var subTool of subTools) {
			subTool.addEventListener('click', subToolClick);
		}

		//Tools.change(toolName);

		toolEl.addEventListener('click', function () {
			Tools.change(toolName, toolEl.dataset.index);
		});
		toolEl.addEventListener("touchstart", onClick);
		toolParentEl.addEventListener('mouseenter', onMouseEnter);
		toolParentEl.addEventListener('mouseleave', onMouseLeave);
	},
	changeTool: function (oldToolName, newToolName) {
		var oldTool = document.getElementById("Tool-" + oldToolName);
		var newTool = document.getElementById("Tool-" + newToolName);
		if (oldTool) oldTool.classList.remove("selected-tool");
		if (newTool) newTool.classList.add("selected-tool");
	},
	toggle: function (toolName) {
		var elem = document.getElementById("Tool-" + toolName);
		elem.classList.add('selected-tool');
	},
	addStylesheet: function (href) {
		//Adds a css stylesheet to the html or svg document
		var link = document.createElement("link");
		link.href = href;
		link.rel = "stylesheet";
		link.type = "text/css";
		document.head.appendChild(link);
	}
};

Tools.list = {}; // An array of all known tools. {"toolName" : {toolObject}}

Tools.isBlocked = function toolIsBanned(tool) {
    if (tool.name.includes(",")) throw new Error("Tool Names must not contain a comma");
    return Tools.server_config.BLOCKED_TOOLS.includes(tool.name);
};

/**
 * Register a new tool, without touching the User Interface
 */
Tools.register = function registerTool(newTool) {
    if (Tools.isBlocked(newTool)) return;

    if (newTool.name in Tools.list) {
        console.log("Tools.add: The tool '" + newTool.name + "' is already" +
            "in the list. Updating it...");
    }

    //Format the new tool correctly
    Tools.applyHooks(Tools.toolHooks, newTool);

    //Add the tool to the list
    Tools.list[newTool.name] = newTool;

    // Register the change handlers
    if (newTool.onSizeChange) Tools.sizeChangeHandlers.push(newTool.onSizeChange);

    //There may be pending messages for the tool
    var pending = Tools.pendingMessages[newTool.name];
    if (pending) {
        console.log("Drawing pending messages for '%s'.", newTool.name);
        var msg;
        while (msg = pending.shift()) {
            //Transmit the message to the tool (precising that it comes from the network)
            newTool.draw(msg, false);
        }
    }
};

Tools.isMobile = function () {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

(function hotkeys() {
	if (!Tools.isMobile()) {
		document.addEventListener('keydown', function (e) {
			if (e.keyCode === 86) { // v
				Tools.change('Transform');
			} else if (e.keyCode === 72) {
				Tools.change('Hand');
			} else if (e.keyCode === 69) {
				Tools.change('Eraser');
			} else if (e.keyCode === 76) {
				Tools.change('Line');
			} else if (e.keyCode === 84) {
				Tools.change('Text');
			} else if (e.keyCode === 73) {
				Tools.change('Document');
			} else if (e.keyCode === 80) {
				Tools.change('Pencil');
			} else if (e.keyCode === 89 && e.ctrlKey) {
				Tools.redo();
			} else if (e.keyCode === 90 && e.ctrlKey) {
				Tools.undo();
			}
		}, false);
	}
})();

/**
 * Add a new tool to the user interface
 */
Tools.add = function (newTool) {
    if (Tools.isBlocked(newTool)) return;

    Tools.register(newTool);

    if (newTool.stylesheet) {
        Tools.HTML.addStylesheet(newTool.stylesheet);
    }

	//Add the tool to the GUI
	Tools.HTML.addTool(newTool.name);
};

Tools.change = function (toolName, subToolIndex) {
    var newTool = Tools.list[toolName];
    var oldTool = Tools.curTool;
    if (oldTool && oldTool !== newTool) {
        document.getElementById('Tool-' + oldTool.name).parentElement.classList.remove('opened');
    }
    const toolEl = document.getElementById('Tool-' + toolName);
    if (toolEl.classList) {
        toolEl.classList.remove('fix');
        toolEl.classList.remove('dash');
        toolEl.classList.remove('shape');
    }
    toolElParent = toolEl.parentElement;
    for (var item of toolElParent.getElementsByClassName('sub-tool-item')) {
        if (item.dataset.index == subToolIndex) {
            toolEl.innerHTML = item.innerHTML;
            if (item.classList.contains('fix')) toolEl.classList.add('fix');
            if (item.classList.contains('dash')) toolEl.classList.add('dash');
            if (item.classList.contains('shape')) toolEl.classList.add('shape');
            item.classList.add('selected-tool');
        } else {
            item.classList.remove('selected-tool');
        }
    }
    if (newTool.setIndex) {
        toolEl.dataset.index = +subToolIndex || 0;
        newTool.setIndex(subToolIndex);
    }

    if (!newTool) throw new Error("Trying to select a tool that has never been added!");
    if (newTool === oldTool) {
        if (newTool.secondary) {
            newTool.secondary.active = !newTool.secondary.active;
            var props = newTool.secondary.active ? newTool.secondary : newTool;
            Tools.HTML.toggle(newTool.name, props.name, props.icon);
            if (newTool.secondary.switch) newTool.secondary.switch();
        }
        return;
    }
    if (!newTool.oneTouch) {
        //Update the GUI
        var curToolName = (Tools.curTool) ? Tools.curTool.name : "";
        try {
            Tools.HTML.changeTool(curToolName, toolName);
        } catch (e) {
            console.error("Unable to update the GUI with the new tool. " + e);
        }
        Tools.svg.style.cursor = newTool.mouseCursor || "auto";
        Tools.board.title = Tools.i18n.t(newTool.helpText || "");

        //There is not necessarily already a curTool
        if (Tools.curTool !== null) {
            //It's useless to do anything if the new tool is already selected
            if (newTool === Tools.curTool) return;

            //Remove the old event listeners
            Tools.removeToolListeners(Tools.curTool);

            //Call the callbacks of the old tool
            Tools.curTool.onquit(newTool);
        }

        //Add the new event listeners
        Tools.addToolListeners(newTool);
        Tools.curTool = newTool;
    }

    //Call the start callback of the new tool
    newTool.onstart(oldTool);
};

Tools.addToolListeners = function addToolListeners(tool) {
    for (var event in tool.compiledListeners) {
        var listener = tool.compiledListeners[event];
        var target = listener.target || Tools.board;
        target.addEventListener(event, listener, {'passive': false});
    }
};

Tools.removeToolListeners = function removeToolListeners(tool) {
    for (var event in tool.compiledListeners) {
        var listener = tool.compiledListeners[event];
        var target = listener.target || Tools.board;
        target.removeEventListener(event, listener);
        // also attempt to remove with capture = true in IE
        if (Tools.isIE) target.removeEventListener(event, listener, true);
    }
};

Tools.send = function (data, toolName) {
    toolName = toolName || Tools.curTool.name;
    var d = data;
    d.tool = toolName;
    Tools.applyHooks(Tools.messageHooks, d);
    var message = {
        "board": Tools.boardName,
        "data": d
    };
    Tools.socket.emit('broadcast', message);
};

Tools.drawAndSend = function (data, tool) {
    if (tool == null) tool = Tools.curTool;
    tool.draw(data, true);
    Tools.send(data, tool.name);
};

//Object containing the messages that have been received before the corresponding tool
//is loaded. keys : the name of the tool, values : array of messages for this tool
Tools.pendingMessages = {};

// Send a message to the corresponding tool
function messageForTool(message) {
    var name = message.tool,
        tool = Tools.list[name];

    if (tool) {
        Tools.applyHooks(Tools.messageHooks, message);
        tool.draw(message, false);
    } else {
        ///We received a message destinated to a tool that we don't have
        //So we add it to the pending messages
        if (!Tools.pendingMessages[name]) Tools.pendingMessages[name] = [message];
        else Tools.pendingMessages[name].push(message);
    }

    if (message.tool !== 'Hand' && message.deltax != null && message.deltay != null) {
        //this message has special info for the mover
        messageForTool({
            tool: 'Hand',
            type: 'update',
            deltax: message.deltax || 0,
            deltay: message.deltay || 0,
            id: message.id
        });
    }
}

// Apply the function to all arguments by batches
function batchCall(fn, args) {
    var BATCH_SIZE = 1024;
    if (args.length === 0) {
        return Promise.resolve();
    } else {
        var batch = args.slice(0, BATCH_SIZE);
        var rest = args.slice(BATCH_SIZE);
        return Promise.all(batch.map(fn))
            .then(function () {
                return new Promise(requestAnimationFrame);
            }).then(batchCall.bind(null, fn, rest));
    }
}

// Call messageForTool recursively on the message and its children
function handleMessage(message) {
    //Check if the message is in the expected format
    if (!message.tool && !message._children) {
        console.error("Received a badly formatted message (no tool). ", message);
    }
    if (message.tool) messageForTool(message);
    if (message._children) return batchCall(handleMessage, message._children);
    else return Promise.resolve();
}

Tools.unreadMessagesCount = 0;
Tools.newUnreadMessage = function () {
    Tools.unreadMessagesCount++;
    updateDocumentTitle();
};

window.addEventListener("focus", function () {
    Tools.unreadMessagesCount = 0;
    updateDocumentTitle();
});

function updateDocumentTitle() {
    document.title =
        (Tools.unreadMessagesCount ? '(' + Tools.unreadMessagesCount + ') ' : '') +
        Tools.boardTitle +
        " | sBoard";
}

// Function for creating Modal Window
function createModal(htmlContent, id) {
    const modal = document.createElement('div');
    modal.classList.add('modal');
    modal.id = id;
    modal.innerHTML = `
		<div class="content">
			${htmlContent}
		</div>`;
    document.getElementsByTagName('body')[0].append(modal);
    document.getElementById(id).addEventListener('click', function (event) {
        if (event.target.getAttribute('class') === 'modal') {
            event.target.remove();
        }
    });
}

(function () {
    // Scroll and hash handling
    // events for button scaling
    // button events in this function
    var scrollTimeout, lastStateUpdate = Date.now();

    window.addEventListener("scroll", function onScroll() {
        var x = document.documentElement.scrollLeft / Tools.getScale(),
            y = document.documentElement.scrollTop / Tools.getScale();

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function updateHistory() {
            var hash = '#' + (x | 0) + ',' + (y | 0) + ',' + Tools.getScale().toFixed(2);
            if (Date.now() - lastStateUpdate > 5000 && hash !== window.location.hash) {
                window.history.pushState({}, "", hash);
                lastStateUpdate = Date.now();
            } else {
                window.history.replaceState({}, "", hash);
            }
        }, 100);
    });

    function setScrollFromHash() {
        var coords = window.location.hash.slice(1).split(',');
        var x = coords[0] | 0;
        var y = coords[1] | 0;
        var scale = parseFloat(coords[2]);
        resizeCanvas({x: x, y: y});
        Tools.setScale(scale);
        window.scrollTo(x * scale, y * scale);
        resizeBoard();
    }

    function scaleToFull() {
        Tools.setScale(1);
        resizeBoard();
    }

    function scaleToWidth() {
        Tools.setScale(document.body.clientWidth / Tools.server_config.MAX_BOARD_SIZE_X);
        resizeBoard();
    }

    function minusScale() {
        Tools.setScale(Tools.getScale() - 0.1);
        resizeBoard();
    }

    function plusScale() {
        Tools.setScale(Tools.getScale() + 0.1);
        resizeBoard();
    }

    function createHelpModal() {
        createModal(`<iframe src="${Tools.server_config.LANDING_URL}lite/help" frameborder="0"></iframe>`, "modalHelp");
    }

    function sendClearBoard() {
        const needClear = confirm('Вы уверены, что хотите очистить всю доску? Это нельзя отменить.');
        if (needClear) {
            Tools.drawAndSend({
                'type': 'clearBoard',
            }, Tools.list.Eraser);
        }
    }

    function createModalRename() {
        createModal(`
			<input id="newBoardName" type="text" value="">
			<input id="buttonRenameBoard" type="button" value="Переименовать">`, "modalRename");

        document.getElementById('newBoardName').value
            = document.getElementById('boardName').innerText;

        document.getElementById('buttonRenameBoard').addEventListener('click', function () {
            const newName = document.getElementById('newBoardName').value;
            fetch(
                Tools.server_config.API_URL + 'boards/' + Tools.boardName + '?name=' + newName,
                {
                    method: 'GET',
                    credentials: 'include',
                    mode: 'no-cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    //body: JSON.stringify({name: newName}),
                }
            ).then(function () {
                    document.getElementById('board-name-span').innerText = newName;
                    document.getElementsByClassName('modal')[0].click();
                    Tools.boardTitle = newName;
                    updateDocumentTitle();
                }
            );
        });
    }

    function createPdf() {
        if (Tools.params.permissions.pdf) {
            window.open(Tools.server_config.PDF_URL + 'generate/' + Tools.boardName);
        } else {
            alert('Красивая модалка, что тариф не позволяет делать экспорт в PDF.')
        }
    }

    function showBoard() {
        Tools.boardTitle = Tools.params.board.name;
        updateDocumentTitle();

        document.getElementById('board-name-span').innerText = Tools.boardTitle;

        if (Tools.params.permissions.edit) {
            document.getElementById('boardName').addEventListener('click', createModalRename, false);
        } else {
            document.getElementById('boardName')
                .removeAttribute('data-tooltip');
        }

        if (Tools.params.permissions.invite) {
            document.querySelector('.js-link-text').innerText = Tools.params.invite_link;
        } else {
            document.querySelector('.js-link-panel').remove();
            document.querySelector('.js-join-link').remove();
        }

        if (!Tools.params.permissions.image) {
            document.getElementById('Tool-Document').classList.add('disabled-icon');
        }

        let b = document.querySelectorAll('.js-elements');
        b.forEach((el) => {
            el.classList.toggle('sjx-hidden');
        });
    }

    function checkBoard() {
        const urlParams = new URLSearchParams(window.location.search);
        const PASS = urlParams.get('pass');

        if (Tools.server_config.DEV_MODE === 1 || PASS === 'dlTmsXCPwaMfTosmtDpsdf') {
            Tools.params = {
                "status": true,
                "board": {"name": "Dev Board"},
                "user": {"name": "John", "surname": "Smith", "full_name": "John Smith"},
                "permissions": {"edit": true, "invite": true, "image": true, "pdf": true},
                "invite_link": "https:\/\/back.sboard.su\/cabinet\/boards\/join\/56dfgdfbh67="
            };
            showBoard();
            return;
        }
        fetch(
            Tools.server_config.API_URL + 'boards/' + Tools.boardName + '/info',
            {
                method: 'GET',
                credentials: 'include',
            }
        )
            .then(response => {
                return response.json();
            })
            .then(data => {
                Tools.params = data;
                showBoard();
            })
            .catch(function (error) {
                window.location.href = Tools.server_config.CABINET_URL;
            })
    }

    document.getElementById('scalingWidth').addEventListener('click', scaleToWidth, false);
    document.getElementById('scalingFull').addEventListener('click', scaleToFull, false);
    document.getElementById('minusScale').addEventListener('click', minusScale, false);
    document.getElementById('plusScale').addEventListener('click', plusScale, false);
    document.getElementById("help").addEventListener('click', createHelpModal, false);
    document.getElementById('clearBoard').addEventListener('click', sendClearBoard, false);
    document.getElementById('exportToPDF').addEventListener('click', createPdf, false);
    document.getElementById('exportToPDFButton').addEventListener('click', createPdf, false);
    window.addEventListener("hashchange", setScrollFromHash, false);
    window.addEventListener("popstate", setScrollFromHash, false);
    window.addEventListener("DOMContentLoaded", setScrollFromHash, false);
    window.addEventListener("DOMContentLoaded", checkBoard, false);
})();

//List of hook functions that will be applied to messages before sending or drawing them
function resizeCanvas(m) {
    //Enlarge the canvas whenever something is drawn near its border
    var x = m.x | 0, y = m.y | 0
    if (x > Tools.svg.width.baseVal.value - 2048) {
        Tools.svg.width.baseVal.value = Math.min(x + 2048, Tools.server_config.MAX_BOARD_SIZE_X);
    }
    if (y > Tools.svg.height.baseVal.value - 5000) {
        Tools.svg.height.baseVal.value = Math.min(y + 5000, Tools.server_config.MAX_BOARD_SIZE_Y);
    }
    resizeBoard();
}

(function createTooltips() {
    if (!Tools.isMobile()) {
        const styles = document.createElement('style');
        styles.innerHTML = `*[data-tooltip] {
    position: relative;
}

*[data-tooltip]::after {
    white-space: nowrap;
    font-family: 'Montserrat', sans-serif;
    content: attr(data-tooltip);
    font-size: 12px;
    line-height: 15px;
    text-align: center;
    position: absolute;
    top: 10px;
    left: 50px;
    pointer-events: none;
    opacity: 0;
    -webkit-transition: opacity .15s ease-in-out;
    -moz-transition: opacity .15s ease-in-out;
    -ms-transition: opacity .15s ease-in-out;
    -o-transition: opacity .15s ease-in-out;
    transition: opacity .15s ease-in-out;
    display: block;
    background: #fff;
    padding: 5px 10px;
    box-shadow: 0px 5px 5px rgba(0, 0, 0, 0.05);
    border-radius: 5px;
    color: #000 !important;
}

.tooltip-bottom[data-tooltip]::after {
    bottom: -40px;
    left: 0;
    right: initial;
    top: initial;
}

.tooltip-toLeft[data-tooltip]::after {
    right: 0;
    left: initial;
}

.tooltip-top[data-tooltip]::after {
    top: -40px;
    bottom: initial;
}

*[data-tooltip]:hover::after {
    opacity: 1;
}`;
        document.getElementsByTagName('body')[0].append(styles);
    }
})();

function resizeBoard() {
    // Update board container size
    var board = document.getElementById("board");
    board.style.width = Tools.svg.width.baseVal.value * Tools.getScale() + "px";
    board.style.height = Tools.svg.height.baseVal.value * Tools.getScale() + "px";
}

function updateUnreadCount(m) {
    if (document.hidden && ["child", "update"].indexOf(m.type) === -1) {
        Tools.newUnreadMessage();
    }
}

Tools.messageHooks = [resizeCanvas, updateUnreadCount];
var scaleTimeout = null;
const scaleValueEl = document.getElementById('scaleValue');
const htmlBodyEl = document.getElementsByTagName('body')[0];
const test = document.body.clientWidth / Tools.server_config.MAX_BOARD_SIZE_X;
Tools.setScale = function setScale(scale) {
    if (isNaN(scale)) {
        scale = document.body.clientWidth / Tools.server_config.MAX_BOARD_SIZE_X;
    }
    scale = Math.max(0.1, Math.min(10, scale));
    Tools.svg.style.willChange = 'transform';
    Tools.svg.style.transform = 'scale(' + scale + ')';
    clearTimeout(scaleTimeout);
    scaleTimeout = setTimeout(function () {
        Tools.svg.style.willChange = 'auto';
    }, 1000);
    Tools.scale = scale;
    scaleValueEl.innerText = Math.round(scale * 100) + '%';
    if (scale < document.body.clientWidth / Tools.server_config.MAX_BOARD_SIZE_X) {
        htmlBodyEl.style = 'display: flex; justify-content: center;';
    } else {
        htmlBodyEl.style = '';
    }
    return scale;
}
Tools.getScale = function getScale() {
    return Tools.scale;
}

//List of hook functions that will be applied to tools before adding them
Tools.toolHooks = [
    function checkToolAttributes(tool) {
        if (typeof (tool.name) !== "string") throw "A tool must have a name";
        if (typeof (tool.listeners) !== "object") {
            tool.listeners = {};
        }
        if (typeof (tool.onstart) !== "function") {
            tool.onstart = function () {
            };
        }
        if (typeof (tool.onquit) !== "function") {
            tool.onquit = function () {
            };
        }
    },
    function compileListeners(tool) {
        //compile listeners into compiledListeners
        var listeners = tool.listeners;

        //A tool may provide precompiled listeners
        var compiled = tool.compiledListeners || {};
        tool.compiledListeners = compiled;

        function compile(listener) { //closure
            return (function listen(evt) {
                var x = (evt.pageX - (Tools.board.getBoundingClientRect().left < 0 ? 0 : Tools.board.getBoundingClientRect().left)) / Tools.getScale(),
                    y = evt.pageY / Tools.getScale();
                return listener(x, y, evt, false);
            });
        }

        function compileTouch(listener) { //closure
            return (function touchListen(evt) {
                //Currently, we don't handle multitouch
                if (evt.changedTouches.length === 1) {
                    //evt.preventDefault();
                    var touch = evt.changedTouches[0];
                    var x = (touch.pageX - (Tools.board.getBoundingClientRect().x < 0 ? 0 : Tools.board.getBoundingClientRect().x)) / Tools.getScale(),
                        y = touch.pageY / Tools.getScale();
                    return listener(x, y, evt, true);
                }
                return true;
            });
        }

        function wrapUnsetHover(f, toolName) {
            return (function unsetHover(evt) {
                document.activeElement && document.activeElement.blur && document.activeElement.blur();
                return f(evt);
            });
        }

        if (listeners.press) {
            compiled["mousedown"] = wrapUnsetHover(compile(listeners.press), tool.name);
            compiled["touchstart"] = wrapUnsetHover(compileTouch(listeners.press), tool.name);
        }
        if (listeners.move) {
            compiled["mousemove"] = compile(listeners.move);
            compiled["touchmove"] = compileTouch(listeners.move);
        }
        if (listeners.release) {
            var release = compile(listeners.release),
                releaseTouch = compileTouch(listeners.release);
            compiled["mouseup"] = release;
            if (!Tools.isIE) compiled["mouseleave"] = release;
            compiled["touchleave"] = releaseTouch;
            compiled["touchend"] = releaseTouch;
            compiled["touchcancel"] = releaseTouch;
        }
    }
];

Tools.applyHooks = function (hooks, object) {
    //Apply every hooks on the object
    hooks.forEach(function (hook) {
        hook(object);
    });
};


// Utility functions

Tools.generateUID = function (prefix, suffix) {
    var uid = Date.now().toString(36); //Create the uids in chronological order
    uid += (Math.round(Math.random() * 36)).toString(36); //Add a random character at the end
    if (prefix) uid = prefix + uid;
    if (suffix) uid = uid + suffix;
    return uid;
};

Tools.createSVGElement = function createSVGElement(name, attrs) {
    var elem = document.createElementNS(Tools.svg.namespaceURI, name);
    if (typeof (attrs) !== "object") return elem;
    Object.keys(attrs).forEach(function (key, i) {
        elem.setAttributeNS(null, key, attrs[key]);
    });
    return elem;
};

Tools.getMarkerBoundingRect = function (el, r, m) {
    var marker = el.getAttributeNS(null, "marker-end");
    if (marker && marker.split("_")[0] == "url(#arrw") {

        var x = el.x1.baseVal.value;
        var x2 = el.x2.baseVal.value;
        var y = el.y1.baseVal.value;
        var y2 = el.y2.baseVal.value;

        var strokeWidth = (el.getAttributeNS(null, "stroke-width") || 0);

        var rad = Math.atan2(y2 - y, x2 - x);

        var l = 6 * strokeWidth;
        var h = 2 * strokeWidth;

        var p1 = [[l * Math.cos(rad) + x2], [l * Math.sin(rad) + y2], [1]];
        var p2 = [[h * Math.sin(rad) + x2], [h * Math.cos(rad) + y2], [1]];
        var p3 = [[-h * Math.sin(rad) + x2], [-h * Math.cos(rad) + y2], [1]];
        p1 = Tools.multiplyMatrices(m, p1);
        p2 = Tools.multiplyMatrices(m, p2);
        p3 = Tools.multiplyMatrices(m, p3);
        r.x = Math.min(p1[0][0], p2[0][0], p3[0][0]);
        r.y = Math.min(p1[1][0], p2[1][0], p3[1][0]);
        r.width = Math.max(p1[0][0], p2[0][0], p3[0][0]) - r.x;
        r.height = Math.max(p1[1][0], p2[1][0], p3[1][0]) - r.y;
        return true;
    } else {
        return false;
    }
};

Tools.adjustBox = function (el, r, m) {
    var strokeWidth = (el.getAttributeNS(null, "stroke-width") || 0) - 0;
    var mat = {
        a: m[0][0],
        b: m[1][0],
        c: m[0][1],
        d: m[1][1],
        e: 0,
        f: 0,
    }
    var result = Tools.decomposeMatrix(mat);
    var rot = result.rotation * Math.PI / 180;
    var xstroke = Math.hypot(Math.cos(rot) * result.scale[0], Math.sin(rot) * result.scale[1]) * strokeWidth * .6;
    var ystroke = Math.hypot(Math.cos(rot) * result.scale[1], Math.sin(rot) * result.scale[0]) * strokeWidth * .6;
    r.x -= xstroke;
    r.y -= ystroke;
    r.width += 2 * xstroke;
    r.height += 2 * ystroke;
};

Tools.composeRects = function (r, r2) {
    var x1 = Math.min(r.x, r2.x);
    var y1 = Math.min(r.y, r2.y);
    var x2 = Math.max(r.x + r.width, r2.x + r2.width);
    var y2 = Math.max(r.y + r.height, r2.y + r2.height);
    r.x = x1;
    r.y = y1;
    r.width = x2 - r.x;
    r.height = y2 - r.y
};

Tools.multiplyMatrices = function (m1, m2) {
    var result = [];
    for (var i = 0; i < m1.length; i++) {
        result[i] = [];
        for (var j = 0; j < m2[0].length; j++) {
            var sum = 0;
            for (var k = 0; k < m1[0].length; k++) {
                sum += m1[i][k] * m2[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
};

Tools.decomposeMatrix = function (mat) {
    var a = mat.a;
    var b = mat.b;
    var c = mat.c;
    var d = mat.d;
    var e = mat.e;
    var f = mat.f;

    var delta = a * d - b * c;

    let result = {
        translation: [e, f],
        rotation: 0,
        scale: [0, 0],
        skew: [0, 0],
    };

    // Apply the QR-like decomposition.
    if (a != 0 || b != 0) {
        var r = Math.sqrt(a * a + b * b);
        result.rotation = b > 0 ? Math.acos(a / r) : -Math.acos(a / r);
        result.scale = [r, delta / r];
        result.skew = [Math.atan((a * c + b * d) / (r * r)), 0];
    } else if (c != 0 || d != 0) {
        var s = Math.sqrt(c * c + d * d);
        result.rotation =
            Math.PI / 2 - (d > 0 ? Math.acos(-c / s) : -Math.acos(c / s));
        result.scale = [delta / s, s];
        result.skew = [0, Math.atan((a * c + b * d) / (s * s))];
    } else {
        // a = b = c = d = 0
    }
    result.rotation = result.rotation * 180 / Math.PI;
    result.skew[0] = result.skew[0] * 180 / Math.PI
    result.skew[1] = result.skew[1] * 180 / Math.PI
    return result;
};

Tools.positionElement = function (elem, x, y) {
    elem.style.top = y + "px";
    elem.style.left = x + "px";
};

Tools.color_chooser = document.getElementById("color-picker");

Tools.setColor = function (color) {
    Tools.color_chooser.value = color;
    const presetsList = document.getElementsByClassName('color-preset-box');
    for (var node of presetsList) {
        node.classList.remove('selected-color');
    }
};

Tools.getColor = (function color() {
    var initial_color = '#000000';
    Tools.setColor(initial_color);
    return function () {
        return Tools.color_chooser.value;
    };
})();

document.getElementById('color-picker').addEventListener("change", watchColorPicker, false);

function watchColorPicker(e) {
    // e.target.value
    document.getElementById('color-picker-btn').style = `background-color: ${e.target.value};`;
    const presetsList = document.getElementsByClassName('color-preset-box');
    for (var node of presetsList) {
        node.classList.remove('selected-color');
    }
    presetsList[0].classList.add('selected-color');
}

const toolColorEl = document.getElementById('color-tool');

toolColorEl.addEventListener('mouseenter', function () {
    toolColorEl.classList.add('opened');
});
toolColorEl.addEventListener('mouseleave', function () {
    toolColorEl.classList.remove('opened');
});
toolColorEl.addEventListener('touchstart', function (e) {
    e.stopPropagation();
    document.getElementById('Tool-' + Tools.curTool.name).parentElement.classList.remove('opened');
    document.addEventListener('touchstart', function (e) {
        toolColorEl.classList.remove('opened');
    }, {once: true});
    toolColorEl.classList.add('opened');
});

for (var colorPreset of document.getElementsByClassName('color-preset')) {
    colorPreset.addEventListener('click', function (e) {
        if (e.target.tagName === 'DIV') {
            const presetsList = document.getElementsByClassName('color-preset-box');
            Tools.setColor(e.target.getAttribute('style').replace('background-color: ', '').replace(';', ''));
            for (var node of presetsList) {
                node.classList.remove('selected-color');
            }
            e.composedPath()[1].classList.add('selected-color');
            document.getElementById('color-tool').classList.remove('opened');
        }
    });
}

//repost
document.getElementsByClassName('repost-block')[0].addEventListener('click', () => {
    const copyPanel = document.getElementsByClassName('copy-link-panel')[0];
    if (copyPanel.classList.contains('hide')) {
        copyPanel.classList.remove('hide');
        const hideCopyPanel = function (e) {
            if (!copyPanel.contains(e.target)) {
                copyPanel.classList.add('hide');
                document.removeEventListener('mousedown', hideCopyPanel);
                document.removeEventListener('touchstart', hideCopyPanel);
            }
        }

        document.addEventListener('mousedown', hideCopyPanel);
        document.addEventListener('touchstart', hideCopyPanel);
        setTimeout(selectLink, 25);
    } else {
        copyPanel.classList.add('hide');
    }
});

document.getElementsByClassName('copy-link-icon')[0].addEventListener('click', selectLink);

function selectLink() {
    const r = new Range();
    const linkEl = document.getElementsByClassName('copy-link-link')[0];
    r.selectNodeContents(linkEl);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(r);
    navigator.clipboard.writeText(linkEl.innerText);
}

//repost

Tools.disableToolsEl = function (elementId) {
    document.getElementById(elementId).classList.add('disabled-icon');
}

Tools.enableToolsEl = function (elementId) {
    document.getElementById(elementId).classList.remove('disabled-icon');
}

Tools.sizeChangeHandlers = [];
Tools.setSize = (function size() {
    const chooser = document.getElementById("width-range");
    const sizeListElement = document.getElementById('width-list');
    const listAllItems = document.getElementsByClassName('width-item');
    sizeListElement.addEventListener('click', function (evt) {
        evt.stopPropagation();
        if (evt.target.classList.contains('width-item')) {
            for (var item of listAllItems) {
                item.classList.remove('selected-width');
            }
            evt.composedPath()[0].classList.add('selected-width');
            Tools.setSize(+evt.target.innerText);
        }
    });

    function update() {
        var size = Math.max(1, Math.min(60, chooser.value | 0));
        chooser.value = size;
        for (var item of listAllItems) {
            item.classList.remove('selected-width');
            if (item.innerText == size) {
                item.classList.add('selected-width');
            }
        }
        Tools.sizeChangeHandlers.forEach(function (handler) {
            handler(size);
        });
    }

    update();
    chooser.onchange = chooser.oninput = update;
    return function (value) {
        if (value !== null && value !== undefined) {
            chooser.value = value;
            update();
        }
        return parseInt(chooser.value);
    };
})();

const toolWidthEl = document.getElementById('width-tool');

toolWidthEl.addEventListener('mouseenter', function () {
    toolWidthEl.classList.add('opened');
});

toolWidthEl.addEventListener('mouseleave', function () {
    toolWidthEl.classList.remove('opened');
});
toolWidthEl.addEventListener('touchstart', function (e) {
    e.stopPropagation();
    document.getElementById('Tool-' + Tools.curTool.name).parentElement.classList.remove('opened');
    document.addEventListener('touchstart', function (e) {
        toolWidthEl.classList.remove('opened');
    }, {once: true});
    toolWidthEl.classList.add('opened');
});

Tools.getSize = (function () {
    return Tools.setSize()
});

Tools.getOpacity = (function opacity() {
    return function () {
        return 1;
    };
})();

Tools.deleteForTouches = function (evt, id) {
    if (evt.touches && evt.touches.length > 1) {
        if (id) {
            const msg = {
                "type": "delete",
                "id": id,
                "sendBack": false,
            };
            Tools.drawAndSend(msg, Tools.list.Eraser);
        }
        return true;
    }
    return false;
}

// Undo/Redo tools

Tools.undo = (function () {
    const el = document.getElementById("undo");

    function update() {
        if (Tools.history.length) {
            const action = Tools.history.pop();
            if (Tools.history.length === 0) {
                Tools.disableToolsEl('undo');
            }
            var instrument = null;
            switch (action.type) {
                case "line":
                    instrument = Tools.list.Pencil;
                    Tools.drawAndSend({
                        'type': 'line',
                        'id': action.id,
                        'color': action.color,
                        'size': action.size,
                        'opacity': action.opacity || 1,
                        'properties': action.properties,
                    }, instrument);
                    if (action.properties === undefined || action.properties.length === 0) {
                        for (var child of action._children) {
                            Tools.drawAndSend({
                                'type': 'child',
                                'parent': action.id,
                                'tool': 'Pencil',
                                'x': child.x,
                                'y': child.y,
                            }, instrument);
                        }
                    }
                    Tools.historyRedo.push({type: "delete", id: action.id});
                    break;
                case "delete":
                    instrument = Tools.list.Eraser;
                    // Tools.list.Transform.checkAndDisable(action.id);
                    action.sendBack = true;
                    action.sendToRedo = true;
                    break;
                case "update":
                    const transformEl = document.getElementById(action.id)
                    const propertiesForSend = ['x', 'width', 'height', 'y', 'transform', 'x1', 'y1', 'x2', 'y2', 'd', 'rx', 'cx', 'ry', 'cy'];
                    var msg = {type: "update", _children: [], id: transformEl.id, properties: []};
                    for (var i = 0; i < propertiesForSend.length; i++) {
                        if (transformEl.hasAttribute(propertiesForSend[i])) {
                            msg.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
                        }
                    }
                    Tools.historyRedo.push(msg);
                    instrument = Tools.list.Transform;
                    break;
                default:
                    instrument = Tools.list[action.tool];
                    Tools.historyRedo.push({type: "delete", id: action.id});
                    break;
            }
            if (action.type !== "line") {
                Tools.drawAndSend(action, instrument);
            }
            Tools.enableToolsEl('redo');
        }
    }

    el.onclick = update;
    return function () {
        update();
    }
})();

Tools.redo = (function () {
    const el = document.getElementById("redo");

    function update() {
        if (Tools.historyRedo.length) {
            const action = Tools.historyRedo.pop();
            if (Tools.historyRedo.length === 0) {
                Tools.disableToolsEl('redo');
            }
            var instrument = null;
            action.sendBack = true;
            switch (action.type) {
                case "line":
                    instrument = Tools.list.Pencil;
                    Tools.drawAndSend({
                        'type': 'line',
                        'id': action.id,
                        'color': action.color,
                        'size': action.size,
                        'opacity': action.opacity || 1,
                        'properties': action.properties,
                    }, instrument);
                    if (action.properties === undefined || action.properties.length === 0) {
                        for (var child of action._children) {
                            Tools.drawAndSend({
                                'type': 'child',
                                'parent': action.id,
                                'tool': 'Pencil',
                                'x': child.x,
                                'y': child.y,
                            }, instrument);
                        }
                    }
                    Tools.history.push({type: "delete", id: action.id});
                    break;
                case "delete":
                    instrument = Tools.list.Eraser;
                    // Tools.list.Transform.checkAndDisable(action.id);
                    action.sendBack = true;
                    break;
                case "update":
                    const transformEl = document.getElementById(action.id)
                    const propertiesForSend = ['x', 'width', 'height', 'y', 'transform', 'x1', 'y1', 'x2', 'y2', 'd', 'rx', 'cx', 'ry', 'cy'];
                    var msg = {type: "update", _children: [], id: transformEl.id, properties: []};
                    for (var i = 0; i < propertiesForSend.length; i++) {
                        if (transformEl.hasAttribute(propertiesForSend[i])) {
                            msg.properties.push([propertiesForSend[i], transformEl.getAttribute(propertiesForSend[i])]);
                        }
                    }
                    Tools.history.push(msg);
                    instrument = Tools.list.Transform;
                    break;
                default:
                    instrument = Tools.list[action.tool];
                    Tools.history.push({type: "delete", id: action.id});
                    break;
            }
            if (action.type !== "line") {
                Tools.drawAndSend(action, instrument);
            }
            Tools.enableToolsEl('undo');
        }
    }

    el.onclick = update;
    return function () {
        update();
    }
})();

Tools.history = [];
Tools.historyRedo = [];

Tools.addActionToHistory = function (data, dontClear) {
    Tools.enableToolsEl('undo');
    if (Tools.history.length === 20) {
        Tools.history.shift();
    }
    const clear = dontClear || false;
    if (!clear) {
        Tools.disableToolsEl('redo');
        Tools.historyRedo.splice(0, Tools.historyRedo.length);
    }
    Tools.history.push(data);
}

//Scale the canvas on load
Tools.svg.width.baseVal.value = document.body.clientWidth;
Tools.svg.height.baseVal.value = document.body.clientHeight;

/**
 What does a "tool" object look like?
 newtool = {
 	"name" : "SuperTool",
 	"listeners" : {
 		"press" : function(x,y,evt){...},
 		"move" : function(x,y,evt){...},
  		"release" : function(x,y,evt){...},
 	},
 	"draw" : function(data, isLocal){
 		//Print the data on Tools.svg
 	},
 	"onstart" : function(oldTool){...},
 	"onquit" : function(newTool){...},
 	"stylesheet" : "style.css",
}
 */
