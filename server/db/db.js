var log = require("../log.js").log;

const MongoClient = require('mongodb').MongoClient;

function getClient() {
    return new MongoClient(process.env.DB_CONN, {useUnifiedTopology: true});
}

/** Обновляет доску **/
async function updateBoard(boardName, board) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.updateOne({ name: boardName }, {$set: { board: board }}, {upsert: false});
    //log('db.board updated', { 'boardName': boardName });
    client.close();
}

async function createBoard(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.updateOne({ name: boardName }, {$set: { board: {} }}, {upsert: true});
    log('db.board created', { 'boardName': boardName });
    client.close();
}

/** Удаляет доску по имени **/
async function deleteBoard(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.deleteOne({ name: boardName }, true);
    log('db.board deleted', { 'boardName': boardName });
    client.close();
}

async function clearBoard(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.deleteOne({ name: boardName }, true);
    await collection.updateOne({ name: boardName }, {$set: { board: {} }}, {upsert: true});
    log('db.board cleared', { 'boardName': boardName });
    client.close();
}

async function boardExists(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    const result = await collection.findOne({ name: boardName });
    log('db.board check', { 'boardName': boardName, 'exists': result !== null });
    client.close();
    return result !== null;
}

/** Получает доску по имени, если такой доски не существует возвращает null **/
async function getBoard(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    const result = await collection.findOne({ name: boardName });
    client.close();
    if (result) {
        delete result._id;
    }
    return result;
}

module.exports = {
    getClient,
    updateBoard,
    createBoard,
    deleteBoard,
    clearBoard,
    boardExists,
    getBoard
};