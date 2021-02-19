const fs = require("../server/fs_promises.js");
const os = require("os");
const path = require("path");

const PORT = 8487
const SERVER = 'http://localhost:' + PORT;

let wbo, data_path;

async function beforeEach(browser, done) {
    data_path = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wbo-test-data-'));
    process.env["PORT"] = PORT;
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
        .executeAsync(async function (done) {
            function sleep(t) {
                return new Promise(function (accept) { setTimeout(accept, t); });
            }
            // A straight path with just two points
            Tools.setColor('#123456');
            Tools.curTool.listeners.press(100, 200, new Event("mousedown"));
            await sleep(80);
            Tools.curTool.listeners.release(300, 400, new Event("mouseup"));

            // A line with three points that form an "U" shape
            await sleep(80);
            Tools.setColor('#abcdef');
            Tools.curTool.listeners.press(0, 0, new Event("mousedown"));
            await sleep(80);
            Tools.curTool.listeners.move(90, 120, new Event("mousemove"));
            await sleep(80);
            Tools.curTool.listeners.release(180, 0, new Event("mouseup"));
            done();
        })
        .assert.visible("path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .assert.visible("path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']")
        .refresh()
        .waitForElementVisible("path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .assert.visible("path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']")
        .url(SERVER + '/preview/anonymous')
        .waitForElementVisible("path[d='M 100 200 L 100 200 C 100 200 300 400 300 400'][stroke='#123456']")
        .assert.visible("path[d='M 0 0 L 0 0 C 0 0 40 120 90 120 C 140 120 180 0 180 0'][stroke='#abcdef']")
        .back()
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
            var e = new Event("mousemove");
            e.pageX = 150;
            e.pageY = 200;
            Tools.board.dispatchEvent(e)
        })
        .assert.cssProperty("#cursor-me", "transform", "matrix(1, 0, 0, 1, 150, 200)")
        .assert.attributeEquals("#cursor-me", "fill", "#456123")
}

function testBoard(browser) {
    var page = browser.url(SERVER + '/boards/anonymous?lang=fr')
        .waitForElementVisible('.tool[title ~= Crayon]') // pencil
    page = testPencil(page);
    page = testCircle(page);
    page = testCursor(page);

    // test hideMenu
    browser.url(SERVER + '/boards/anonymous?lang=fr&hideMenu=true').waitForElementNotVisible('#menu');
    browser.url(SERVER + '/boards/anonymous?lang=fr&hideMenu=false').waitForElementVisible('#menu');

    page.end();
}

module.exports = { beforeEach, testBoard, afterEach };