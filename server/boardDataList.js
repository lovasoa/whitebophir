class BoardDataList {
  boards = {};

  add(name, data) {
    this.boards[name] = data;
  }

  remove(name) {
    delete this.boards[name];
  }

  has(name) {
    return this.boards.hasOwnProperty(name);
  }

  hasLoaded(name) {
    return this.has(name) && this.boards[name].state !== 'pending'
  }

  async get(name) {
    return await this.boards[name];
  }

  getCount() {
    return Object.keys(this.boards).length;
  }
}

module.exports = BoardDataList;
