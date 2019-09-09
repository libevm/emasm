'use strict';

const leftZeroPadToByteLength = (s, n) => Array(n*2 - s.length + 1).join('0') + s;

module.exports = leftZeroPadToByteLength;
