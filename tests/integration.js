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
            Tools.setColor('#123456');
            Tools.curTool.listeners.press(100, 200, new Event("mousedown"));
            setTimeout(() => {
                Tools.curTool.listeners.move(300, 400, new Event("mousemove"));
                setTimeout(() => {done();}, 150);
            }, 100);
        })
        .assert.visible("path[d='M 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .refresh()
        .assert.visible("path[d='M 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .end();
}

module.exports = { beforeEach, testBoard, afterEach };