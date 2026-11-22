'use strict';

const ksConstantsStorageKey = 'kscalc-saved-constants';
const ksLastSectionKey = 'kscalc-last-section';
const ksSectionFields = {A: 'mm²', I: 'mm⁴', Z: 'mm³', i: 'mm'};
const ksMaterialUnit = 'N/mm²';
const ksMaterialSource = '国土交通省「建築構造設計基準の資料」表4.2.1';
const ksSteelSectionSource = 'JFEスチール H形鋼［JIS材］断面性能表';
const ksTubeSource = 'JFEスチール BCR295・JBCR 断面性能表';
const ksSteelSection = (name, A, x, y, note = ksSteelSectionSource) => ({
  name, note, data: {A, ...Object.fromEntries(['x', 'y'].flatMap((axis, index) =>
    ['I', 'Z', 'i'].map((symbol, i) => [symbol + axis, (index ? y : x)[i]])))},
});
const ksConstantPresets = {
  steel: [{name: '鋼材', data: {E: 205000}, note: ksMaterialSource}],
  rc: [18, 21, 24, 27, 30, 36].map(fc => ({
    name: 'コンクリート Fc' + fc + '（γ=23 kN/m³）',
    data: {E: Number((33500 * (23 / 24) ** 2 * Math.cbrt(fc / 60)).toPrecision(6))},
    note: ksMaterialSource + ' · 普通コンクリートの参考値。Fc の単位は N/mm²',
  })),
  timber: [
    ...[['スギ', 7000], ['ヒノキ', 9000], ['カラマツ', 8000], ['ヒバ', 9000],
      ['アカマツ', 8000], ['ツガ', 8000], ['エゾマツ', 7000], ['トドマツ', 7000]]
      .map(([species, E]) => ({
        name: species, data: {E},
        note: '普通構造材の基準値 · 林野庁「森林土木木製構造物設計等指針」解説 表4',
      })),
    ...[50, 70, 90, 110, 130].map(grade => ({
      name: '構造用製材 E' + grade + '（等級指定）',
      data: {E: grade * 100}, note: 'JAS 1083:2025 表14 ①（曲げヤング係数）',
    })),
  ],
  'steel-section': [
    ksSteelSection('H-200×100×5.5×8', 2667, [18100000, 181000, 82.3], [1340000, 26700, 22.4]),
    ksSteelSection('H-250×125×6×9', 3697, [39600000, 317000, 104], [2940000, 47000, 28.2]),
    ksSteelSection('H-300×150×6.5×9', 4678, [72100000, 481000, 124], [5080000, 67700, 32.9]),
  ],
  'column-section': [
    ['200×200×6', 4532, [28000000, 280000, 78.6]],
    ['200×200×9', 6598, [39200000, 392000, 77.1]],
    ['250×250×9', 8398, [79800000, 639000, 97.5]],
    ['300×300×9', 10200, [142000000, 946000, 118]],
  ].map(([size, A, axis]) => ksSteelSection('BCR295 □-' + size, A, axis, axis, ksTubeSource)),
  'wood-section': [[90, 90], [105, 105], [120, 120], [105, 150], [105, 180], [105, 240],
    [120, 180], [120, 240], [120, 300]].map(([b, h]) => ({
    name: '木材 ' + b + '×' + h, data: {b, h},
  })),
  custom: [],
};

const ksConstantItemLabels = {
  steel: '規格・登録名', rc: '設計基準強度', timber: '樹種・等級',
  'steel-section': 'サイズ（mm）', 'column-section': 'サイズ（mm）',
  'wood-section': '登録済み寸法', custom: '登録項目',
};
let ksConstantKind = 'steel';
let ksConstantItems = [];
let ksConstantDraftId = null;
let ksLastSection;

function ksIsSection(kind) {
  return kind === 'steel-section' || kind === 'column-section' || kind === 'wood-section';
}

function ksReadConstants() {
  const records = JSON.parse(localStorage.getItem(ksConstantsStorageKey) || '[]');
  if (!Array.isArray(records)) throw new Error();
  return records;
}

function ksConstantValues(kind, item, axis) {
  const {data} = item;
  if (kind === 'wood-section') {
    const [b, h] = axis === 'x' ? [data.b, data.h] : [data.h, data.b];
    return {A: b * h, I: b * h ** 3 / 12, Z: b * h ** 2 / 6, i: h / Math.sqrt(12)};
  }
  if (ksIsSection(kind)) {
    return {A: data.A, I: data['I' + axis], Z: data['Z' + axis], i: data['i' + axis]};
  }
  return kind === 'custom' ? {値: data.value} : {E: data.E};
}

function ksConstantUnit(kind, item, symbol) {
  if (kind === 'custom') return item.data.unit;
  return ksIsSection(kind) ? ksSectionFields[symbol] : ksMaterialUnit;
}

function ksComparableUnit(unit) {
  return (unit || '').replace(/\s/g, '').replace(/\^?([234])/g, (_, digit) => '²³⁴'[digit - 2]);
}

function ksConstantAssignments(kind, item, axis) {
  const state = ksSession;
  if (!item || state.page !== 'values') return [];
  const values = ksConstantValues(kind, item, axis);
  const current = state.fields[state.fieldIndex];
  const fields = ksIsSection(kind) ? [current, ...state.fields.slice(state.fieldIndex + 1)] : [current];
  const assignments = fields.flatMap(symbol => {
    const key = kind === 'custom' ? '値' : symbol;
    if (!Object.hasOwn(values, key) || Object.hasOwn(state.values, symbol)) return [];
    const expected = ksVariableInfo(state.source, symbol).unit;
    const actual = ksConstantUnit(kind, item, key);
    return ksComparableUnit(expected) === ksComparableUnit(actual) && ksValidInput(symbol, values[key])
      ? [[symbol, values[key]]] : [];
  });
  return assignments[0]?.[0] === current ? assignments : [];
}

function ksSavedConstantKind(item) {
  // v0.2.8 stored all steel sections under one kind.
  if (item.kind === 'steel-section' && /コラム|角形鋼管|BCR|BCP|STKR|□/i.test(item.name)) {
    return 'column-section';
  }
  return item.kind;
}

function ksReadLastSection() {
  try {
    return ksLastSection ?? JSON.parse(localStorage.getItem(ksLastSectionKey) || 'null');
  } catch {
    return ksLastSection;
  }
}

function ksRememberSection(kind, item, axis) {
  ksLastSection = {kind, axis, id: item.id, name: item.name};
  if (kind === 'wood-section' && !$('ks-constant-item').value) {
    ksLastSection.dimensions = {b: item.data.b, h: item.data.h};
  }
  try {
    localStorage.setItem(ksLastSectionKey, JSON.stringify(ksLastSection));
  } catch {
    // Keep the selection available in the open calculator even if storage is blocked.
  }
}

function ksCurrentConstant() {
  const item = ksConstantItems[$('ks-constant-item').value];
  if (item || ksConstantKind !== 'wood-section') return item;
  const b = Number($('ks-constant-width').value);
  const h = Number($('ks-constant-depth').value);
  const rectangle = {name: '矩形 ' + b + '×' + h, data: {b, h}};
  if (b > 0 && h > 0 && ['x', 'y'].every(axis =>
    Object.values(ksConstantValues('wood-section', rectangle, axis)).every(value => Number.isFinite(value) && value > 0))) {
    return rectangle;
  }
}

function ksConstantOption(value, name) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = name;
  return option;
}

function ksSelectConstantItem() {
  if (ksConstantKind === 'wood-section') {
    const dimensions = ksConstantItems[$('ks-constant-item').value]?.data;
    $('ks-constant-width').value = dimensions?.b ?? '';
    $('ks-constant-depth').value = dimensions?.h ?? '';
  }
  ksShowConstant();
}

function ksChooseConstantKind(kind, previous) {
  ksConstantKind = kind;
  $('ks-constant-material').value = !ksIsSection(kind) && kind !== 'custom' ? kind : '';
  $('ks-constant-shape').value = ksIsSection(kind) ? kind : '';
  $('ks-constant-custom').setAttribute('aria-pressed', String(kind === 'custom'));
  ksListConstants(previous?.id, previous);
}

function ksShowConstant() {
  const kind = ksConstantKind;
  const item = ksCurrentConstant();
  const axis = $('ks-constant-axis').value;
  const state = ksSession;
  const entering = state.page === 'values';
  const assignments = ksConstantAssignments(kind, item, axis);
  $('ks-constant-axis-label').hidden = !ksIsSection(kind);
  $('ks-constant-edit').hidden = !item || entering ||
    (kind === 'wood-section' && !$('ks-constant-item').value);
  $('ks-constant-add').hidden = entering;
  const apply = $('ks-constant-apply');
  apply.hidden = !entering;
  apply.disabled = !assignments.length;
  apply.textContent = assignments.length ? assignments.map(([symbol]) => symbol).join('・') + ' に代入' : '代入';
  const output = $('ks-constant-preview');
  if (!item) {
    output.textContent = kind === 'wood-section'
      ? '幅とせいに正の数値を入力してください。' : '登録済みの項目がありません。';
    return;
  }
  const values = Object.entries(ksConstantValues(kind, item, axis)).map(([symbol, value]) =>
    symbol + ' = ' + Number(value.toPrecision(10)) + ' ' + ksConstantUnit(kind, item, symbol));
  const reason = entering && !assignments.length ? '対象の変数・単位・入力条件を確認してください。' : '';
  output.textContent = [...values, item.note, reason].filter(Boolean).join('\n');
}

function ksListConstants(selectedId, previous) {
  const kind = ksConstantKind;
  const rectangular = kind === 'wood-section';
  const select = $('ks-constant-item');
  let readFailed = false;
  try {
    ksConstantItems = [...ksConstantPresets[kind], ...ksReadConstants().filter(item => ksSavedConstantKind(item) === kind)];
  } catch {
    readFailed = true;
    ksConstantItems = ksConstantPresets[kind];
  }
  const options = ksConstantItems.map((item, index) => ksConstantOption(String(index), item.name));
  if (rectangular) options.unshift(ksConstantOption('', '直接入力'));
  select.replaceChildren(...options);
  const index = ksConstantItems.findIndex(item => selectedId ? item.id === selectedId
    : previous && !previous.dimensions && !item.id && item.name === previous.name);
  select.value = rectangular && index < 0 ? '' : String(Math.max(0, index));
  select.disabled = !ksConstantItems.length;
  $('ks-constant-item-label').textContent = ksConstantItemLabels[kind];
  $('ks-constant-size').hidden = !rectangular;
  $('ks-constant-dimensions').hidden = !rectangular;
  ksSelectConstantItem();
  if (rectangular && previous?.dimensions) {
    $('ks-constant-width').value = previous.dimensions.b;
    $('ks-constant-depth').value = previous.dimensions.h;
    ksShowConstant();
  }
  if (readFailed) $('ks-constant-preview').textContent += '\n登録した定数を読み込めません。';
}

function ksOpenConstants() {
  const {page, source, text, fields, fieldIndex} = ksSession;
  const entering = page === 'values';
  const symbol = entering ? fields[fieldIndex] : '';
  $('ks-constant-context').hidden = !entering;
  $('ks-constant-context').textContent = entering ? ksDisplayExpression(source, text) + '　｜　入力中 ' + symbol : '';
  $('ks-constant-picker').hidden = false;
  $('ks-constant-form').hidden = true;
  const material = symbol === 'E';
  const section = Object.hasOwn(ksSectionFields, symbol);
  const previous = section ? ksReadLastSection() : null;
  $('ks-constant-material-row').hidden = entering && !material;
  $('ks-constant-shape-row').hidden = entering && !section;
  $('ks-constant-custom').hidden = entering && (material || (section && symbol !== 'A'));
  $('ks-constant-axis').value = previous?.axis === 'y' ? 'y' : 'x';
  const sectionKind = ksIsSection(previous?.kind) ? previous.kind : 'steel-section';
  ksChooseConstantKind(!entering || material ? 'steel' : section ? sectionKind : 'custom', previous);
  $('ks-constant-panel').showModal();
}

function ksApplyConstant() {
  const kind = ksConstantKind;
  const item = ksCurrentConstant();
  const axis = $('ks-constant-axis').value;
  const assignments = ksConstantAssignments(kind, item, axis);
  if (!assignments.length) return;
  for (const [symbol, value] of assignments) {
    const label = item.name + (ksIsSection(kind) && symbol !== 'A' ? '・' + axis + '軸' : '');
    ksSetValue(symbol, value, label);
  }
  if (ksIsSection(kind)) ksRememberSection(kind, item, axis);
  $('ks-constant-panel').close();
  ksNextField();
  render();
}

function ksConstantFields(kind) {
  if (kind === 'custom') return [['value', '値'], ['unit', '単位']];
  if (kind === 'wood-section') return [['b', '幅 b（mm）'], ['h', 'せい h（mm）']];
  if (!ksIsSection(kind)) return [['E', 'ヤング係数 E（N/mm²）']];
  return [['A', 'A（mm²）'], ...['x', 'y'].flatMap(axis =>
    ['I', 'Z', 'i'].map(symbol => [symbol + axis, symbol + axis + '（' + ksSectionFields[symbol] + '）']))];
}

function ksEditConstant(item, adding = false) {
  const kind = ksConstantKind;
  ksConstantDraftId = adding ? null : item?.id || null;
  $('ks-constant-name').value = item?.name || '';
  $('ks-constant-note').value = item?.note || '';
  $('ks-constant-save').textContent = item && !item.id && !adding ? '複製して保存' : '保存';
  $('ks-constant-error').textContent = '';
  $('ks-constant-fields').replaceChildren(...ksConstantFields(kind).map(([key, title]) => {
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.dataset.field = key;
    input.type = key === 'unit' ? 'text' : 'number';
    input.required = key !== 'unit';
    input.step = 'any';
    if (key === 'unit') input.maxLength = 24;
    input.value = item?.data[key] ?? '';
    label.append(input);
    return label;
  }));
  $('ks-constant-picker').hidden = true;
  $('ks-constant-form').hidden = false;
  $('ks-constant-name').focus();
}

function ksSaveConstant(event) {
  event.preventDefault();
  const kind = ksConstantKind;
  const name = $('ks-constant-name').value.trim();
  const note = $('ks-constant-note').value.trim();
  const data = {};
  for (const label of $('ks-constant-fields').children) {
    const input = label.children[0];
    const key = input.dataset.field;
    const raw = String(input.value).trim();
    if (key === 'unit') data.unit = raw;
    else if (raw && Number.isFinite(Number(raw)) && (kind === 'custom' || Number(raw) > 0)) data[key] = Number(raw);
  }
  const item = {id: ksConstantDraftId || crypto.randomUUID(), name, kind, data, note};
  const error = $('ks-constant-error');
  if (!name || ksConstantFields(kind).some(([key]) => !Object.hasOwn(data, key)) ||
      ['x', 'y'].some(axis => Object.values(ksConstantValues(kind, item, axis)).some(value => !Number.isFinite(value)))) {
    error.textContent = '名前と数値を確認してください。材料・断面には正の値を入力します。';
    return;
  }
  try {
    const records = ksReadConstants();
    const index = records.findIndex(record => record.id === item.id);
    if (index < 0) records.push(item);
    else records[index] = item;
    localStorage.setItem(ksConstantsStorageKey, JSON.stringify(records));
    $('ks-constant-form').hidden = true;
    $('ks-constant-picker').hidden = false;
    ksListConstants(item.id);
  } catch {
    error.textContent = '定数を保存できません。';
  }
}

function initializeKSConstants() {
  for (const id of ['ks-constant-material', 'ks-constant-shape']) {
    $(id).addEventListener('change', () => ksChooseConstantKind($(id).value || 'custom'));
  }
  $('ks-constant-custom').addEventListener('click', () => ksChooseConstantKind('custom'));
  $('ks-constant-item').addEventListener('change', ksSelectConstantItem);
  for (const id of ['ks-constant-width', 'ks-constant-depth']) {
    $(id).addEventListener('input', () => {
      $('ks-constant-item').value = '';
      ksShowConstant();
    });
  }
  $('ks-constant-axis').addEventListener('change', ksShowConstant);
  $('ks-constant-close').addEventListener('click', () => $('ks-constant-panel').close());
  $('ks-constant-add').addEventListener('click', () => ksEditConstant(ksConstantKind === 'wood-section' ? ksCurrentConstant() : undefined, true));
  $('ks-constant-edit').addEventListener('click', () => ksEditConstant(ksCurrentConstant()));
  $('ks-constant-apply').addEventListener('click', ksApplyConstant);
  $('ks-constant-form').addEventListener('submit', ksSaveConstant);
  $('ks-constant-cancel').addEventListener('click', () => {
    $('ks-constant-form').hidden = true;
    $('ks-constant-picker').hidden = false;
  });
}
