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

function evaluateArithmetic(expression, {mode, radix, answer, constants, functions, factorial, syntaxOnly = false}) {
  // Parse once so numerical functions can evaluate their first argument for many X values.
  const sampledFunctions = {sum: 2, integral: 2, derivative: 1};
  let samples = 0;
  function sample(expression, scope, x) {
    if (++samples > 50000) mathError();
    const value = expression({...scope, X: x});
    if (!Number.isFinite(value)) mathError();
    return value;
  }
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
      return scope => {
        const operand = value(scope);
        if (operand?.coordinates) throw new SyntaxError();
        if (typeof operand === 'object') return {re: -operand.re, im: -operand.im};
        return -operand;
      };
    }
    if (token === 'Ans') return () => answer;
    if (mode === 'BASE' && /^[0-9A-F]+$/.test(token)) {
      const base = BigInt(radix);
      let result = 0n;
      for (const character of token) {
        const digit = parseInt(character, 16);
        if (digit >= radix) throw new SyntaxError();
        result = result * base + BigInt(digit);
      }
      return () => result;
    }
    if (mode !== 'BASE' && /^(?:\d|\.\d)/.test(token)) return () => Number(token);
    if (token === 'i' && mode === 'CMPLX') return () => ({re: 0, im: 1});
    if (Object.hasOwn(constants, token)) return scope => scope[token];
    if (!Object.hasOwn(functions, token)) throw new SyntaxError();
    expect('(');
    const args = [readExpression(1)];
    while (tokens[position] === ',') {
      position++;
      args.push(readExpression(1));
    }
    expect(')');
    const callable = functions[token];
    if (Object.hasOwn(sampledFunctions, token)) {
      const [formula, ...parameters] = args;
      if (parameters.length !== sampledFunctions[token]) throw new SyntaxError();
      return scope => callable(x => sample(formula, scope, x), ...parameters.map(parameter => parameter(scope)));
    }
    if (args.length !== callable.length) throw new SyntaxError();
    return scope => {
      const values = args.map(argument => argument(scope));
      if (values.some(value => typeof value !== 'number')) throw new SyntaxError();
      return callable(...values);
    };
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
      const previous = left;
      if (operator === '!' || operator === '%') {
        left = scope => {
          const value = previous(scope);
          if (typeof value !== 'number') mathError();
          return operator === '!' ? factorial(value) : value / 100;
        };
      } else {
        const right = readExpression(operator === '^' ? precedence : precedence + 1);
        left = scope => applyOperator(operator, previous(scope), right(scope));
      }
    }
    return left;
  }

  const formula = readExpression(1);
  if (position !== tokens.length) throw new SyntaxError();
  if (syntaxOnly) return;
  const value = formula(constants);
  if (typeof value === 'number' && !Number.isFinite(value)) mathError();
  if (typeof value === 'object' && ![value.re, value.im].every(Number.isFinite)) mathError();
  return value;
}

function sumValues(sample, first, last) {
  if (![first, last].every(Number.isSafeInteger) || last < first || last - first >= 10000) mathError();
  let total = 0;
  let correction = 0;
  for (let x = first; x <= last; x++) {
    const term = sample(x) - correction;
    const next = total + term;
    correction = (next - total) - term;
    total = next;
  }
  return total;
}

function derivativeAt(sample, x) {
  if (!Number.isFinite(x)) mathError();
  // Compare estimates from both sides to catch corners such as |X| at zero.
  const step = Math.max(1, Math.abs(x)) * 1e-4;
  const center = sample(x);
  const secondOrder = (near, far) => (4 * (near - center) - (far - center)) / step;
  const right = secondOrder(sample(x + step / 2), sample(x + step));
  const left = -secondOrder(sample(x - step / 2), sample(x - step));
  if (Math.abs(left - right) > 1e-6 * Math.max(1, Math.abs(left), Math.abs(right))) mathError();
  return (left + right) / 2;
}

function integrateBetween(sample, lower, upper) {
  if (![lower, upper].every(Number.isFinite)) mathError();
  if (lower === upper) return 0;
  const simpson = (a, b, left, middle, right) =>
    (b - a) * (left / 6 + middle * (2 / 3) + right / 6);
  function refine(a, b, left, middle, right, estimate, tolerance, depth) {
    const mid = a + (b - a) / 2;
    if (mid === a || mid === b) return estimate;
    const first = sample(a + (mid - a) / 2);
    const second = sample(mid + (b - mid) / 2);
    const integralLeft = simpson(a, mid, left, first, middle);
    const integralRight = simpson(mid, b, middle, second, right);
    const delta = integralLeft + integralRight - estimate;
    if (Math.abs(delta) <= 15 * tolerance) return integralLeft + integralRight + delta / 15;
    if (!depth) mathError();
    return refine(a, mid, left, first, middle, integralLeft, tolerance / 2, depth - 1) +
      refine(mid, b, middle, second, right, integralRight, tolerance / 2, depth - 1);
  }
  const left = sample(lower);
  const right = sample(upper);
  // Seed several intervals to catch variation missed by a single three-point estimate.
  let total = 0;
  let a = lower;
  let start = left;
  for (let index = 1; index <= 8; index++) {
    const b = index === 8 ? upper : lower + (upper - lower) * (index / 8);
    const end = index === 8 ? right : sample(b);
    const mid = sample(a + (b - a) / 2);
    const estimate = simpson(a, b, start, mid, end);
    total += refine(a, b, start, mid, end, estimate, 1e-11 * Math.max(1, Math.abs(estimate)), 18);
    a = b;
    start = end;
  }
  return total;
}

function solveEquation(sample, initial) {
  let x = initial;
  for (let iteration = 0; iteration < 100; iteration++) {
    const [left, right] = sample(x);
    const difference = left - right;
    if (difference === 0) return x;
    const step = Math.max(1, Math.abs(x)) * 1e-5;
    const residual = ([a, b]) => a - b;
    const slope = (residual(sample(x + step)) - residual(sample(x - step))) / (2 * step);
    if (!Number.isFinite(slope)) mathError();
    // Move off a stationary initial point to give Newton's method a direction.
    if (slope === 0) {
      x += step;
      continue;
    }
    const correction = difference / slope;
    const next = x - correction;
    if (!Number.isFinite(next)) mathError();
    if (Math.abs(correction) <= 1e-12 * Math.max(1, Math.abs(x)) &&
        Math.abs(difference) <= 1e-10 * Math.max(Math.abs(left), Math.abs(right), 1)) return next;
    x = next;
  }
  mathError();
}
