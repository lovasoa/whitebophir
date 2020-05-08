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

function testPencil(browser) {
    return browser
        .assert.titleContains('WBO')
        .click('.tool[title ~= Crayon]') // pencil
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
        .waitForElementVisible("path[d='M 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
}

function testCircle(browser) {
    return browser
        .click('#toolID-Ellipse')
        .executeAsync(function (done) {
            Tools.setColor('#112233');
            Tools.curTool.listeners.press(200, 400, new Event("mousedown"));
            setTimeout(() => {
                const evt = new Event("mousemove");
                evt.shiftKey = true;
                Tools.curTool.listeners.move(0, 0, evt);
                done();
            }, 100);
        })
        .assert.visible("ellipse[cx='0'][cy='200'][rx='200'][ry='200'][stroke='#112233']")
        .refresh()
        .waitForElementVisible("ellipse[cx='0'][cy='200'][rx='200'][ry='200'][stroke='#112233']")
        .click('#toolID-Ellipse') // Click the ellipse tool
        .click('#toolID-Ellipse') // Click again to toggle
        .assert.containsText('#toolID-Ellipse .tool-name', 'Cercle') // Circle in french
}

function testCursor(browser) {
    return browser
        .execute(function (done) {
            Tools.setColor('#456123'); // Move the cursor over the board
            var e = new Event("mousemove")
            e.pageX = 150
            e.pageY = 200
            Tools.board.dispatchEvent(e)
        })
        .assert.cssProperty("#cursor-me", "transform", "matrix(1, 0, 0, 1, 150, 200)")
        .assert.attributeEquals("#cursor-me", "fill", "#456123")
}

function testBoard(browser) {
    var page = browser.url('http://localhost:8487/boards/anonymous?lang=fr')
        .waitForElementVisible('.tool[title ~= Crayon]') // pencil
    page = testPencil(page);
    page = testCircle(page);
    page = testCursor(page);
    page.end();
}

module.exports = { beforeEach, testBoard, afterEach };