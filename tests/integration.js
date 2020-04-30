const fs = require("../server/fs_promises.js");
const os = require("os");
const path = require("path");

let wbo, data_path;

async function beforeEach(browser, done) {
    data_path = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wbo-test-data-'));
    process.env["PORT"] = 8487;
    process.env["WBO_HISTORY_DIR"] = data_path;
    console.log("Launching WBO in " + data_path);
    wbo = require("../server/server.js");
    done();
}

async function afterEach(browser, done) {
    wbo.close();
    done();
}

function testBoard(browser) {
    browser
        .url('http://localhost:8487/boards/anonymous?lang=fr')
        .waitForElementVisible('.tool[title ~= Crayon]') // pencil
        .assert.titleContains('WBO')
        .click('.tool[title ~= Crayon]')
        .assert.cssClassPresent('.tool[title ~= Crayon]', ['curTool'])
        .executeAsync(function (done) {
            // utility function for returning a promise that resolves after a delay
            // https://stackoverflow.com/a/6921279
            function delay(t) {
                return new Promise(function (resolve) {
                    setTimeout(resolve, t);
                });
            }

            Promise.delay = function (fn, t) {
                // fn is an optional argument
                if (!t) {
                    t = fn;
                    fn = function () {};
                }
                return delay(t).then(fn);
            };

            Promise.prototype.delay = function (fn, t) {
                // return chained promise
                return this.then(function () {
                    return Promise.delay(fn, t);
                });

            };

            Tools.setColor('#123456');
            Tools.curTool.listeners.press(100, 200, new Event("mousedown"));
            Promise.delay(() => {
                Tools.curTool.listeners.release(300, 400, new Event("mouseup"));
            }, 100)
            .delay(() => {
                Tools.setColor('#abcdef');
                Tools.curTool.listeners.press(200, 100, new Event("mousedown"));
            }, 100)
            .delay(() => {
                Tools.curTool.listeners.move(300, 200, new Event("mousemove"));
            }, 100)
            .delay(() => {
                Tools.curTool.listeners.release(400, 100, new Event("mouseup"));
                done();
            }, 100);
        })
        .assert.visible("path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .assert.visible("path[d='M 200 100 L 200 100 C 200 100 252.85954792089683 200 300 200 C 347.14045207910317 200 400 100 400 100'][stroke='#abcdef']")
        .refresh()
        .assert.visible("path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .assert.visible("path[d='M 200 100 L 200 100 C 200 100 252.85954792089683 200 300 200 C 347.14045207910317 200 400 100 400 100'][stroke='#abcdef']")
        .end();
}

module.exports = { beforeEach, testBoard, afterEach };