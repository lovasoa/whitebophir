const MongoClient = require('mongodb').MongoClient;
const url = require('./db_config').url;

function getClient() {
    return new MongoClient(url, {useNewUrlParser: true});
}

/** Вставляет или обновляет доску **/
async function insertOrUpdateBoard(boardName, board) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.updateOne({ name: boardName }, {$set: { board: board }}, {upsert: true});
    client.close();
}

/** Удаляет доску по имени **/
async function deleteBoard(boardName) {
    const client = getClient();
    await client.connect();
    const db = client.db("boardsdb");
    const collection = db.collection('boards');
    await collection.deleteOne({ name: boardName }, true);
    client.close();
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
    insertOrUpdateBoard,
    deleteBoard,
    getBoard
};