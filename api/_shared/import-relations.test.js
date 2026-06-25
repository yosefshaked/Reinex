/* eslint-env node */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateLinkKeys, buildRelationGroups } from './import-relations.js';

function makeCustomer(id, identity, extra = {}) {
  return {
    id,
    entity_type: 'customer',
    candidate_data: { identity_number: identity, ...extra },
  };
}

function makeGuardian(id, phone, email, extra = {}) {
  return {
    id,
    entity_type: 'guardian',
    candidate_data: { guardian_first_name: 'הורה', guardian_last_name: 'טסט', guardian_phone: phone, guardian_email: email, ...extra },
  };
}

function makeGuardianLink(id, identity, phone, email, extra = {}) {
  return {
    id,
    entity_type: 'guardian_link',
    candidate_data: { identity_number: identity, guardian_phone: phone, guardian_email: email, ...extra },
  };
}

function withJoin(candidate, joinValues) {
  return {
    ...candidate,
    candidate_data: {
      ...candidate.candidate_data,
      __import: { join: { values: joinValues } },
    },
  };
}

// ── candidateLinkKeys ────────────────────────────────────────────────────────

test('candidateLinkKeys: customer yields identity and join keys', () => {
  const c = withJoin(makeCustomer('c1', '123456789'), { src: 'כיתה א' });
  const keys = candidateLinkKeys(c);
  assert.ok(keys.some((k) => k.startsWith('id:')), 'should have identity key');
  assert.ok(keys.some((k) => k.startsWith('join:')), 'should have join key');
});

test('candidateLinkKeys: guardian yields phone and email keys', () => {
  const g = makeGuardian('g1', '054-1234567', 'test@example.com');
  const keys = candidateLinkKeys(g);
  assert.ok(keys.some((k) => k.startsWith('phone:')), 'should have phone key');
  assert.ok(keys.some((k) => k.startsWith('email:')), 'should have email key');
});

test('candidateLinkKeys: sentinel/empty values are dropped', () => {
  const g = makeGuardian('g1', '', 'missing_guardian');
  const keys = candidateLinkKeys(g);
  assert.equal(keys.length, 0);
});

test('candidateLinkKeys: service entities yield no keys', () => {
  const s = { id: 's1', entity_type: 'service', candidate_data: { service_name: 'ריקוד' } };
  assert.deepEqual(candidateLinkKeys(s), []);
});

// ── buildRelationGroups ──────────────────────────────────────────────────────

test('buildRelationGroups: sibling students grouped via shared parent phone', () => {
  const customer1 = makeCustomer('c1', '100000001');
  const customer2 = makeCustomer('c2', '100000002');
  const link1 = makeGuardianLink('l1', '100000001', '0541234567', null);
  const link2 = makeGuardianLink('l2', '100000002', '0541234567', null);
  const guardian = makeGuardian('g1', '0541234567', null);

  const { groupIdByCandidateId, groups } = buildRelationGroups([customer1, customer2, link1, link2, guardian]);

  // All five should be in the same group
  const groupIds = new Set([...groupIdByCandidateId.values()]);
  assert.equal(groupIds.size, 1, 'all in one group');
  const [groupId] = groupIds;
  const group = groups.get(groupId);
  assert.equal(group.memberIds.length, 5);
});

test('buildRelationGroups: phone-format differences still group (054-xxx vs 054xxx)', () => {
  // link has "054-1234567", guardian has "0541234567" — both must canonicalize to the same key
  const link = makeGuardianLink('l1', '100000001', '054-1234567', null);
  const guardian = makeGuardian('g1', '0541234567', null);
  const customer = makeCustomer('c1', '100000001');

  const { groupIdByCandidateId } = buildRelationGroups([customer, link, guardian]);
  const ids = [...groupIdByCandidateId.values()];
  assert.equal(new Set(ids).size, 1, 'all in one group despite phone format difference');
});

test('buildRelationGroups: unrelated families stay separate', () => {
  const customer1 = makeCustomer('c1', '100000001');
  const link1 = makeGuardianLink('l1', '100000001', '0541111111', null);
  const guardian1 = makeGuardian('g1', '0541111111', null);

  const customer2 = makeCustomer('c2', '200000002');
  const link2 = makeGuardianLink('l2', '200000002', '0542222222', null);
  const guardian2 = makeGuardian('g2', '0542222222', null);

  const { groupIdByCandidateId, groups } = buildRelationGroups([customer1, link1, guardian1, customer2, link2, guardian2]);
  assert.equal(groups.size, 2, 'two separate families');
  const gid1 = groupIdByCandidateId.get('c1');
  const gid2 = groupIdByCandidateId.get('c2');
  assert.notEqual(gid1, gid2);
  assert.equal(groupIdByCandidateId.get('l1'), gid1);
  assert.equal(groupIdByCandidateId.get('g1'), gid1);
  assert.equal(groupIdByCandidateId.get('l2'), gid2);
  assert.equal(groupIdByCandidateId.get('g2'), gid2);
});

test('buildRelationGroups: join-value grouping links customer and guardian', () => {
  const customer = withJoin(makeCustomer('c1', '100000001'), { src1: 'כיתה א' });
  const guardian = withJoin(makeGuardian('g1', null, null), { src1: 'כיתה א' });

  const { groupIdByCandidateId, groups } = buildRelationGroups([customer, guardian]);
  assert.equal(groups.size, 1);
  assert.equal(groupIdByCandidateId.get('c1'), groupIdByCandidateId.get('g1'));
});

test('buildRelationGroups: service entities are excluded from grouping', () => {
  const customer = makeCustomer('c1', '100000001');
  const service = { id: 's1', entity_type: 'service', candidate_data: { service_name: 'ריקוד' } };

  const { groupIdByCandidateId, groups } = buildRelationGroups([customer, service]);
  // Service is excluded, so only customer is in a group
  assert.equal(groups.size, 1);
  assert.ok(groupIdByCandidateId.has('c1'));
  assert.ok(!groupIdByCandidateId.has('s1'));
});

test('buildRelationGroups: stable group id is smallest candidate id', () => {
  const c1 = makeCustomer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '100000001');
  const l1 = makeGuardianLink('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '100000001', '0541234567', null);
  const g1 = makeGuardian('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '0541234567', null);

  const { groupIdByCandidateId } = buildRelationGroups([c1, l1, g1]);
  const groupId = groupIdByCandidateId.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  // All three IDs' lexicographic min is the 'a...' one
  assert.equal(groupId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
