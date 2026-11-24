'use strict';
const fail = message => { throw Object.assign(new Error(message), {status:422}); };
const numeric = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g;
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const norm = s => s.normalize('NFC').replace(/\s+/gu,' ').trim();
const skeleton = s => norm(s).replace(numeric,'#');
function numberAt(text, index, unit) {
  const match = [...text.matchAll(numeric)][index];
  if (!match) fail('所选数字已不存在，请人工核对。');
  const suffix = text.slice(match.index + match[0].length).trimStart();
  const actual = suffix.match(/^[\p{L}µμ°%‰²³⁻¹·/]+/u)?.[0] || '';
  // A CJK sentence may follow an SI unit without a space.
  if (unit && actual !== unit && !(actual.startsWith(unit) && /^\p{Script=Han}/u.test(actual.slice(unit.length)))) {
    fail('原文单位已改变或无法确认，请人工核对。');
  }
  if (!Number.isFinite(Number(match[0]))) fail('原文数字无效。');
  return Number(match[0]);
}

function tokensFor(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 500) fail('请输入简短的算式。');
  return expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g);
}
function calculate(expression, values) {
  const tokens = tokensFor(expression);
  let i = 0;
  function atom() {
    const token = tokens[i++];
    if (token === '(') {
      const n = sum();
      if (tokens[i++] !== ')') fail('算式缺少右括号。');
      return n;
    }
    if (token === 'pi' || token === 'π') return Math.PI;
    if (Object.hasOwn(values,token)) return values[token];
    if (!token || !/^(?:\d|\.)/.test(token) || !Number.isFinite(Number(token))) fail('未知的变量或运算符：' + (token || '…'));
    return Number(token);
  }
  function power() {
    const n=atom();
    if (tokens[i] !== '^') return n;
    i++; return n ** unary();
  }
  function unary() {
    if (tokens[i] === '-') { i++; return -unary(); }
    if (tokens[i] === '+') { i++; return unary(); }
    return power();
  }
  function product() {
    let n=unary();
    while (tokens[i] === '*' || tokens[i] === '/') { const op=tokens[i++], r=unary(); n=op==='*'?n*r:n/r; }
    return n;
  }
  function sum() {
    let n=product();
    while (tokens[i] === '+' || tokens[i] === '-') { const op=tokens[i++], r=product(); n=op==='+'?n+r:n-r; }
    return n;
  }
  const n=sum();
  if (i !== tokens.length || !Number.isFinite(n)) fail('算式无效或结果不是有限数值。');
  return n;
}

// RFC-style double-quoted comma fields, including CRLF and doubled quotes.
function csvNumber(source, column, row) {
  if (!Number.isSafeInteger(row) || row < 1 || typeof column !== 'string' || !column) fail('请指定 CSV 表头和数据行（从 1 开始）。');
  const text=source.replace(/^\uFEFF/,'');
  let fields=[], value='', quoted=false, closed=false, header, line=0;
  for (let i=0;i<=text.length;i++) {
    const c=text[i];
    if (quoted) {
      if (c===undefined) fail('CSV 引号不完整。');
      if (c==='"') { if (text[i+1]==='"') { value+='"'; i++; } else { quoted=false; closed=true; } }
      else value+=c;
    } else if (c===',' || c==='\r' || c==='\n' || c===undefined) {
      fields.push(value); value=''; closed=false;
      if (c===',') continue;
      if (c==='\r' && text[i+1]==='\n') i++;
      if (!header) header=fields;
      else if (++line===row) {
        const at=header.indexOf(column);
        if (at<0 || header.lastIndexOf(column)!==at) fail('CSV 列不存在或同名。');
        const raw=fields[at]?.trim();
        if (!raw || fields.length!==header.length || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) fail('所选 CSV 单元格不是有限数值。');
        return Number(raw);
      }
      fields=[];
    } else if (c==='"' && !value && !closed) quoted=true;
    else if (closed || c==='"') fail('CSV 字段格式不正确。');
    else value+=c;
  }
  fail('CSV 缺少所选数据行。');
}

function variable(name, values) {
  if (typeof name !== 'string' || !identifier.test(name) || name==='pi' || Object.hasOwn(values,name)) fail('变量名无效或重复。');
}
function results(spec, text) {
  if (!spec) return [];
  const env=Object.create(null);
  variable(spec.parameter,env);
  env[spec.parameter]=numberAt(text,spec.numberIndex,spec.unit);
  for (const input of spec.inputs) {
    variable(input.name,env);
    if (!Number.isFinite(input.value)) fail('输入值无效。');
    env[input.name]=input.value;
  }
  const steps=new Map();
  for (const step of spec.steps) {
    variable(step.name,env);
    if (steps.has(step.name)) fail('计算步骤的名称重复。');
    steps.set(step.name,step);
  }
  const waiting=new Map(), dependents=new Map(), ready=[];
  for (const step of steps.values()) {
    const dependencies=new Set(tokensFor(step.formula).filter(name=>steps.has(name)));
    waiting.set(step.name,dependencies.size);
    if (!dependencies.size) ready.push(step.name);
    for (const name of dependencies) {
      if (!dependents.has(name)) dependents.set(name,[]);
      dependents.get(name).push(step.name);
    }
  }
  // A result may refer to another formula entered later in the editor.
  for (let i=0;i<ready.length;i++) {
    const name=ready[i];
    env[name]=calculate(steps.get(name).formula,env);
    for (const dependent of dependents.get(name) || []) {
      const remaining=waiting.get(dependent)-1;
      waiting.set(dependent,remaining);
      if (!remaining) ready.push(dependent);
    }
  }
  if (ready.length!==steps.size) fail('计算步骤互相依赖，请解除循环后再试算。');
  return spec.steps.map(({name,unit})=>({name,unit,value:env[name]}));
}

function locate(before, after, source, selected) {
  const pos=before.findIndex(p=>p.id===source);
  if (pos<0) fail('旧版原文未找到。');
  const old=before[pos], same=norm(old.text), shape=skeleton(old.text);
  const exact=after.filter(p=>norm(p.text)===same);
  const similar = after.filter(p=>skeleton(p.text)===shape && norm(p.text)!==same);
  const previous=pos>0 && norm(before[pos-1].text), following=before[pos+1] && norm(before[pos+1].text);
  const contextual = after.filter((p,i)=>previous && i>0 && norm(after[i-1].text)===previous || following && i+1<after.length && norm(after[i+1].text)===following);
  const candidates=[...new Set([...exact,...similar,...contextual])];
  let next;
  if (selected) {
    next=after.find(p=>p.id===selected);
    if (!next) fail('所选新版段落不存在。');
  } else {
    const priorDuplicates=before.filter(p=>norm(p.text)===same).length>1;
    if (!priorDuplicates && exact.length===1 && !similar.length) next=exact[0];
    else if (!priorDuplicates && !exact.length && similar.length===1 && shape.replace(/[#\s\p{P}]/gu,'').length>=3) next=similar[0];
  }
  if (!next) return {status:candidates.length?'ambiguous':'missing',old,new:null,candidates,results:[]};
  return {status:norm(next.text)!==same?'changed':old.id===next.id?'unchanged':'moved',old,new:next,candidates:[],results:[]};
}
module.exports={calculate,csvNumber,numberAt,results,locate,skeleton,fail};
