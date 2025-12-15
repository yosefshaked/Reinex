/* eslint-env node */
import assert from 'assert';
import validateIsraeliPhone from '../src/components/ui/helpers/phone.js';
import { swapLayout } from '../src/lib/layoutSwap.js';
import { sidebarMenuButtonVariants } from '../src/components/ui/helpers/sidebarVariants.js';

function testValidateIsraeliPhone() {
  // valid numbers
  assert.strictEqual(validateIsraeliPhone('052-1234567'), true, 'valid local with dash');
  assert.strictEqual(validateIsraeliPhone('+972-52-1234567'), true, 'valid international');
  // invalid numbers
  assert.strictEqual(validateIsraeliPhone('123'), false, 'too short');
  assert.strictEqual(validateIsraeliPhone(''), true, 'empty is allowed by validator');
}

function testSwapLayout() {
  // 'q' in EN maps to '/' in HE layout (per layoutSwap mapping)
  assert.strictEqual(swapLayout('q', 'he'), '/', 'EN q -> HE /');
  // mapping back
  assert.strictEqual(swapLayout('/', 'en'), 'q', 'HE / -> EN q');
}

function testSidebarVariants() {
  const cls = sidebarMenuButtonVariants({ variant: 'default', size: 'default' });
  assert.ok(typeof cls === 'string' && cls.length > 0, 'sidebarMenuButtonVariants returns classes');
}

async function run() {
  console.log('Running quick workspace tests...');
  testValidateIsraeliPhone();
  testSwapLayout();
  testSidebarVariants();
  console.log('All tests passed.');
}

run().catch((err) => {
  console.error('Tests failed:', err);
  // Re-throw to produce a non-zero exit code in environments without a test runner
  throw err;
});
