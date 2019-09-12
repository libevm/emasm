'use strict';

const createJumpTable = (jumpTableLabel, labels) => [ 'bytes:' + jumpTableLabel, labels.map((label) => [ 2, label ]) ];

module.exports = createJumpTable;
