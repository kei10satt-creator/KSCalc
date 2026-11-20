'use strict';

const operatorPrecedence = {'+': 1, '−': 1, '×': 2, '÷': 2, nPr: 3, nCr: 3, '^': 5, '!': 6, '%': 6};

function mathError() {
  throw Error('Math ERROR');
}

function countingNumber(n, r, combination) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || r < 0 || r > n) mathError();
  if (combination) r = Math.min(r, n - r);
  let result = 1n;
  for (let factor = 1; factor <= r; factor++) {
    result *= BigInt(combination ? n - r + factor : n - factor + 1);
    if (combination) {
      result = result / BigInt(factor);
    }
    if (!Number.isFinite(Number(result))) mathError();
  }
  return Number(result);
}

function complexParts(value) {
  return typeof value === 'number' ? {re: value, im: 0} : value;
}

function complexOperation(operator, left, right) {
  const {re: a, im: b} = complexParts(left);
  const {re: c, im: d} = complexParts(right);
  switch (operator) {
    case '+': return {re: a + c, im: b + d};
    case '−': return {re: a - c, im: b - d};
    case '×': return {re: a * c - b * d, im: a * d + b * c};
    case '÷': {
      const scale = Math.max(Math.abs(c), Math.abs(d));
      if (!scale) mathError();
      const x = c / scale;
      const y = d / scale;
      const norm = x * x + y * y;
      return {re: (a / scale * x + b / scale * y) / norm,
        im: (b / scale * x - a / scale * y) / norm};
    }
    default: mathError();
  }
}

function applyOperator(operator, left, right) {
  if (left?.coordinates || right?.coordinates) throw new SyntaxError();
  if (typeof left === 'object' || typeof right === 'object') {
    return complexOperation(operator, left, right);
  }
  switch (operator) {
    case '+': return left + right;
    case '−': return left - right;
    case '×': return left * right;
    case '÷':
      if (right === 0 || right === 0n) mathError();
      return left / right;
    case '^': return left ** right;
    case 'nPr': return countingNumber(left, right, false);
    case 'nCr': return countingNumber(left, right, true);
    default: throw new SyntaxError();
  }
}

function evaluateArithmetic(expression, {mode, radix, answer, constants, functions, factorial}) {
  const tokenPattern = mode === 'BASE'
    ? /Ans|[0-9A-F]+|[+−×÷()]|\s+/gy
    : /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z]+|[π+−×÷^!%(),]|\s+/gy;
  const tokens = [];
  while (tokenPattern.lastIndex < expression.length) {
    const match = tokenPattern.exec(expression);
    if (!match) throw new SyntaxError();
    if (match[0].trim()) tokens.push(match[0]);
  }
  if (!tokens.length) return mode === 'BASE' ? 0n : 0;
  let position = 0;

  function expect(expected) {
    if (tokens[position++] !== expected) throw new SyntaxError();
  }

  function readAtom() {
    const token = tokens[position++];
    if (token === '(') {
      const value = readExpression(1);
      expect(')');
      return value;
    }
    if (token === '−' || token === '+') {
      const value = readExpression(4);
      if (token === '+') return value;
      if (value?.coordinates) throw new SyntaxError();
      if (typeof value === 'object') return {re: -value.re, im: -value.im};
      return -value;
    }
    if (token === 'Ans') return answer;
    if (mode === 'BASE' && /^[0-9A-F]+$/.test(token)) {
      const base = BigInt(radix);
      let result = 0n;
      for (const character of token) {
        const digit = parseInt(character, 16);
        if (digit >= radix) throw new SyntaxError();
        result = result * base + BigInt(digit);
      }
      return result;
    }
    if (mode !== 'BASE' && /^(?:\d|\.\d)/.test(token)) return Number(token);
    if (token === 'i' && mode === 'CMPLX') return {re: 0, im: 1};
    if (Object.hasOwn(constants, token)) return constants[token];
    if (!Object.hasOwn(functions, token)) throw new SyntaxError();
    expect('(');
    const args = [readExpression(1)];
    while (tokens[position] === ',') {
      position++;
      args.push(readExpression(1));
    }
    expect(')');
    const callable = functions[token];
    if (args.length !== callable.length || args.some(value => typeof value !== 'number')) throw new SyntaxError();
    return callable(...args);
  }

  function readExpression(minimum) {
    let left = readAtom();
    while (position < tokens.length) {
      const token = tokens[position];
      const imaginaryFactor = token === 'i' && mode === 'CMPLX';
      const operator = imaginaryFactor ? '×' : token;
      const precedence = Object.hasOwn(operatorPrecedence, operator) ? operatorPrecedence[operator] : 0;
      if (!precedence || precedence < minimum) break;
      if (!imaginaryFactor) position++;
      if (operator === '!' || operator === '%') {
        if (typeof left !== 'number') mathError();
        left = operator === '!' ? factorial(left) : left / 100;
      } else {
        const right = readExpression(operator === '^' ? precedence : precedence + 1);
        left = applyOperator(operator, left, right);
      }
    }
    return left;
  }

  const value = readExpression(1);
  if (position !== tokens.length) throw new SyntaxError();
  if (typeof value === 'number' && !Number.isFinite(value)) mathError();
  if (typeof value === 'object' && ![value.re, value.im].every(Number.isFinite)) mathError();
  return value;
}
