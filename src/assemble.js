'use strict';

const ops = require('./ops');
const BN = require('bn.js');
const {
  addHexPrefix,
  stripHexPrefix,
  coerceToBN,
  leftZeroPadToByteLength
} = require('./util');

const isLabelQuick = (s, labels) => labels[s];
const isLabel = (s) => isNaN(s) && !ops[s] && !Array.isArray(s);
const isBytesLabel = (s) => s.substr(0, 6) === 'bytes:';
const isBytesLabelQuick = (s, bytesLabels) => bytesLabels[s];
const isBytesLabelSizeQuick = (s, bytesLabelSizes) => bytesLabelSizes[s];
const isBytesLabelPtrQuick = (s, bytesLabelPtrs) => bytesLabelPtrs[s];

const pushBytes = (r, bytes) => {
  if (!r.currentLabel) r.initial[r.initial.length - 1] += bytes;
  else {
    const partial = r.labels[r.currentLabel];
    partial[partial.length - 1] += bytes;
  }
  return r;
};

const pushLabel = (r, label) => {
  if (!r.currentLabel) {
    const { initial } = r;
    initial.push(label);
    initial.push('');
  } else {
    const partial = r.labels[r.currentLabel];
    partial.push(label);
    partial.push('');
  }
  return r;
};

const encodePush = (v, length) => {
  const baseOffset = Number(addHexPrefix(ops.push));
  const opcodeValue = baseOffset + length - 1;
  return opcodeValue.toString(16) + leftZeroPadToByteLength(v.toString(16), length);
};

const firstPass = (ast, progress = { labels: {}, bytesLabels: {}, segmentOrder: [], initial: [''], bytesLabelSizes: {}, bytesLabelPtrs: {} }) => ast.reduce((r, v, i, ary) => {
  r = r || progress;
  if (r.parsingBytesLabel) {
    const [ bytes ] = v.map((raw) => stripHexPrefix(raw));;
    const length = Math.ceil(bytes.length / 2);
    const sizeOfLength = new BN(length).byteLength();
    const padded = leftZeroPadToByteLength(bytes, length);
    r.bytesLabels[r.parsingBytesLabel] = padded;
    r.bytesLabelPtrs[r.parsingBytesLabel + ':ptr'] = r.parsingBytesLabel;
    r.bytesLabelSizes[r.parsingBytesLabel + ':size'] = {
      length,
      sizeOfLength
    };
    delete r.parsingBytesLabel;
    return r;
  }
  if (r.parsingLabel) {
    delete r.parsingLabel;
    return firstPass(v, r);
  }
  if (Array.isArray(v)) return firstPass(v, r);
  if (isLabel(v)) {
    if (!i && Array.isArray(ary[i + 1])) {
      if (isBytesLabel(v)) {
	r.segmentOrder.push(v);
        r.parsingBytesLabel = v;
        return r;
      }
      r.labels[v] = [ ops.jumpdest ];
      r.segmentOrder.push(v);
      r.currentLabel = v;
      r.parsingLabel = v;
      return r;
    }
    return pushLabel(r, v);
  }
  if (!isNaN(v)) {
    const bn = coerceToBN(v);
    const length = bn.byteLength() || 1;
    if (length > 32) throw Error('constant integer overflow: ' + v);
    return pushBytes(r, encodePush(bn, length));
  }
  const op = ops[v];
  if (!op) throw Error('opcode not found: ' + v);
  return pushBytes(r, op);
}, null);

const initialSegmentSymbol = Symbol('@@initial');

const mergeInitial = (meta) => {
  const {
    labels,
    initial,
    segmentOrder
  } = meta;
  labels[initialSegmentSymbol] = initial;
  segmentOrder.unshift(initialSegmentSymbol);
};

const fallback = [];

const findOptimalJumpdestSize = ({
  labels,
  bytesLabels,
  bytesLabelSizes,
  bytesLabelPtrs,
  segmentOrder
}) => {
  let totalMin = 0, dynamicSlots = 0;
  segmentOrder.forEach((label) => {
    (labels[label] || fallback).forEach((partial) => {
      if (isLabelQuick(partial, labels) || isBytesLabelPtrQuick(partial, bytesLabelPtrs)) dynamicSlots++;
      else if (isBytesLabelSizeQuick(partial, label)) totalMin += bytesLabelSizes[partial].sizeOfLength + 1;
      else totalMin += partial.length / 2;
    });
  });
  return totalMin + dynamicSlots*2 <= 256 ? 2 : 3;
};

const annotateJumpdestOffsets = ({
  segmentOrder,
  bytesLabels,
  bytesLabelPtrs,
  bytesLabelSizes,
  labels
}, width) => {
  let passed = 0;
  segmentOrder.forEach((v) => {
    if (labels[v]) {
      const label = labels[v];
      label.jumpdest = passed;
      label.forEach((partial) => (passed += (isLabelQuick(partial, labels) || isBytesLabelPtrQuick(partial, bytesLabelPtrs) ? width : isBytesLabelSizeQuick(partial, bytesLabelSizes) ? bytesLabelSizes[partial].sizeOfLength + 1 : partial.length / 2)));
    } else if (bytesLabels[v]) {
      bytesLabelPtrs[v + ':ptr'] = passed;
      passed += bytesLabelSizes[v + ':size'].sizeOfLength + 1;
    }
  });
};

const encodeJumpdestPushes = ({
  bytesLabelSizes,
  bytesLabelPtrs,
  segmentOrder,
  labels
}, width) => {
  segmentOrder.forEach((v) => {
    if (!labels[v]) return;
    labels[v].forEach((partial, i, ary) => {
      if (isLabelQuick(partial, labels)) ary[i] = encodePush(labels[partial].jumpdest, width - 1);
      else if (isBytesLabelSizeQuick(partial, bytesLabelSizes)) ary[i] = encodePush(bytesLabelSizes[partial].length, bytesLabelSizes[partial].sizeOfLength);
      else if (bytesLabelPtrs[partial] !== undefined) ary[i] = encodePush(bytesLabelPtrs[partial], width - 1);
    });
  });
};

const assemble = (ast) => {
  const meta = firstPass(ast);
  mergeInitial(meta);
  const width = findOptimalJumpdestSize(meta);
  annotateJumpdestOffsets(meta, width);
  encodeJumpdestPushes(meta, width);
  const {
    labels,
    bytesLabels,
    segmentOrder
  } = meta;
  return addHexPrefix(segmentOrder.map((v) => (labels[v] || [ bytesLabels[v] ]).join('')).join(''));
};

module.exports = assemble;
