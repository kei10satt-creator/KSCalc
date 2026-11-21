'use strict';

const ksStorageKey = 'kscalc-saved-formulas';
const ksBeamVariables = {
  L: {label: 'スパン・張出し長さ', unit: 'm'},
  w: {label: '線荷重', unit: 'kN/m'},
  P: {label: '集中荷重', unit: 'kN'},
  E: {label: 'ヤング係数', unit: 'N/mm²'},
  I: {label: '断面二次モーメント', unit: 'mm⁴'},
};

const ksBeamGroups = [
  ['単純梁・全長等分布', 'w×L^2÷8', 'w×L÷2', '5×w×L^4÷(384×E×I)×10^12'],
  ['単純梁・中央集中', 'P×L÷4', 'P÷2', 'P×L^3÷(48×E×I)×10^12'],
  ['片持ち梁・全長等分布', 'w×L^2÷2', 'w×L', 'w×L^4÷(8×E×I)×10^12'],
  ['片持ち梁・先端集中', 'P×L', 'P', 'P×L^3÷(3×E×I)×10^12'],
];
const ksBeamOutputs = [['M', '曲げモーメント', 'kN·m'], ['Q', 'せん断力', 'kN'], ['δ', 'たわみ', 'mm']];
const ksReserved = new Set(['Ans', 'sin', 'cos', 'tan', 'sqrt', 'nPr', 'nCr']);
let ksInitialized = false;
let ksFormula;
let ksEditingId;
let ksEditorVariables;
let ksEditorSymbols;
let ksRunFields;

function ksNormalize(expression) {
  return expression.replace(/[＊*]/g, '×').replace(/[／/]/g, '÷').replace(/[-－]/g, '−')
    .replace(/(\d\.?e)−(?=\d)/g, '$1-').replace(/＋/g, '+').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, digits => '^' + [...digits].map(digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)).join(''));
}

function ksSymbols(expression) {
  const matches = expression.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?|[A-Za-z]+/g);
  return [...new Set([...matches].filter(match => /^[A-Za-z]/.test(match[0]) &&
    !ksReserved.has(match[0]) && !/^\s*\(/.test(expression.slice(match.index + match[0].length)))
    .map(match => match[0]))];
}

function ksEvaluate(expression, values, syntaxOnly = false) {
  const formula = ksNormalize(expression).trim();
  if (!formula || /\bAns\b/.test(formula)) throw new SyntaxError();
  return evaluate(completeExpression(formula), values, {savedFormula: true, syntaxOnly});
}

function ksReadFormulas() {
  const saved = JSON.parse(localStorage.getItem(ksStorageKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('保存した式を読み込めません。');
  return saved;
}

function ksButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function ksShow(page) {
  for (const name of ['list', 'run', 'editor']) $('ks-' + name).hidden = name !== page;
  $('ks-panel').scrollTop = 0;
}

function ksList() {
  $('ks-beams').replaceChildren(...ksBeamGroups.map(([name, ...expressions]) => {
    const row = document.createElement('div');
    row.className = 'ks-card';
    const title = document.createElement('strong');
    title.textContent = name;
    const choices = document.createElement('div');
    choices.className = 'ks-choices';
    choices.append(...ksBeamOutputs.map(([symbol, quantity, unit], index) => {
      const button = ksButton(index === 2 ? 'たわみ' : symbol, () => ksOpenFormula({
        name: name + '・' + quantity, expression: expressions[index], unit, symbol,
        variables: ksBeamVariables, builtin: true, lengthLabel: name.startsWith('片持ち') ? '張出し長さ' : 'スパン',
        note: index === 2 ? '全長で EI 一定。曲げたわみの大きさ（' + (name.startsWith('片持ち') ? '自由端' : '中央') + '）。×10¹²は入力単位から mm への換算です。'
          : '下向き荷重による' + (name.startsWith('片持ち') ? '固定端の' : '最大') + '断面力の大きさ。',
      }));
      button.setAttribute('aria-label', name + '・' + quantity);
      return button;
    }));
    row.append(title, choices);
    return row;
  }));
  try {
    const items = ksReadFormulas();
    $('ks-custom-list').hidden = items.length === 0;
    $('ks-custom').replaceChildren(...items.map(item => ksButton(item.name, () => ksOpenFormula(item))));
  } catch {
    $('ks-custom-list').hidden = false;
    $('ks-custom').textContent = '保存した式を読み込めません。';
  }
  ksShow('list');
}

function ksOpenFormula(formula) {
  ksFormula = formula;
  $('ks-run-name').textContent = formula.name;
  $('ks-run-expression').textContent = (formula.symbol ? formula.symbol + ' = ' : '') + formula.expression;
  $('ks-run-note').textContent = formula.note ||
    (/\b(?:sin|cos|tan)\s*\(/.test(formula.expression) ? '三角関数の入力：' + angleUnits[angleUnit] : '');
  $('ks-result').textContent = '';
  $('ks-edit').textContent = formula.builtin ? 'コピーして編集' : '式を編集';
  ksRunFields = ksSymbols(formula.expression).sort((a, b) => formula.builtin ? Object.keys(ksBeamVariables).indexOf(a) - Object.keys(ksBeamVariables).indexOf(b) : 0).map(symbol => {
    const info = Object.hasOwn(formula.variables || {}, symbol) ? formula.variables[symbol] : {};
    const name = (formula.builtin && symbol === 'L' ? formula.lengthLabel : info.label) || '';
    const label = document.createElement('label');
    label.textContent = [symbol, name, info.unit ? '[' + info.unit + ']' : ''].filter(Boolean).join(' ');
    const input = document.createElement('input');
    input.inputMode = 'decimal';
    input.required = true;
    input.autocomplete = 'off';
    label.append(input);
    return {symbol, input, label};
  });
  $('ks-inputs').replaceChildren(...ksRunFields.map(field => field.label));
  ksShow('run');
}

function ksCalculate(event) {
  event.preventDefault();
  const values = Object.fromEntries(ksRunFields.map(({symbol, input}) => [symbol, readNumber(input)]));
  const output = $('ks-result');
  if (!Object.values(values).every(Number.isFinite)) {
    output.textContent = 'すべての変数に数値を入力してください。';
    return;
  }
  if (ksFormula.builtin && Object.entries(values).some(([symbol, value]) => ['L', 'E', 'I'].includes(symbol) ? value <= 0 : value < 0)) {
    output.textContent = 'L・E・I は正の値、荷重は 0 以上を入力してください。';
    return;
  }
  try {
    const result = ksEvaluate(ksFormula.expression, values);
    if (!Number.isFinite(result)) mathError();
    output.textContent = (ksFormula.symbol ? ksFormula.symbol + ' = ' : '') +
      Number(result.toPrecision(12)) + (ksFormula.unit ? ' ' + ksFormula.unit : '');
  } catch (error) {
    output.textContent = error.message === 'Math ERROR' ? '計算できない値です。' : '式を確認してください。';
  }
}

function ksInsert(value) {
  const input = $('ks-expression');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (value === 'AC') input.value = '';
  else if (value === 'DEL') input.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end');
  else if (input.value.length - (end - start) + value.length <= input.maxLength) input.setRangeText(value, start, end, 'end');
  input.focus();
  ksRefreshDetails();
}

function ksRefreshDetails() {
  $('ks-message').textContent = '';
  const variables = ksSymbols(ksNormalize($('ks-expression').value));
  $('ks-variable-details').replaceChildren(...variables.map(symbol => {
    const row = document.createElement('div');
    row.className = 'ks-meta';
    const metadata = ksEditorVariables[symbol] ??= {};
    for (const [field, title] of [['label', symbol + ' の名前'], ['unit', '単位']]) {
      const label = document.createElement('label');
      label.textContent = title;
      const input = document.createElement('input');
      input.value = metadata[field] || '';
      input.maxLength = field === 'label' ? 32 : 24;
      input.addEventListener('input', () => { metadata[field] = input.value.trim(); });
      label.append(input);
      row.append(label);
    }
    return row;
  }));
}

function ksVariableKeys() {
  $('ks-variable-keys').replaceChildren(
    ...[...ksEditorSymbols].map(symbol => ksButton(symbol, () => ksInsert(symbol))),
    ksButton('変数＋', () => {
      $('ks-add-variable').hidden = !$('ks-add-variable').hidden;
      if (!$('ks-add-variable').hidden) $('ks-symbol').focus();
    }),
  );
}

function ksOpenEditor(formula) {
  ksEditingId = formula?.id;
  ksEditorVariables = Object.assign(Object.create(null), structuredClone(formula?.variables || {}));
  if (formula?.builtin && formula.lengthLabel) ksEditorVariables.L.label = formula.lengthLabel;
  $('ks-editor-title').textContent = ksEditingId ? '式を編集' : '式を作る';
  $('ks-name').value = formula?.builtin ? formula.name + '（コピー）' : formula?.name || '';
  $('ks-expression').value = formula?.expression || '';
  $('ks-unit').value = formula?.unit || '';
  $('ks-details').open = false;
  $('ks-add-variable').hidden = true;
  $('ks-symbol').value = '';
  ksEditorSymbols = new Set([...Object.keys(ksBeamVariables), ...ksSymbols($('ks-expression').value)]);
  ksVariableKeys();
  ksRefreshDetails();
  ksShow('editor');
}

function ksCheckedExpression() {
  const expression = completeExpression(ksNormalize($('ks-expression').value).trim());
  const symbols = ksSymbols(expression);
  ksEvaluate(expression, Object.fromEntries(symbols.map(symbol => [symbol, 0])), true);
  return {expression, symbols};
}

function ksSave(event) {
  event.preventDefault();
  const message = $('ks-message');
  const name = $('ks-name').value.trim();
  if (!name) {
    message.textContent = '式の名前を入力してください。';
    return;
  }
  let formula;
  try {
    const {expression, symbols} = ksCheckedExpression();
    formula = {
      id: ksEditingId || crypto.randomUUID(),
      name, expression, unit: $('ks-unit').value.trim(),
      variables: Object.fromEntries(symbols.map(symbol => [symbol, ksEditorVariables[symbol] || {}])),
    };
  } catch {
    message.textContent = '計算式を確認してください。掛け算は × を入力します。';
    return;
  }
  try {
    const items = ksReadFormulas();
    const index = items.findIndex(item => item.id === formula.id);
    if (index === -1) items.push(formula);
    else items[index] = formula;
    localStorage.setItem(ksStorageKey, JSON.stringify(items));
    ksOpenFormula(formula);
  } catch {
    message.textContent = '式を保存できませんでした。';
  }
}

function openKSMode() {
  if (!ksInitialized) {
    $('ks-new').addEventListener('click', () => ksOpenEditor());
    $('ks-run-back').addEventListener('click', ksList);
    $('ks-editor-back').addEventListener('click', ksList);
    $('ks-edit').addEventListener('click', () => ksOpenEditor(ksFormula));
    $('ks-run-form').addEventListener('submit', ksCalculate);
    $('ks-editor-form').addEventListener('submit', ksSave);
    $('ks-expression').addEventListener('input', ksRefreshDetails);
    $('ks-inputs').addEventListener('input', () => { $('ks-result').textContent = ''; });
    $('ks-add-symbol').addEventListener('click', () => {
      const symbol = $('ks-symbol').value.trim();
      if (!/^[A-Za-z]{1,12}$/.test(symbol) || ksReserved.has(symbol)) {
        $('ks-message').textContent = '使える変数記号を半角英字で入力してください。';
        return;
      }
      ksEditorSymbols.add(symbol);
      ksVariableKeys();
      $('ks-add-variable').hidden = true;
      $('ks-symbol').value = '';
      ksInsert(symbol);
    });
    $('ks-symbol').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('ks-add-symbol').click();
      }
    });
    const keys = [['√', '√('], ['x²', '^2'], ['xʸ', '^'], ['(−)', '−'], ['(', '('], [')', ')'],
      ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan(']];
    $('ks-function-keys').replaceChildren(...keys.map(([label, value]) => ksButton(label, () => ksInsert(value))));
    const numbers = ['7', '8', '9', 'DEL', 'AC', '4', '5', '6', '×', '÷', '1', '2', '3', '+', '−', '0', '.', '×10ˣ', 'π'];
    $('ks-number-keys').replaceChildren(...numbers.map(label => ksButton(label, () => ksInsert(label === '×10ˣ' ? '×10^' : label))),
      ksButton('＝', () => {
        try {
          ksCheckedExpression();
          $('ks-message').textContent = '式を確認しました。名前を付けて保存できます。';
        } catch {
          $('ks-message').textContent = '計算式を確認してください。';
        }
      }));
    ksInitialized = true;
  }
  ksList();
  $('ks-panel').showModal();
}
