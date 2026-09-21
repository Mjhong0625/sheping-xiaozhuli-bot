const map = new Map();

const sessionStore = {
  async get(key) {
    return map.get(key);
  },
  async set(key, value) {
    map.set(key, value);
  },
  async delete(key) {
    map.delete(key);
  },
};

module.exports = { map, sessionStore };
