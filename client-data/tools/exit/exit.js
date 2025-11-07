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

(function () {
  //Code isolation

  const exitTool = {
    name: "Exit",
    shortcut: "Q",
    listeners: {
    },
    draw: function (ctx) {},
    onstart: function () {
      if (confirm("Are you sure you want to exit?")) {
        window.close();
      }
    },
    onquit: function () {},
    mouseCursor: "url('tools/pencil/cursor.svg'), crosshair",
    icon: "tools/exit/exit.svg",
    stylesheet: "tools/pencil/pencil.css",
  };
  Tools.server_config.SHOW_EXIT_BUTTON &&  Tools.add(exitTool);
})(); //End of code isolation
