"use strict";

module.exports = {
  legacyTotal(values) {
    return values.reduce((sum, value) => sum + value, 0);
  }
};
