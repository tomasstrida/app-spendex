'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('./email');

test('escapeHtml escapuje nebezpečné znaky', () => {
  assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});
