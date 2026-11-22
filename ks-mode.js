'use strict';

const ksStorageKey = 'kscalc-saved-formulas';
const ksBeamVariables = {
  L: {label: 'スパン・張出し長さ', unit: 'm'},
  w: {label: '線荷重', unit: 'kN/m'},
  P: {label: '集中荷重', unit: 'kN'},
  E: {label: 'ヤング係数', unit: 'N/mm²'},
  I: {label: '断面二次モーメント', unit: 'mm⁴'},
};

const ksDefaultVariables = {
  L1: {unit: 'mm'},
  L2: {unit: 'mm'},
  L3: {unit: 'mm'},
  w: {...ksBeamVariables.w, unit: 'N/mm'},
  W: {label: '面荷重', unit: 'N/mm²'},
  P: {...ksBeamVariables.P, unit: 'N'},
  A: {label: '面積', unit: 'mm²'},
  X: {},
  Y: {},
  E: ksBeamVariables.E,
  I: ksBeamVariables.I,
};

function ksVariableInfo(formula, symbol) {
  if (Object.hasOwn(formula?.variables || {}, symbol)) return formula.variables[symbol] || {};
  return Object.hasOwn(ksDefaultVariables, symbol) ? ksDefaultVariables[symbol] : {};
}

const ksBeamGroups = [
  ['単純梁・全長等分布', 'w×L^2÷8', 'w×L÷2', '5×w×L^4÷(384×E×I)×10^12'],
  ['単純梁・中央集中', 'P×L÷4', 'P÷2', 'P×L^3÷(48×E×I)×10^12'],
  ['片持ち梁・全長等分布', 'w×L^2÷2', 'w×L', 'w×L^4÷(8×E×I)×10^12'],
  ['片持ち梁・先端集中', 'P×L', 'P', 'P×L^3÷(3×E×I)×10^12'],
];
const ksBeamOutputs = [['M', '曲げモーメント', 'kN·m'], ['Q', 'せん断力', 'kN'], ['δ', 'たわみ', 'mm']];
const ksReserved = new Set(['Ans', 'sin', 'cos', 'tan', 'sqrt', 'nPr', 'nCr']);
const ksActions = {SHIFT: 'SEL', ALPHA: 'SAV', MODE: '角度', 'KS MODE': 'KS MODE'};
const ksPassThrough = new Set(['▲', '▼', '◀', '▶', 'CALC', '=', 'DEL', 'AC']);
// Reuse the calculator's existing grid positions for KS MODE.
const ksRows = [
  ['L1', 'L2', 'L3', 'w', 'W', 'P'],
  ['A', 'X', 'Y', 'E', 'I', '記号'],
  ['(−)', '√', 'x²', 'xʸ', '(', ')'],
  ['sin', 'cos', 'tan', null, 'CALC', 'コピー'],
];
const ksTokens = {'(−)': '−', '√': '√(', 'x²': '^2', 'xʸ': '^', 'sin': 'sin(',
  'cos': 'cos(', 'tan': 'tan(', '×10ˣ': '×10^', Ans: 'π'};
const ksComparisons = {
  '>': (left, right) => left > right,
  '<': (left, right) => left < right,
  '≤': (left, right) => left <= right,
  '≥': (left, right) => left >= right,
};
const ksCommonSymbols = ['Z', 'σ', 'τ', 'δ', 'θ', 'λ'];
let ksSession = null;

function ksNormalize(expression) {
  return expression.replace(/[＊*]/g, '×').replace(/[／/]/g, '÷').replace(/[-－]/g, '−')
    .replace(/(\d\.?e)−(?=\d)/g, '$1-').replace(/＋/g, '+').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, digits => '^' + [...digits].map(digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)).join(''));
}

function ksSymbols(expression) {
  const matches = expression.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?|L[123](?![A-Za-z0-9])|[A-Za-z]+|[λστδθ]/g);
  return [...new Set([...matches].filter(match => /^[A-Za-zλστδθ]/.test(match[0]) &&
    !ksReserved.has(match[0]) && !/^\s*\(/.test(expression.slice(match.index + match[0].length)))
    .map(match => match[0]))];
}

function ksEvaluate(expression, values, syntaxOnly = false) {
  const formula = ksNormalize(expression).trim();
  if (!formula || /\bAns\b/.test(formula)) throw new SyntaxError();
  const parts = formula.split(/([<>≤≥])/);
  const options = {savedFormula: true, syntaxOnly};
  if (parts.length === 1) return evaluate(completeExpression(formula), values, options);
  if (parts.length !== 3 || !parts[0].trim() || !parts[2].trim()) throw new SyntaxError();
  const [lhs, operator, rhs] = parts;
  const left = evaluate(completeExpression(lhs), values, options);
  const right = evaluate(completeExpression(rhs), values, options);
  if (syntaxOnly) return;
  if (!Number.isFinite(left) || !Number.isFinite(right)) mathError();
  return ksComparisons[operator](left, right);
}

function ksReadFormulas() {
  const saved = JSON.parse(localStorage.getItem(ksStorageKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('保存した式を読み込めません。');
  return saved;
}

function ksBuiltins() {
  return ksBeamGroups.flatMap(([name, ...expressions]) => {
    const cantilever = name.startsWith('片持ち');
    return ksBeamOutputs.map(([symbol, quantity, unit], index) => ({
      name: name + '・' + quantity,
      expression: expressions[index],
      unit,
      symbol,
      variables: {...ksBeamVariables, L: {...ksBeamVariables.L, label: cantilever ? '張出し長さ' : 'スパン'}},
      builtin: true,
      note: index === 2 ? 'EI 一定・曲げたわみ（' + (cantilever ? '自由端' : '中央') + '）'
        : '下向き荷重による' + (cantilever ? '固定端の' : '最大') + '断面力の大きさ',
    }));
  });
}

function toggleKSMode() {
  if (ksSession) {
    const result = $('result');
    result.textContent = ksSession.normalOutput;
    delete result.dataset.ksValue;
    $('ks-entry-hint').hidden = true;
    if (ksSession.normalFormat !== undefined) result.dataset.format = ksSession.normalFormat;
    ksSession = null;
  } else {
    ksSession = {
      page: 'edit', text: '', cursor: 0, source: null, note: 'SEL 式を選ぶ　SAV 式を保存',
      normalOutput: $('result').textContent, normalFormat: $('result').dataset.format,
      extraSymbols: new Set(), selection: 0, lastValues: {},
    };
    delete $('result').dataset.format;
  }
  render();
}

function ksKeyLabel(key) {
  if (Object.hasOwn(ksActions, key)) return key === 'MODE' ? angleUnits[angleUnit] : ksActions[key];
  if (key === 'Ans') return 'π';
  if (ksRows.some(row => row.includes(key)) || key === '×10ˣ') return key;
  return ksPassThrough.has(key) || /^[0-9.×÷+−]$/.test(key) ? key : '';
}

function renderKSMode() {
  const state = ksSession;
  const choosing = state.page === 'select' || state.page === 'delete';
  const formula = choosing ? state.items[state.selection] : state.source;
  const unchanged = formula && (choosing || state.text === formula.expression);
  const caption = formula ? formula.name + (!unchanged ? '（編集中）' : '') : '';
  $('status').textContent = angleUnits[angleUnit] + ' · COMP' +
    (fixDigits === null ? ' · Norm' : ' · FIX ' + fixDigits) + ' · KS MODE';
  $('ks-caption').textContent = caption;
  $('ks-caption').hidden = !caption;
  const text = (formula?.symbol ? formula.symbol + ' = ' : '') + (choosing ? formula.expression : state.text);
  const caret = state.page === 'edit' ? text.length - state.text.length + state.cursor : null;
  let details = state.note || (unchanged ? formula.note : '') || '';
  const enteringValue = state.page === 'values';
  const result = $('result');
  const hint = $('ks-entry-hint');
  hint.hidden = !enteringValue;
  if (choosing) {
    details = state.page === 'delete' ? '削除しますか？　＝ 確定　AC 取消'
      : (state.selection + 1) + '/' + state.items.length + '　▲▼ 選択　＝ 決定　CALC 代入' + (formula.id ? '　DEL 削除' : '');
  } else if (enteringValue) {
    const symbol = state.fields[state.fieldIndex];
    const info = ksVariableInfo(formula, symbol);
    details = [symbol, info.label, info.unit ? '[' + info.unit + ']' : ''].filter(Boolean).join(' ') +
      '　' + (state.fieldIndex + 1) + '/' + state.fields.length;
    hint.textContent = state.note || '＝ 確定';
    // Keep the formula's horizontal scroll position while entering values.
    if (!Object.hasOwn(result.dataset, 'ksValue') || $('expr').textContent !== text) renderExpression(text);
    result.dataset.ksValue = '';
    renderExpression(state.valueText, state.valueCursor, false, result);
  }
  if (!enteringValue) {
    delete result.dataset.ksValue;
    renderExpression(text, caret);
    result.textContent = state.output || '';
  }
  $('screen-details').textContent = details;
  $('screen-details').hidden = !details;
  $('top').dataset.ksActive = '';
  $('ks-key-pad').hidden = false;
  $('function-keys').hidden = true;
  for (const {button, key, primary, secondary} of keyLabels) {
    button.hidden = false;
    const label = ksKeyLabel(key);
    primary.textContent = label;
    if (key === 'コピー' && state.copiedText && state.copiedText === ksCopyText()) primary.textContent = 'コピー済';
    secondary.textContent = '';
    button.disabled = !label;
    if (!label) button.dataset.ksBlank = '';
    button.classList.toggle('alpha-key', false);
    button.classList.toggle('shifted', false);
    button.classList.toggle('active', key === 'KS MODE');
  }
}

function ksSelect() {
  const state = ksSession;
  let saved = [];
  try {
    saved = ksReadFormulas();
  } catch {
    state.note = '保存した式を読み込めません。';
    state.output = '';
    state.page = 'edit';
    return;
  }
  state.items = [...saved, ...ksBuiltins()];
  const index = state.items.findIndex(item => item.id ? item.id === state.source?.id
    : item.builtin && state.source?.builtin && item.name === state.source.name);
  state.selection = index < 0 ? 0 : index;
  state.page = 'select';
}

function ksLoadFormula(formula) {
  Object.assign(ksSession, {
    source: formula, text: formula.expression, cursor: formula.expression.length,
    page: 'edit', note: '', output: '', lastValues: {},
  });
  for (const symbol of ksSymbols(formula.expression)) {
    if (!Object.hasOwn(ksDefaultVariables, symbol) && !Object.hasOwn(ksComparisons, symbol)) ksSession.extraSymbols.add(symbol);
  }
}

function ksChoose(key) {
  const state = ksSession;
  const item = state.items[state.selection];
  if (state.page === 'delete') {
    if (key === 'AC') state.page = 'select';
    if (key === '=') {
      try {
        const remaining = ksReadFormulas().filter(formula => formula.id !== item.id);
        localStorage.setItem(ksStorageKey, JSON.stringify(remaining));
        if (state.source?.id === item.id) state.source = {...state.source, id: undefined};
        state.items.splice(state.selection, 1);
        state.selection = Math.min(state.selection, state.items.length - 1);
        state.page = 'select';
      } catch {
        state.note = '式を削除できませんでした。';
        state.page = 'edit';
      }
    }
    return;
  }
  if (key === 'AC' || key === 'SHIFT') state.page = 'edit';
  if (key === 'DEL' && item.id) state.page = 'delete';
  if (key === '=' || key === 'CALC') {
    ksLoadFormula(item);
    if (key === 'CALC') ksStartCalc();
  }
  if (key === '▲' || key === '▼') {
    const count = state.items.length;
    state.selection = (state.selection + count + (key === '▲' ? -1 : 1)) % count;
  }
}

function ksCheckedExpression() {
  const expression = ksNormalize(ksSession.text).trim().split(/([<>≤≥])/)
    .map((part, index) => index % 2 ? part : completeExpression(part.trim())).join('');
  const symbols = ksSymbols(expression);
  ksEvaluate(expression, Object.fromEntries(symbols.map(symbol => [symbol, 0])), true);
  return {expression, symbols};
}

function ksStartCalc() {
  const state = ksSession;
  state.note = '';
  state.output = '';
  try {
    const {expression, symbols} = ksCheckedExpression();
    state.calculation = expression;
    state.fields = symbols;
    if (state.source?.builtin && state.text === state.source.expression) {
      const order = Object.keys(ksBeamVariables);
      state.fields.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    state.values = {};
    if (state.fields.length) {
      state.page = 'values';
      ksShowField(0);
    } else ksFinishCalc();
  } catch {
    state.note = '式を確認してください。';
  }
}

function ksShowField(index) {
  const state = ksSession;
  const symbol = state.fields[index];
  const previous = Object.hasOwn(state.lastValues, symbol) ? state.lastValues[symbol] : '';
  state.fieldIndex = index;
  state.valueText = String(previous).replace(/^-/, '−');
  state.valueCursor = state.valueText.length;
  state.replaceValue = true;
}

function ksFinishCalc() {
  const state = ksSession;
  const formula = state.source;
  state.page = 'edit';
  state.lastValues = state.values;
  try {
    const result = ksEvaluate(state.calculation, state.values);
    if (typeof result !== 'boolean' && !Number.isFinite(result)) mathError();
    state.output = typeof result === 'boolean' ? (result ? 'OK' : 'NG') : (formula?.symbol ? formula.symbol + ' = ' : '') + decimalText(result) +
      (formula?.unit ? ' ' + formula.unit : '');
    state.note = ksAssignments(formula, state.values);
  } catch (error) {
    state.note = error.message === 'Math ERROR' ? '計算できない値です。' : '式を確認してください。';
  }
}

function ksAcceptValue() {
  const state = ksSession;
  const symbol = state.fields[state.fieldIndex];
  try {
    const value = ksEvaluate(state.valueText, {});
    if (!Number.isFinite(value)) mathError();
    if (state.source?.builtin && state.text === state.source.expression) {
      const positive = ['L', 'E', 'I'].includes(symbol);
      if (positive ? value <= 0 : value < 0) {
        state.note = positive ? '正の値を入力してください。' : '0 以上の値を入力してください。';
        return;
      }
    }
    Object.defineProperty(state.values, symbol, {value, enumerable: true, configurable: true});
    state.note = '';
    if (state.fieldIndex + 1 < state.fields.length) ksShowField(state.fieldIndex + 1);
    else ksFinishCalc();
  } catch {
    state.note = '数値を確認してください。';
  }
}

function ksEditText(key, token, enteringValue = false) {
  const state = ksSession;
  const textKey = enteringValue ? 'valueText' : 'text';
  const cursorKey = enteringValue ? 'valueCursor' : 'cursor';
  let text = state[textKey];
  let cursor = state[cursorKey];
  state.note = '';
  state.output = '';
  if (key === '◀' || key === '▶') {
    cursor = Math.min(text.length, Math.max(0, cursor + (key === '◀' ? -1 : 1)));
  } else if (key === 'DEL' && cursor > 0) {
    text = text.slice(0, cursor - 1) + text.slice(cursor);
    cursor--;
  } else if (token) {
    if (enteringValue && state.replaceValue) {
      text = '';
      cursor = 0;
    }
    if (text.length + token.length <= 240) {
      text = text.slice(0, cursor) + token + text.slice(cursor);
      cursor += token.length;
    }
  }
  state[textKey] = text;
  state[cursorKey] = cursor;
  if (enteringValue) state.replaceValue = false;
}

function pressKSMode(key) {
  const state = ksSession;
  if (!ksKeyLabel(key)) return;
  if (key === 'コピー') {
    void ksCopyDisplay();
    return;
  }
  state.copiedText = '';
  const token = ksTokens[key] || (/^[0-9.×÷+−()]$/.test(key) || Object.hasOwn(ksDefaultVariables, key) ? key : '');
  if (state.page === 'select' || state.page === 'delete') {
    ksChoose(key);
  } else if (key === 'AC') {
    Object.assign(state, {
      page: 'edit', source: null, text: '', cursor: 0, output: '', note: '',
      calculation: '', lastValues: {}, values: {}, fields: [], fieldIndex: 0,
      valueText: '', valueCursor: 0,
    });
  } else if (state.page === 'values') {
    if (key === '=') ksAcceptValue();
    else if (key === 'CALC') {
      state.page = 'edit';
      state.note = '';
    } else if (key === 'SHIFT') ksSelect();
    else if ((token && !Object.hasOwn(ksDefaultVariables, token)) || ['DEL', '◀', '▶'].includes(key)) {
      ksEditText(key, token, true);
    }
  } else if (key === 'SHIFT') ksSelect();
  else if (key === 'ALPHA') ksOpenSave();
  else if (key === 'MODE') cycleAngleUnit();
  else if (key === 'CALC') ksStartCalc();
  else if (key === '=') {
    if (ksSymbols(ksNormalize(state.text)).length) state.note = 'CALC で変数に代入';
    else ksStartCalc();
  } else if (key === '記号') ksOpenVariables();
  else if (token || ['DEL', '◀', '▶'].includes(key)) ksEditText(key, token);
  render();
}

function ksOpenSave() {
  const state = ksSession;
  let symbols;
  try {
    ({symbols} = ksCheckedExpression());
  } catch {
    state.note = '保存する式を確認してください。';
    return;
  }
  const source = state.source;
  $('ks-name').value = source?.name ? source.name + (source.builtin ? '（コピー）' : '') : '';
  $('ks-unit').value = source?.unit || '';
  $('ks-details').open = false;
  $('ks-save-message').textContent = '';
  $('ks-save-as').hidden = !source?.id;
  $('ks-save-button').textContent = source?.id ? '上書き保存' : '保存';
  state.metadataFields = symbols.map(symbol => {
    const info = ksVariableInfo(source, symbol);
    const row = document.createElement('div');
    row.className = 'ks-meta';
    const [label, unit] = [['label', symbol + ' の名前', 32], ['unit', '単位', 24]].map(([key, title, limit]) => {
      const fieldLabel = document.createElement('label');
      fieldLabel.textContent = title;
      const input = document.createElement('input');
      input.value = info[key] || '';
      input.maxLength = limit;
      fieldLabel.append(input);
      row.append(fieldLabel);
      return input;
    });
    return {symbol, row, label, unit};
  });
  $('ks-variable-details').replaceChildren(...state.metadataFields.map(field => field.row));
  $('ks-save-panel').showModal();
}

function ksSave(event) {
  event.preventDefault();
  const state = ksSession;
  const name = $('ks-name').value.trim();
  if (!name) {
    $('ks-save-message').textContent = '式の名前を入力してください。';
    return;
  }
  try {
    const {expression} = ksCheckedExpression();
    const items = ksReadFormulas();
    const id = event.submitter === $('ks-save-as') ? null : state.source?.id;
    const index = id ? items.findIndex(item => item.id === id) : -1;
    if (id && index < 0) {
      $('ks-save-message').textContent = '元の式がありません。別名保存してください。';
      return;
    }
    if (name !== items[index]?.name && (items.some(item => item.name === name) ||
        ksBuiltins().some(item => item.name === name))) {
      $('ks-save-message').textContent = 'その名前は使われています。別の名前を入力してください。';
      return;
    }
    const formula = {
      id: id || crypto.randomUUID(), name, expression, unit: $('ks-unit').value.trim(),
      variables: Object.fromEntries(state.metadataFields.map(({symbol, label, unit}) =>
        [symbol, {label: label.value.trim(), unit: unit.value.trim()}])),
    };
    if (state.source?.symbol) formula.symbol = state.source.symbol;
    if (index < 0) items.push(formula);
    else items[index] = formula;
    localStorage.setItem(ksStorageKey, JSON.stringify(items));
    $('ks-save-panel').close();
    ksLoadFormula(formula);
    state.note = '保存しました';
    render();
  } catch {
    $('ks-save-message').textContent = '式を保存できませんでした。';
  }
}

function ksOpenVariables() {
  $('ks-symbol').value = '';
  $('ks-symbol-message').textContent = '';
  const symbols = [...new Set([...ksCommonSymbols, ...Object.keys(ksComparisons), ...ksSession.extraSymbols])];
  $('ks-extra-variables').replaceChildren(...symbols.map(symbol => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = symbol;
    button.addEventListener('click', () => ksInsertVariable(symbol));
    return button;
  }));
  $('ks-variable-panel').showModal();
}

function ksInsertVariable(symbol) {
  if (!Object.hasOwn(ksDefaultVariables, symbol) && !Object.hasOwn(ksComparisons, symbol)) ksSession.extraSymbols.add(symbol);
  $('ks-variable-panel').close();
  ksEditText('', symbol);
  render();
}

function ksAssignments(formula, values) {
  return Object.entries(values).map(([symbol, value]) => {
    const unit = ksVariableInfo(formula, symbol).unit;
    return symbol + ' = ' + value + (unit ? ' ' + unit : '');
  }).join('　');
}

function ksCopyText() {
  const state = ksSession;
  const choosing = state.page === 'select' || state.page === 'delete';
  const formula = choosing ? state.items[state.selection] : state.source;
  const expression = choosing ? formula.expression : state.text;
  if (!expression) return '';
  return [
    formula?.name,
    (formula?.symbol ? formula.symbol + ' = ' : '') + expression,
    !choosing && state.output ? ksAssignments(formula, state.lastValues) : '',
    !choosing && state.output,
  ].filter(Boolean).join('\n');
}

async function ksCopyDisplay() {
  const state = ksSession;
  const text = ksCopyText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (ksSession === state) {
      state.copiedText = text;
      render();
    }
  } catch {
    if (ksSession !== state) return;
    const input = $('ks-copy-text');
    input.value = text;
    $('ks-copy-panel').showModal();
    input.select();
  }
}

function initializeKSMode() {
  $('ks-save-form').addEventListener('submit', ksSave);
  $('ks-cancel-save').addEventListener('click', () => $('ks-save-panel').close());
  $('ks-cancel-symbol').addEventListener('click', () => $('ks-variable-panel').close());
  $('ks-symbol-form').addEventListener('submit', event => {
    event.preventDefault();
    const symbol = $('ks-symbol').value.trim();
    if (!/^(?:[A-Za-z]{1,12}|L[123]|[λστδθ])$/.test(symbol) || ksReserved.has(symbol)) {
      $('ks-symbol-message').textContent = '半角英字、L1・L2・L3、または一覧のギリシャ文字を入力してください。';
      return;
    }
    ksInsertVariable(symbol);
  });
}
