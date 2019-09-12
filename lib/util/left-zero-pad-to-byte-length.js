'use strict';

const leftZeroPadToByteLength = (s, n) => {
	console.log(s);
	if (typeof s === 'number') s = s.toString(16);
	console.log([s, n]);
	return Array(n*2 - s.length + 1).join('0') + s;
};

module.exports = leftZeroPadToByteLength;
