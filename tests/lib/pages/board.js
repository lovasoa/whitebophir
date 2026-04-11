module.exports = {
  commands: [
    {
      drawPencilPath(color, points) {
        return this.executeAsync(
          function (color, points, done) {
            function sleep(t) {
              return new Promise((accept) => setTimeout(accept, t));
            }
            (async () => {
              Tools.setColor(color);
              const first = points[0];
              Tools.curTool.listeners.press(
                first.x,
                first.y,
                new Event("mousedown"),
              );
              for (let i = 1; i < points.length; i++) {
                await sleep(80);
                if (i === points.length - 1) {
                  Tools.curTool.listeners.release(
                    points[i].x,
                    points[i].y,
                    new Event("mouseup"),
                  );
                } else {
                  Tools.curTool.listeners.move(
                    points[i].x,
                    points[i].y,
                    new Event("mousemove"),
                  );
                }
              }
              done();
            })();
          },
          [color, points],
        );
      },

      drawCircle(color, center, radius) {
        return this.executeAsync(
          function (color, center, radius, done) {
            Tools.setColor(color);
            Tools.curTool.listeners.press(
              center.x + radius,
              center.y + radius,
              new Event("mousedown"),
            );
            setTimeout(() => {
              const evt = new Event("mousemove");
              evt.shiftKey = true;
              Tools.curTool.listeners.move(
                center.x - radius,
                center.y - radius,
                evt,
              );
              Tools.curTool.listeners.release(
                center.x - radius,
                center.y - radius,
                new Event("mouseup"),
              );
              done();
            }, 100);
          },
          [color, center, radius],
        );
      },

      moveCursor(color, x, y) {
        return this.execute(
          function (color, x, y) {
            Tools.setColor(color);
            var e = new Event("mousemove");
            e.pageX = x;
            e.pageY = y;
            Tools.board.dispatchEvent(e);
          },
          [color, x, y],
        );
      },
    },
  ],
  elements: {
    pencilTool: ".tool[title ~= Crayon]",
    ellipseTool: "#toolID-Ellipse",
    handTool: "#toolID-Hand",
    eraserTool: "#toolID-Eraser",
    clearTool: "#toolID-Clear",
    settings: "#settings",
    menu: "#menu",
    myCursor: "#cursor-me",
  },
};
