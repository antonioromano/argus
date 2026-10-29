/**
 * argus/no-raw-style-scale — keep spacing, type and radius on the locked scales
 * (tokens/tokens.css, plan 005).
 *
 * Reports a raw length on a scale property (gap, padding*, margin*, fontSize,
 * borderRadius*) inside a *style object*:
 *   - the expression of a JSX `style={…}` attribute (through ?:, &&, ||, as);
 *   - an object typed `CSSProperties` / `React.CSSProperties` — annotation,
 *     `as`, `satisfies`, a function's return type, or `Record<K, CSSProperties>`.
 * "Raw" = a non-zero number, or a string / template text holding a non-zero `Npx`.
 * Allowed: 0, `var(--…)`, `calc(… var(--…) …)`, and anything computed
 * (identifiers, calls such as `scaledPx(n)`, `${x}px`). Width/height are
 * geometry and out of scope. `fontSize: 16` is allowed under `app/mobile/` —
 * it stops iOS zooming into a focused input.
 *
 * Option `bannedTokens: string[]` additionally rejects deprecated token names
 * (e.g. `--t-base`) anywhere in a style object's string values.
 *
 * Escape hatch: `// eslint-disable-next-line argus/no-raw-style-scale -- <reason>`.
 */

const SPACING_PROPS = new Set([
  'gap', 'rowGap', 'columnGap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'paddingInline', 'paddingInlineStart', 'paddingInlineEnd',
  'paddingBlock', 'paddingBlockStart', 'paddingBlockEnd',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'marginInline', 'marginInlineStart', 'marginInlineEnd',
  'marginBlock', 'marginBlockStart', 'marginBlockEnd',
]);
const RADIUS_PROPS = new Set([
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderStartStartRadius', 'borderStartEndRadius', 'borderEndStartRadius', 'borderEndEndRadius',
]);
const GAP_PROPS = new Set(['gap', 'rowGap', 'columnGap']);

/** px → spacing token. Odd values round up, except 9 (plan 005 mapping table). */
const SPACE_TABLE = {
  1: 'px', 2: '0-5', 3: '1', 4: '1', 5: '1-5', 6: '1-5', 7: '2', 8: '2', 9: '2',
  10: '3', 11: '3', 12: '3', 13: '3', 14: '4', 15: '4',
};
const SPACE_STEPS = [[16, '4'], [20, '5'], [24, '6'], [32, '7'], [40, '8'], [56, '9'], [72, '10']];

function nearestStep(px, steps) {
  let best = steps[0];
  for (const s of steps) if (Math.abs(s[0] - px) < Math.abs(best[0] - px)) best = s;
  return best[1];
}

function spaceSuffix(px) {
  const n = Math.round(Math.abs(px));
  if (n === 0) return '1';
  return SPACE_TABLE[n] ?? nearestStep(n, SPACE_STEPS);
}

function radiusToken(px) {
  if (px >= 99) return '--r-pill';
  if (px <= 2) return '--r-1';
  if (px <= 4) return '--r-2';
  if (px <= 8) return '--r-3';
  return '--r-4';
}

function typeRole(px) {
  if (px <= 10) return 'eyebrow';
  if (px <= 11) return 'caption';
  if (px <= 12) return 'small';
  if (px <= 14) return 'body';
  if (px <= 17) return 'title';
  return 'display';
}

/** CSS for one raw px value on `prop`. */
function tokenFor(prop, px) {
  if (prop === 'fontSize') return `var(--t-${typeRole(px)})`;
  if (RADIUS_PROPS.has(prop)) return `var(${radiusToken(px)})`;
  const v = `var(--s-${spaceSuffix(px)})`;
  return px < 0 ? `calc(-1 * ${v})` : v;
}

/** Extra hint pointing at the primitive that takes this value as a prop. */
function primitiveHint(prop, px) {
  if (px < 0) return '';
  if (prop === 'fontSize') return ` or <Text size="${typeRole(px)}">`;
  if (GAP_PROPS.has(prop)) {
    const suffix = spaceSuffix(px);
    if (suffix === 'px') return ' or <Row gap="px">';
    const step = suffix.replace('-', '.');
    if (Number(step) <= 7) return ` or <Row gap={${step}}>`;
  }
  return '';
}

const PX_RE = /(-?\d*\.?\d+)px\b/g;

/** Non-zero `Npx` lengths in a string. */
function rawPx(text) {
  return [...text.matchAll(PX_RE)].filter((m) => Number(m[1]) !== 0);
}

function isCssType(t) {
  if (!t || t.type !== 'TSTypeReference') return false;
  const n = t.typeName;
  return (n.type === 'Identifier' && n.name === 'CSSProperties')
    || (n.type === 'TSQualifiedName' && n.right.name === 'CSSProperties');
}

function isCssRecord(t) {
  if (!t || t.type !== 'TSTypeReference' || t.typeName.type !== 'Identifier' || t.typeName.name !== 'Record') return false;
  const args = (t.typeArguments ?? t.typeParameters)?.params;
  return Boolean(args && args.length === 2 && isCssType(args[1]));
}

function propName(p) {
  if (p.type !== 'Property' || p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return null;
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow raw spacing, type and radius lengths in style objects — use the locked scale tokens',
    },
    schema: [
      {
        type: 'object',
        properties: { bannedTokens: { type: 'array', items: { type: 'string', pattern: '^--' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      rawScale: '{{prop}}: {{raw}} is off the locked scale — use {{fix}}',
      bannedToken: '{{prop}}: {{token}} is deprecated — use the role token instead (tokens.css)',
    },
  },

  create(context) {
    const banned = context.options[0]?.bannedTokens ?? [];
    const bannedRes = banned.map((t) => [t, new RegExp(`var\\(\\s*${t.replace(/[-]/g, '\\-')}\\s*[,)]`)]);
    const filename = (context.filename ?? context.getFilename()).replace(/\\/g, '/');
    const isMobile = /(^|\/)app\/mobile\//.test(filename);
    const checked = new WeakSet();

    function report(node, prop, raw, fix) {
      context.report({ node, messageId: 'rawScale', data: { prop, raw, fix } });
    }

    function exempt(prop, px) {
      return isMobile && prop === 'fontSize' && px === 16;
    }

    function checkString(node, prop, text, quote) {
      if (/^\s*calc\(/.test(text) && text.includes('var(--')) return;
      const hits = rawPx(text).filter((m) => !exempt(prop, Number(m[1])));
      if (hits.length === 0) return;
      const fixed = text.replace(PX_RE, (whole, n) => (Number(n) === 0 || exempt(prop, Number(n)) ? whole : tokenFor(prop, Number(n))));
      if (quote) {
        const only = hits.length === 1 && text.trim() === hits[0][0];
        report(node, prop, `'${text}'`, `'${fixed}'${only ? primitiveHint(prop, Number(hits[0][1])) : ''}`);
      } else {
        const fixes = hits.map((m) => `${m[0]} → '${tokenFor(prop, Number(m[1]))}'`).join(', ');
        report(node, prop, `\`${text}\``, fixes);
      }
    }

    function checkValue(node, prop) {
      switch (node.type) {
        case 'Literal':
          if (typeof node.value === 'number') {
            if (node.value !== 0 && !exempt(prop, node.value)) {
              report(node, prop, String(node.value), `'${tokenFor(prop, node.value)}'${primitiveHint(prop, node.value)}`);
            }
          } else if (typeof node.value === 'string') {
            checkString(node, prop, node.value, true);
          }
          return;
        case 'UnaryExpression':
          if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number' && node.argument.value !== 0) {
            const px = -node.argument.value;
            report(node, prop, String(px), `'${tokenFor(prop, px)}'`);
          }
          return;
        case 'TemplateLiteral': {
          const text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('${…}');
          if (node.expressions.length === 0) checkString(node, prop, text, true);
          else checkString(node, prop, text, false);
          return;
        }
        case 'ConditionalExpression':
          checkValue(node.consequent, prop);
          checkValue(node.alternate, prop);
          return;
        case 'LogicalExpression':
          checkValue(node.right, prop);
          return;
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
          checkValue(node.expression, prop);
          return;
        default:
          // Identifiers, calls (scaledPx), member access — computed, allowed.
      }
    }

    function checkBanned(node, prop) {
      let text = null;
      if (node.type === 'Literal' && typeof node.value === 'string') text = node.value;
      else if (node.type === 'TemplateLiteral') text = node.quasis.map((q) => q.value.raw).join(' ');
      else if (node.type === 'ConditionalExpression') { checkBanned(node.consequent, prop); checkBanned(node.alternate, prop); return; }
      if (text === null) return;
      for (const [token, re] of bannedRes) {
        if (re.test(text)) context.report({ node, messageId: 'bannedToken', data: { prop, token } });
      }
    }

    function checkObject(obj) {
      if (checked.has(obj)) return;
      checked.add(obj);
      for (const p of obj.properties) {
        const prop = propName(p);
        if (!prop) continue;
        if (SPACING_PROPS.has(prop) || RADIUS_PROPS.has(prop) || prop === 'fontSize') checkValue(p.value, prop);
        if (bannedRes.length) checkBanned(p.value, prop);
      }
    }

    /** Find the style object(s) an expression evaluates to. */
    function visitStyle(node) {
      if (!node) return;
      switch (node.type) {
        case 'ObjectExpression': checkObject(node); return;
        case 'ConditionalExpression': visitStyle(node.consequent); visitStyle(node.alternate); return;
        case 'LogicalExpression': visitStyle(node.left); visitStyle(node.right); return;
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
        case 'TSNonNullExpression': visitStyle(node.expression); return;
        default:
      }
    }

    function visitTyped(typeNode, valueNode) {
      if (isCssType(typeNode)) visitStyle(valueNode);
      else if (isCssRecord(typeNode) && valueNode?.type === 'ObjectExpression') {
        for (const p of valueNode.properties) if (p.type === 'Property') visitStyle(p.value);
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'style' && node.value?.type === 'JSXExpressionContainer') {
          visitStyle(node.value.expression);
        }
      },
      VariableDeclarator(node) {
        visitTyped(node.id.typeAnnotation?.typeAnnotation, node.init);
      },
      'TSAsExpression, TSSatisfiesExpression'(node) {
        visitTyped(node.typeAnnotation, node.expression);
      },
      ArrowFunctionExpression(node) {
        if (node.body.type !== 'BlockStatement') visitTyped(node.returnType?.typeAnnotation, node.body);
      },
      ReturnStatement(node) {
        const ancestors = context.sourceCode.getAncestors(node);
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_TYPES.has(ancestors[i].type)) {
            visitTyped(ancestors[i].returnType?.typeAnnotation, node.argument);
            return;
          }
        }
      },
    };
  },
};

export default rule;
