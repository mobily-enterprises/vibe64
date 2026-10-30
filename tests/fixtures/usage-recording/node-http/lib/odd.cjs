"use strict";

// Valid for Node (a CommonJS module body runs inside a function) but rejected
// by the recorder's parser, so the recorder reports it and loads it unchanged.
const calledAsModule = new.target === undefined;

module.exports = {
  odd() {
    return `odd ${calledAsModule}`;
  }
};
