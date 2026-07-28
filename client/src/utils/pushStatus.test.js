import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePushState } from './pushStatus.js';

test('nepodporovaný prohlížeč', () => {
  assert.equal(resolvePushState({ supported: false }), 'unsupported');
});

test('zamítnuté povolení přebíjí vše ostatní', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'denied', localEndpoint: 'https://x/ep1', serverEndpoints: ['https://x/ep1'],
  }), 'denied');
});

test('bez lokálního odběru → vypnuto', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'default', localEndpoint: null, serverEndpoints: [],
  }), 'off');
});

test('lokální odběr, který server nezná → rozpojeno', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'granted', localEndpoint: 'https://x/novy', serverEndpoints: ['https://x/duch'],
  }), 'desync');
});

test('lokální odběr známý serveru → zapnuto', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'granted', localEndpoint: 'https://x/ep1', serverEndpoints: ['https://x/jiny', 'https://x/ep1'],
  }), 'on');
});

test('server nedostupný (serverEndpoints null) → nehádá, hlásí zapnuto podle prohlížeče', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'granted', localEndpoint: 'https://x/ep1', serverEndpoints: null,
  }), 'on');
});

test('jiné zařízení u serveru, tohle bez odběru → vypnuto (ne rozpojeno)', () => {
  assert.equal(resolvePushState({
    supported: true, permission: 'granted', localEndpoint: null, serverEndpoints: ['https://x/jineZarizeni'],
  }), 'off');
});
