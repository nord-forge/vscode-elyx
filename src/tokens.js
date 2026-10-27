'use strict';

// This module intentionally accepts text snapshots only. It has no dependency on
// VS Code, disk access, or the Elyx compiler and never executes source text.
const DEFAULT_DIRECTORIES = ['design/tokens', 'elyx/tokens'];
const KINDS = new Set(['tokens', 'frame', 'boolean', 'text', 'shape', 'asset', 'icon']);
const MISSING = Symbol('missing');
const BLOCKED = Symbol('blocked');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function isStart(char) { return !!char && /[A-Za-z_-]/.test(char); }
function isBody(char) { return !!char && /[A-Za-z0-9_-]/.test(char); }
function isDigit(char) { return !!char && /[0-9]/.test(char); }

function lex(text) {
  const out = [];
  let i = 0;
  const emit = (type, start, value) => out.push({type, text: text.slice(start, i), start, end: i, value});
  while (i < text.length) {
    const start = i;
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '"') {
      i++;
      let value = '', valid = true, closed = false;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        const next = text[i++];
        if (next === '"') { closed = true; break; }
        if (next === '\\') {
          const escaped = text[i++];
          const escapes = {n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\'};
          if (Object.prototype.hasOwnProperty.call(escapes, escaped)) value += escapes[escaped];
          else valid = false;
        } else value += next;
      }
      emit(valid && closed ? 'string' : 'invalid', start, value);
      continue;
    }
    if (c === '#') {
      i++;
      while (isBody(text[i])) i++;
      const hex = text.slice(start + 1, i);
      emit(/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? 'hex' : 'invalid', start);
      continue;
    }
    if (isDigit(c) || ((c === '+' || c === '-') && isDigit(text[i + 1]))) {
      if (c === '+' || c === '-') i++;
      while (isDigit(text[i])) i++;
      if (text[i] === '.' && isDigit(text[i + 1])) {
        i++;
        while (isDigit(text[i])) i++;
      }
      const number = Number(text.slice(start, i));
      let unit = '';
      if (text[i] === '%') { unit = '%'; i++; }
      else if (isStart(text[i])) {
        const unitStart = i++;
        while (isBody(text[i])) i++;
        unit = text.slice(unitStart, i);
      }
      emit(unit ? 'length' : 'number', start, {number, unit});
      continue;
    }
    if (isStart(c)) {
      i++;
      while (isBody(text[i])) i++;
      emit('symbol', start);
      continue;
    }
    if (c === ':' && text[i + 1] === ':') { i += 2; emit('::', start); continue; }
    i++;
    emit(c, start);
  }
  out.push({type: 'eof', text: '', start: text.length, end: text.length});
  return out;
}

function parseFile(text) {
  text = String(text);
  const tokens = lex(text);
  const imports = [], groups = [], expressions = [], declarations = [];
  let cursor = 0;
  const peek = (offset = 0) => tokens[Math.min(cursor + offset, tokens.length - 1)];
  const take = () => tokens[cursor++];
  const accept = type => peek().type === type ? take() : undefined;
  const node = (type, start, end, extra = {}) => ({type, start, end, ...extra});

  function path() {
    const saved = cursor;
    const absolute = !!accept('::');
    const first = accept('symbol');
    if (!first) { cursor = saved; return undefined; }
    const parts = [first.text];
    let end = first.end;
    while (true) {
      if (peek().type === '.' && peek().start === end && peek(1).type === 'symbol' && peek(1).start === peek().end) {
        take(); const part = take(); parts.push(part.text); end = part.end;
      } else if (peek().type === '[' && peek().start === end && peek(1).type === 'number' && /^\d+$/.test(peek(1).text) && peek(2).type === ']') {
        take(); const index = take(); const close = take(); parts.push(Number(index.text)); end = close.end;
      } else break;
    }
    return node('reference', tokens[saved].start, end, {parts, absolute});
  }

  function expression() {
    let left = primary();
    if (!left) return undefined;
    // Arithmetic is represented for traversal, but deliberately not evaluated.
    while (['+', '-', '*', '/'].includes(peek().text) && peek().start > left.end) {
      const op = take();
      const right = primary();
      if (!right) return node('unsupported', left.start, op.end, {children: [left]});
      left = node('binary', left.start, right.end, {operator: op.text, children: [left, right]});
    }
    return left;
  }

  function primary() {
    const token = peek();
    if (['string', 'hex', 'number', 'length'].includes(token.type)) {
      take(); return node(token.type, token.start, token.end, {text: token.text, value: token.value});
    }
    if (accept("'")) {
      const child = expression();
      return node('quote', token.start, child ? child.end : token.end, {children: child ? [child] : []});
    }
    if (accept('.')) {
      const name = peek();
      if (name.type === 'symbol' && name.start === token.end) {
        take(); return node('atom', token.start, name.end, {text: '.' + name.text});
      }
      return node('unsupported', token.start, token.end, {children: []});
    }
    if (token.type === 'symbol' || token.type === '::') {
      const ref = path();
      if (!ref) return undefined;
      if (peek().type !== '(' || ref.absolute || ref.parts.length !== 1) return ref;
      take(); const args = [];
      while (peek().type !== ')' && peek().type !== 'eof') {
        const before = cursor;
        let name;
        if (peek().type === 'symbol' && peek(1).type === '=') { name = take().text; take(); }
        const value = expression();
        if (value) args.push({name, value});
        if (cursor === before) take();
        if (!accept(',')) break;
      }
      const close = accept(')');
      return node('call', ref.start, close ? close.end : (args.length ? args[args.length - 1].value.end : ref.end), {name: ref.parts[0], args, complete: !!close});
    }
    if (accept('(')) {
      const child = expression();
      const close = accept(')');
      return node('group', token.start, close ? close.end : (child ? child.end : token.end), {children: child ? [child] : [], complete: !!close});
    }
    if (accept('[')) {
      const children = [];
      while (peek().type !== ']' && peek().type !== 'eof') {
        const before = cursor;
        const child = expression();
        if (child) children.push(child);
        if (cursor === before) take();
        if (!accept(',')) break;
      }
      const close = accept(']');
      return node('list', token.start, close ? close.end : (children.length ? children[children.length - 1].end : token.end), {children, complete: !!close});
    }
    if (accept('{')) {
      const entries = [];
      while (peek().type !== '}' && peek().type !== 'eof') {
        const before = cursor;
        const key = expression();
        if (key && accept(':')) {
          const value = expression();
          if (value) entries.push({key, value});
        }
        if (cursor === before) take();
        if (!accept(',')) break;
      }
      const close = accept('}');
      return node('map', token.start, close ? close.end : (entries.length ? entries[entries.length - 1].value.end : token.end), {entries, complete: !!close});
    }
    return undefined;
  }

  function skipAnnotation() {
    take();
    if (peek().type === 'symbol') take();
    if (!accept('(')) return;
    let depth = 1;
    while (depth && peek().type !== 'eof') {
      const item = take();
      if (item.type === '(') depth++;
      if (item.type === ')') depth--;
    }
  }

  function block(scope, root) {
    while (peek().type !== 'eof' && peek().type !== '}') {
      const before = cursor;
      if (peek().type === '@') { skipAnnotation(); continue; }
      if (peek().type === ',') { take(); continue; }
      if (root && peek().text === 'import') {
        take(); const source = accept('string');
        if (source && peek().text === 'as') {
          take(); const alias = accept('symbol');
          if (alias) imports.push({path: source.value, alias: alias.text});
        }
      } else if (root && peek().text === 'use') {
        take(); accept('string');
      } else {
        let exported = false;
        if (peek().text === 'export' || peek().text === 'priv') exported = take().text === 'export';
        const key = path();
        if (key && accept('=')) {
          const kind = accept('symbol');
          if (kind && KINDS.has(kind.text)) {
            if (root) declarations.push({name: key.parts.join('.'), kind: kind.text});
            let source;
            if (accept(':')) source = path();
            if (accept('{')) {
              let childScope = null;
              if (kind.text === 'tokens') {
                childScope = groups.length;
                groups.push({name: key.parts.join('.'), exported, root, source, properties: []});
              }
              block(childScope, false);
              accept('}');
            }
          }
        } else if (key && accept(':')) {
          const value = expression();
          if (value) {
            expressions.push({node: value, scope, property: key.parts});
            if (scope !== null) groups[scope].properties.push({parts: key.parts, value});
          }
        } else if (key && accept('{')) {
          block(null, false); accept('}');
        }
      }
      if (cursor === before) take();
    }
  }
  block(null, true);
  return freeze({imports, groups, expressions, declarations});
}

function normalizePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined;
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/') || undefined;
}

const NAMED = Object.freeze({
  black: '000000', silver: 'c0c0c0', gray: '808080', grey: '808080', white: 'ffffff',
  maroon: '800000', red: 'ff0000', purple: '800080', fuchsia: 'ff00ff', green: '008000',
  lime: '00ff00', olive: '808000', yellow: 'ffff00', navy: '000080', blue: '0000ff',
  teal: '008080', aqua: '00ffff', orange: 'ffa500', rebeccapurple: '663399',
  pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', violet: 'ee82ee', indigo: '4b0082',
  cyan: '00ffff', magenta: 'ff00ff', transparent: '00000000'
});

function hexColor(text) {
  let hex = text.replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return undefined;
  if (hex.length <= 4) hex = [...hex].map(char => char + char).join('');
  if (hex.length === 6) hex += 'ff';
  return {red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255, alpha: parseInt(hex.slice(6, 8), 16) / 255};
}

function colorValue(color) {
  const bytes = [color.red, color.green, color.blue, color.alpha].map(value => Math.round(value * 255).toString(16).padStart(2, '0'));
  return '#' + bytes.slice(0, color.alpha === 1 ? 3 : 4).join('');
}

function createTokenIndex(files, directories = DEFAULT_DIRECTORIES) {
  const modules = new Map(), duplicates = new Set();
  for (const file of files || []) {
    const path = normalizePath(file.path);
    if (!path || typeof file.text !== 'string') continue;
    if (modules.has(path)) { duplicates.add(path); continue; }
    const parsed = parseFile(file.text);
    const module = {path, parsed, groups: []};
    module.groups = parsed.groups.map((group, index) => ({module, group, index}));
    modules.set(path, module);
  }
  for (const path of duplicates) modules.delete(path);
  const allowed = [...new Set((Array.isArray(directories) ? directories : DEFAULT_DIRECTORIES).map(normalizePath).filter(Boolean))];
  const stems = new Map();
  for (const [path, module] of modules) {
    if (!path.endsWith('.elyx') || !allowed.some(directory => path.startsWith(directory + '/'))) continue;
    const name = path.slice(path.lastIndexOf('/') + 1, -5);
    if (!stems.has(name)) stems.set(name, []);
    stems.get(name).push(module);
  }

  function sourceModule(module, source) {
    if (source.startsWith('@') || source.startsWith('/') || source.includes('\\')) return undefined;
    const directory = module.path.slice(0, module.path.lastIndexOf('/') + 1);
    const path = normalizePath(source.startsWith('./') || source.startsWith('../') ? directory + source : source);
    return path && modules.get(path);
  }

  function rootLookup(module, parts, state, imported = false) {
    if (!parts.length || typeof parts[0] !== 'string') return MISSING;
    const [name, ...rest] = parts;
    // An existing layer declaration is a lexical binding too. It cannot turn
    // into a token-file fallback merely because this resolver handles tokens.
    if (module.parsed.declarations.some(item => item.name === name && item.kind !== 'tokens')) return BLOCKED;
    const bindings = module.groups.filter(item => item.group.root && item.group.name === name && (!imported || item.group.exported));
    const aliases = module.parsed.imports.filter(item => item.alias === name);
    if (bindings.length + aliases.length > 1) return BLOCKED;
    if (bindings.length) return rest.length ? memberLookup(bindings[0], rest, state) : {kind: 'group', scope: bindings[0]};
    if (aliases.length) {
      if (imported) return BLOCKED;
      const target = sourceModule(module, aliases[0].path);
      return target ? rootLookup(target, rest, state, true) : BLOCKED;
    }
    if (imported) return MISSING;
    const fallback = stems.get(name);
    if (!fallback) return MISSING;
    if (fallback.length !== 1) return BLOCKED;
    return rootLookup(fallback[0], rest, state, true);
  }

  function sourceScope(scope, state) {
    const source = scope.group.source;
    if (!source) return MISSING;
    // Sources select declarations in the authoring file, never a member of the
    // group being declared. Their expressions still keep their original scope.
    const found = rootLookup(scope.module, source.parts, state);
    return found && found.kind === 'group' ? found.scope : found === MISSING ? MISSING : BLOCKED;
  }

  function memberLookup(scope, parts, state) {
    const key = scope.module.path + ':' + scope.index + ':' + JSON.stringify(parts);
    if (state.lookup.has(key)) return BLOCKED;
    const next = {...state, lookup: new Set(state.lookup).add(key)};
    const candidates = scope.group.properties.filter(property => property.parts.length <= parts.length && property.parts.every((part, i) => part === parts[i]));
    if (candidates.length) {
      const longest = Math.max(...candidates.map(property => property.parts.length));
      const matching = candidates.filter(property => property.parts.length === longest);
      if (matching.length !== 1) return BLOCKED;
      const property = matching[0];
      return descend({kind: 'node', module: scope.module, scope, node: property.value, definition: {path: scope.module.path, start: property.value.start, end: property.value.end}}, parts.slice(longest), next);
    }
    const source = sourceScope(scope, next);
    if (source === MISSING || source === BLOCKED) return source;
    return memberLookup(source, parts, next);
  }

  function lookup(module, scope, ref, state) {
    if (!ref.absolute && scope) {
      const member = memberLookup(scope, ref.parts, state);
      if (member !== MISSING) return member;
    }
    return rootLookup(module, ref.parts, state);
  }

  function descend(binding, rest, state) {
    if (!rest.length) return binding;
    const identity = binding.module.path + ':' + binding.node.start + ':' + binding.node.end;
    if (state.descend.has(identity)) return BLOCKED;
    const next = {...state, descend: new Set(state.descend).add(identity)};
    let current = binding;
    if (current.node.type === 'reference') {
      const target = lookup(current.module, current.scope, current.node, next);
      if (!target || target === MISSING || target === BLOCKED || target.kind !== 'node') return BLOCKED;
      return descend(target, rest, next);
    }
    if (current.node.type === 'group' && current.node.complete && current.node.children.length === 1) return descend({...current, node: current.node.children[0]}, rest, next);
    const [part, ...tail] = rest;
    if (current.node.type === 'list' && typeof part === 'number' && current.node.complete && current.node.children[part]) {
      current = {...current, node: current.node.children[part]};
    } else if (current.node.type === 'map' && current.node.complete) {
      const matches = current.node.entries.filter(entry => mapKey(entry.key) === String(part));
      if (matches.length !== 1) return BLOCKED;
      current = {...current, node: matches[0].value};
    } else return BLOCKED;
    current.definition = {path: current.module.path, start: current.node.start, end: current.node.end};
    return descend(current, tail, next);
  }

  function evaluate(binding, state) {
    if (!binding || binding === MISSING || binding === BLOCKED || binding.kind !== 'node') return undefined;
    const identity = binding.module.path + ':' + binding.node.start + ':' + binding.node.end;
    if (state.evaluate.has(identity)) return undefined;
    const next = {...state, evaluate: new Set(state.evaluate).add(identity)};
    const result = evaluateNode(binding.node, binding.module, binding.scope, next);
    return result ? {...result, definition: binding.definition} : undefined;
  }

  function evaluateNode(node, module, scope, state) {
    if (node.type === 'reference') return evaluate(lookup(module, scope, node, state), state);
    if (node.type === 'hex') return {value: node.text, color: hexColor(node.text)};
    if (node.type === 'number' || node.type === 'length') return {value: node.text, numeric: node.value};
    if (node.type === 'string') return {value: JSON.stringify(node.value)};
    if (node.type === 'atom') {
      const name = node.text.slice(1);
      const hex = Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : undefined;
      return {value: node.text, ...(hex ? {color: hexColor(hex)} : {})};
    }
    if (node.type === 'group' && node.complete && node.children.length === 1) return evaluateNode(node.children[0], module, scope, state);
    if ((node.type === 'list' || node.type === 'map') && node.complete) {
      if (node.type === 'list') {
        const values = node.children.map(child => evaluateNode(child, module, scope, state));
        return values.every(Boolean) ? {value: '[' + values.map(value => value.value).join(', ') + ']'} : undefined;
      }
      const entries = node.entries.map(entry => {
        const key = mapKey(entry.key);
        const value = evaluateNode(entry.value, module, scope, state);
        return key !== undefined && value ? key + ': ' + value.value : undefined;
      });
      return entries.every(entry => entry !== undefined) ? {value: '{' + entries.join(', ') + '}'} : undefined;
    }
    if (node.type === 'call' && node.complete && node.args.every(arg => arg.name === undefined)) {
      const args = node.args.map(arg => evaluateNode(arg.value, module, scope, state));
      if (!args.every(Boolean)) return undefined;
      const color = functionColor(node.name, args);
      return color ? {value: colorValue(color), color} : undefined;
    }
    return undefined;
  }

  const initialState = () => ({lookup: new Set(), descend: new Set(), evaluate: new Set()});
  const publicResult = value => value ? freeze({value: value.value, ...(value.color ? {color: {...value.color}} : {}), ...(value.definition ? {definition: {...value.definition}} : {})}) : undefined;

  function resolve(documentPath, reference) {
    const module = modules.get(normalizePath(documentPath));
    if (!module || typeof reference !== 'string') return undefined;
    // Reuse the parser's expression lexer, but only accept one complete path.
    const prefix = 'x = tokens {value: ';
    const parsed = parseFile(prefix + reference + '}');
    const expr = parsed.groups[0] && parsed.groups[0].properties[0];
    const ref = expr && expr.value;
    if (!ref || ref.type !== 'reference' || ref.start !== prefix.length || ref.end !== prefix.length + reference.length) return undefined;
    return publicResult(evaluate(lookup(module, null, ref, initialState()), initialState()));
  }

  function scan(documentPath) {
    const module = modules.get(normalizePath(documentPath));
    if (!module) return [];
    const output = [];
    function visit(node, scope) {
      // A quoted expression is source data, not an evaluated token reference.
      if (node.type === 'quote') return;
      if (node.type === 'reference' || node.type === 'hex' || node.type === 'atom' || node.type === 'call') {
        const value = publicResult(evaluateNode(node, module, scope, initialState()));
        if (value && (node.type === 'reference' || value.color)) {
          output.push(freeze({start: node.start, end: node.end, reference: sourceText(module, node), ...value}));
          return;
        }
      }
      if (node.type === 'map') {
        for (const entry of node.entries) visit(entry.value, scope);
      } else if (node.type === 'call') {
        for (const arg of node.args) visit(arg.value, scope);
      } else if (node.children) for (const child of node.children) visit(child, scope);
    }
    for (const expr of module.parsed.expressions) visit(expr.node, expr.scope === null ? null : module.groups[expr.scope]);
    return Object.freeze(output.sort((a, b) => a.start - b.start || a.end - b.end));
  }

  // Text is retained separately from the public AST, including unsaved snapshots.
  const texts = new Map();
  for (const file of files || []) if (typeof file.text === 'string') texts.set(normalizePath(file.path), file.text);
  function sourceText(module, node) { return texts.get(module.path).slice(node.start, node.end); }
  return Object.freeze({resolve, scan});
}

function mapKey(node) {
  if (node.type === 'string') return node.value;
  if (node.type === 'reference' && !node.absolute && node.parts.length === 1) return String(node.parts[0]);
  if (node.type === 'number') return node.text;
  if (node.type === 'atom') return node.text;
  return undefined;
}

function functionColor(name, args) {
  const numeric = arg => arg && arg.numeric;
  const bounded = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const fraction = (arg, opacity = false) => {
    const n = numeric(arg);
    if (!n || (n.unit !== '' && n.unit !== '%')) return undefined;
    const value = n.unit === '%' || (opacity && n.number > 1) ? n.number / 100 : n.number;
    return bounded(value) ? value : undefined;
  };
  if (name === 'opacity' && args.length === 2 && args[0].color) {
    const alpha = fraction(args[1], true);
    return alpha === undefined ? undefined : {...args[0].color, alpha};
  }
  if ((name === 'rgb' || name === 'rgba') && (args.length === 3 || args.length === 4)) {
    const channels = args.slice(0, 3).map(arg => {
      const n = numeric(arg);
      if (!n || n.unit !== (name === 'rgb' ? '%' : '')) return undefined;
      const value = n.number / (name === 'rgb' ? 100 : 255);
      return bounded(value) ? value : undefined;
    });
    const alpha = args.length === 4 ? fraction(args[3]) : 1;
    if (channels.some(value => value === undefined) || alpha === undefined) return undefined;
    return {red: channels[0], green: channels[1], blue: channels[2], alpha};
  }
  if (name === 'hsl' && (args.length === 3 || args.length === 4)) {
    const hue = numeric(args[0]), saturation = numeric(args[1]), lightness = numeric(args[2]);
    const alpha = args.length === 4 ? fraction(args[3]) : 1;
    if (!hue || !Number.isFinite(hue.number) || !['', 'deg'].includes(hue.unit) || !saturation || saturation.unit !== '%' || !lightness || lightness.unit !== '%' || alpha === undefined) return undefined;
    const s = saturation.number / 100, l = lightness.number / 100;
    if (!bounded(s) || !bounded(l)) return undefined;
    const h = ((hue.number % 360) + 360) % 360 / 60;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const x = chroma * (1 - Math.abs(h % 2 - 1));
    const channels = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const m = l - chroma / 2;
    return {red: channels[0] + m, green: channels[1] + m, blue: channels[2] + m, alpha};
  }
  return undefined;
}

module.exports = {parseFile, createTokenIndex};
