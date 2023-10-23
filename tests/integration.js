const fs = require("../server/fs_promises.js");
const os = require("os");
const path = require("path");

const PORT = 8487
const SERVER = 'http://localhost:' + PORT;

let wbo, data_path, tokenQuery;

async function beforeEach(browser, done) {
    data_path = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wbo-test-data-'));
    process.env["PORT"] = PORT;
    process.env["WBO_HISTORY_DIR"] = data_path;
    if(browser.globals.token) {
        process.env["AUTH_SECRET_KEY"] = "test";
        tokenQuery = "token=" + browser.globals.token;
    }
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
        .url(SERVER + '/preview/anonymous?' + tokenQuery)
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
        .waitForElementVisible("ellipse[cx='0'][cy='200'][rx='200'][ry='200'][stroke='#112233']", 15000)
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
    var page = browser.url(SERVER + '/boards/anonymous?lang=fr&' + tokenQuery)
        .waitForElementVisible('.tool[title ~= Crayon]') // pencil
    page = testPencil(page);
    page = testCircle(page);
    page = testCursor(page);

    // test hideMenu
    browser.url(SERVER + '/boards/anonymous?lang=fr&hideMenu=true&' + tokenQuery).waitForElementNotVisible('#menu');
    browser.url(SERVER + '/boards/anonymous?lang=fr&hideMenu=false&' + tokenQuery).waitForElementVisible('#menu');
    if(browser.globals.token) {
        //has moderator jwt and no board name
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3IiXX0.PqYHmV0loeKwyLLYZ1a1eIXBCCaa3t5lYUTu_P_-i14').waitForElementVisible('#toolID-Clear');
        //has moderator JWT and other board name
        browser.url(SERVER + '/boards/testboard123?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3IiXX0.PqYHmV0loeKwyLLYZ1a1eIXBCCaa3t5lYUTu_P_-i14').waitForElementVisible('#toolID-Clear');
        //has moderator JWT and board name match board name in url
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3I6dGVzdGJvYXJkIl19.UVf6awGEChVxcWBbt6dYoNH0Scq7cVD_xfQn-U8A1lw').waitForElementVisible('#toolID-Clear');
        //has moderator JWT and board name NOT match board name in url
        browser.url(SERVER + '/boards/testboard123?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3I6dGVzdGJvYXJkIl19.UVf6awGEChVxcWBbt6dYoNH0Scq7cVD_xfQn-U8A1lw').waitForElementNotPresent('#menu');
        //has editor JWT and no boardname provided
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJlZGl0b3IiXX0.IJehwM8tPVQFzJ2fZMBHveii1DRChVtzo7PEnSmmFt8').waitForElementNotPresent('#toolID-Clear');
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJlZGl0b3IiXX0.IJehwM8tPVQFzJ2fZMBHveii1DRChVtzo7PEnSmmFt8').waitForElementVisible('#menu')
        //has editor JWT and  boardname provided and match to the board in the url
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJlZGl0bzp0ZXN0Ym9hcmQiXX0.-P6gjYlPP5I2zgSoVTlADdesVPfSXV-JXZQK5uh3Xwo').waitForElementVisible('#menu');
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJlZGl0bzp0ZXN0Ym9hcmQiXX0.-P6gjYlPP5I2zgSoVTlADdesVPfSXV-JXZQK5uh3Xwo').waitForElementNotPresent('#toolID-Clear');
        //has editor JWT and  boardname provided and and not match to the board in the url
        browser.url(SERVER + '/boards/testboard123?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJlZGl0bzp0ZXN0Ym9hcmQiXX0.-P6gjYlPP5I2zgSoVTlADdesVPfSXV-JXZQK5uh3Xwo').waitForElementNotPresent('#menu');
        //is moderator and boardname contains ":"
        browser.url(SERVER + '/boards/test:board?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3I6dGVzdDpib2FyZCJdfQ.LKYcDccheD2oXAMAemxSekDeowGsMl29CFkgJgwbkGE').waitForElementNotPresent('#menu');
        browser.url(SERVER + '/boards/testboard?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJtb2RlcmF0b3I6dGVzdDpib2FyZCJdfQ.LKYcDccheD2oXAMAemxSekDeowGsMl29CFkgJgwbkGE').waitForElementNotPresent('#menu');
    }
    page.end();
}

module.exports = { beforeEach, testBoard, afterEach };
