// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = '2026-09-29';
const g = (over) => Object.assign({ id: 'x', title: '상품', brand: '', expiresOn: TODAY, used: false, reservedBy: null }, over || {});

console.log('날짜');
test('날짜 형식 여러 가지 → YYYY-MM-DD, 없는 날은 null', () => {
  assert.equal(L.normDate('2026.10.5'), '2026-10-05');
  assert.equal(L.normDate('2026/10/05'), '2026-10-05');
  assert.equal(L.normDate('20261005'), '2026-10-05');
  assert.equal(L.normDate('2026년 10월 5일'), '2026-10-05');
  assert.equal(L.normDate('2026-02-30'), null);
  assert.equal(L.normDate('내일'), null);
});
test('남은 날 — 월·해 경계, 음수(지남)', () => {
  assert.equal(L.daysLeft('2026-10-01', '2026-09-29'), 2);
  assert.equal(L.daysLeft('2027-01-01', '2026-12-31'), 1);
  assert.equal(L.daysLeft('2026-09-26', '2026-09-29'), -3);
  assert.equal(L.addDays('2026-09-29', 3), '2026-10-02');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
});

console.log('상태 · D-day');
test('유효기간 당일은 아직 사용 가능(D-DAY), 다음 날부터 만료', () => {
  assert.equal(L.statusOf(g({ expiresOn: TODAY }), TODAY), 'soon');
  assert.equal(L.ddayText(g({ expiresOn: TODAY }), TODAY), 'D-DAY');
  assert.equal(L.statusText(g({ expiresOn: TODAY }), TODAY), '오늘까지 사용');
  assert.equal(L.statusOf(g({ expiresOn: '2026-09-28' }), TODAY), 'expired');
  assert.equal(L.statusText(g({ expiresOn: '2026-09-28' }), TODAY), '만료 · 1일 지남');
});
test('7일 이내 = 곧 만료, 8일부터 여유', () => {
  assert.equal(L.statusOf(g({ expiresOn: L.addDays(TODAY, 7) }), TODAY), 'soon');
  assert.equal(L.statusOf(g({ expiresOn: L.addDays(TODAY, 8) }), TODAY), 'ok');
  assert.equal(L.ddayText(g({ expiresOn: L.addDays(TODAY, 8) }), TODAY), 'D-8');
});
test('사용함이 만료보다 먼저 (사용한 뒤 기한이 지나도 「사용함」)', () => {
  const x = g({ expiresOn: '2026-09-01', used: true });
  assert.equal(L.statusOf(x, TODAY), 'used');
  assert.equal(L.ddayText(x, TODAY), '사용함');
});
test('상태 글자에 색 없이도 알 수 있는 말이 들어 있다', () => {
  assert.match(L.statusText(g({ expiresOn: L.addDays(TODAY, 3) }), TODAY), /곧 만료/);
  assert.match(L.statusText(g({ expiresOn: L.addDays(TODAY, 30) }), TODAY), /사용 가능/);
});

console.log('요약 · 거르기 · 정렬');
const LIST = [
  g({ id: 'a', title: 'A', expiresOn: L.addDays(TODAY, 1) }),
  g({ id: 'b', title: 'B', expiresOn: L.addDays(TODAY, 30) }),
  g({ id: 'c', title: 'C', expiresOn: L.addDays(TODAY, 0) }),
  g({ id: 'd', title: 'D', expiresOn: L.addDays(TODAY, 5), used: true, usedAt: '2026-09-28T10:00:00Z' }),
  g({ id: 'e', title: 'E', expiresOn: L.addDays(TODAY, -2) }),
  g({ id: 'f', title: 'F', expiresOn: L.addDays(TODAY, -10) }),
  g({ id: 'h', title: 'H', expiresOn: L.addDays(TODAY, 9), used: true, usedAt: '2026-09-29T10:00:00Z' })
];
test('요약: 사용 가능(곧 만료 포함) · 7일 이내 · 사용함 · 만료', () => {
  assert.deepEqual(L.summarize(LIST, TODAY), { usable: 3, soon: 2, used: 2, expired: 2, total: 7 });
  assert.deepEqual(L.summarize([], TODAY), { usable: 0, soon: 0, used: 0, expired: 0, total: 0 });
});
test('탭 거르기 + 유효기간 빠른 순', () => {
  assert.deepEqual(L.filterList(LIST, 'usable', TODAY).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(L.filterList(LIST, 'soon', TODAY).map((x) => x.id), ['c', 'a']);
  assert.deepEqual(L.filterList(LIST, 'used', TODAY).map((x) => x.id), ['h', 'd']);
  assert.deepEqual(L.filterList(LIST, 'expired', TODAY).map((x) => x.id), ['e', 'f']);
});
test('전체: 쓸 수 있는 것 → 만료 → 사용함 순', () => {
  assert.deepEqual(L.filterList(LIST, 'all', TODAY).map((x) => x.id), ['c', 'a', 'b', 'e', 'f', 'h', 'd']);
});
test('탭 목록의 수 = 요약 수 (화면 숫자와 목록이 어긋나지 않음)', () => {
  const s = L.summarize(LIST, TODAY);
  for (const t of ['usable', 'soon', 'used', 'expired']) assert.equal(L.filterList(LIST, t, TODAY).length, s[t], t);
  assert.equal(L.filterList(LIST, 'all', TODAY).length, s.total);
});

console.log('알림');
test('알림 시점 읽기: 쉼표·D- 접두·중복·범위 밖', () => {
  assert.deepEqual(L.parseAlertDays('7, 1'), [7, 1]);
  assert.deepEqual(L.parseAlertDays('D-1, d7 · 7 0'), [7, 1, 0]);
  assert.deepEqual(L.parseAlertDays(['3', 'x', '400', '']), [3]);
  assert.deepEqual(L.parseAlertDays(''), []);
});
test('알림 대상: 사용 안 함 · 만료 전 · 가장 큰 시점 안, 남은 날 순', () => {
  const a = L.alertsFor(LIST, [7, 1], TODAY);
  assert.deepEqual(a.map((x) => [x.g.id, x.d, x.level]), [['c', 0, 1], ['a', 1, 1]]);
  const b = L.alertsFor(LIST.concat(g({ id: 'k', expiresOn: L.addDays(TODAY, 3) })), [7, 1], TODAY);
  assert.deepEqual(b.map((x) => [x.g.id, x.level]), [['c', 1], ['a', 1], ['k', 7]]);
});
test('알림 시점을 D-30 으로 넓히면 30일 남은 것도, 비우면 알림 없음', () => {
  assert.equal(L.alertsFor(LIST, [30], TODAY).length, 3);
  assert.equal(L.alertsFor(LIST, [], TODAY).length, 0);
  assert.deepEqual(L.alertsFor(LIST, [0], TODAY).map((x) => x.g.id), ['c']);
});

console.log('입력 검증');
test('상품명·유효기간 필수, 날짜 형식 바로잡기', () => {
  const r = L.validateGiftcon({ title: '  아메리카노 ', brand: '카페', expiresOn: '2026.10.5', memo: '', reservedBy: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { title: '아메리카노', brand: '카페', expiresOn: '2026-10-05', memo: '', reservedBy: null });
  const bad = L.validateGiftcon({ title: ' ', expiresOn: '' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  assert.match(L.validateGiftcon({ title: 'x', expiresOn: '10월 말' }).errors[0], /날짜/);
});
test('길이 제한 (DB CHECK 와 같음: 상품명 100 · 발행처 50 · 메모 500)', () => {
  assert.equal(L.validateGiftcon({ title: 'a'.repeat(101), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a', brand: 'b'.repeat(51), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a', memo: 'm'.repeat(501), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a'.repeat(100), brand: 'b'.repeat(50), memo: 'm'.repeat(500), expiresOn: TODAY }).ok, true);
});
test('사진 파일 검사와 줄이기 크기', () => {
  assert.equal(L.validateImageFile({ type: 'image/jpeg', size: 1000 }), null);
  assert.match(L.validateImageFile({ type: 'application/pdf', size: 1000 }), /사진/);
  assert.match(L.validateImageFile({ type: 'image/png', size: 11 * 1024 * 1024 }), /10MB/);
  assert.deepEqual(L.fitSize(3000, 1500, 1280), { w: 1280, h: 640 });
  assert.deepEqual(L.fitSize(1080, 2340, 1280), { w: 591, h: 1280 });
  assert.deepEqual(L.fitSize(800, 600, 1280), { w: 800, h: 600 });
});

console.log('가족 · 연결 설정');
test('초대 코드: 소문자·하이픈·빈칸 정리, 헷갈리는 글자(0·1·I·O) 거부', () => {
  assert.equal(L.normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(L.isInviteCode('ABCD2345'), true);
  assert.equal(L.isInviteCode('ABCD2340'), false);
  assert.equal(L.isInviteCode('ABCI2345'), false);
  assert.equal(L.isInviteCode('ABC2345'), false);
  assert.equal(L.formatInviteCode('ABCD2345'), 'ABCD-2345');
});
test('표시 이름 1~20자', () => {
  assert.equal(L.validateDisplayName('엄마'), null);
  assert.ok(L.validateDisplayName('  '));
  assert.ok(L.validateDisplayName('가'.repeat(21)));
});
function fakeJwt(role) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ iss: 'supabase', ref: 'example', role }) + '.sig';
}
test('연결 설정: https 주소 + anon 키만, service_role 키는 거부', () => {
  const ok = L.validateConn('https://abcd1234.supabase.co/', fakeJwt('anon'));
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://abcd1234.supabase.co');
  assert.equal(L.validateConn('https://abcd1234.supabase.co', 'sb_publishable_abcdefghij12').ok, true);
  const sr = L.validateConn('https://abcd1234.supabase.co', fakeJwt('service_role'));
  assert.equal(sr.ok, false);
  assert.match(sr.errors[0], /service_role/);
  assert.equal(L.validateConn('http://abcd1234.supabase.co', fakeJwt('anon')).ok, false);
  assert.equal(L.validateConn('https://abcd1234.supabase.co', '').ok, false);
  assert.equal(L.jwtRole('not-a-jwt'), null);
});
test('구성원 이름 찾기 — 나간 사람은 「(나간 가족)」', () => {
  const m = [{ userId: 'u1', displayName: '엄마' }];
  assert.equal(L.memberName(m, 'u1'), '엄마');
  assert.equal(L.memberName(m, 'u9'), '(나간 가족)');
  assert.equal(L.memberName(m, null), '');
});

console.log('기록 (DB 트리거와 같은 규칙)');
const nameOf = (id) => ({ u1: '엄마', u2: '아빠' })[id] || '?';
test('등록: 등록 + (예약자 있으면) 예약', () => {
  const e = L.logEntriesFor(null, g({ id: 'g1', title: '커피', reservedBy: 'u2' }), nameOf);
  assert.deepEqual(e.map((x) => [x.action, x.detail]), [['등록', null], ['예약', '예약: 아빠']]);
});
test('사용 · 사용취소 · 예약 해제 · 수정(바뀐 칸) · 삭제', () => {
  const a = g({ id: 'g1', title: '커피', reservedBy: 'u2', memo: '' });
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { used: true }), nameOf).map((x) => x.action), ['사용']);
  assert.deepEqual(L.logEntriesFor(Object.assign({}, a, { used: true }), a, nameOf).map((x) => x.action), ['사용취소']);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { reservedBy: null }), nameOf).map((x) => x.detail), ['예약 해제']);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { expiresOn: '2026-10-10', memo: '잔액 3천원' }), nameOf).map((x) => [x.action, x.detail]),
    [['수정', '바뀐 칸: 유효기간, 메모']]);
  assert.deepEqual(L.logEntriesFor(a, null, nameOf).map((x) => [x.action, x.title]), [['삭제', '커피']]);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a), nameOf), []);
});
test('빈 칸 null ↔ \'\' 은 바뀐 것으로 보지 않는다', () => {
  const a = g({ memo: null, brand: null });
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { memo: '', brand: '' }), nameOf), []);
});

console.log('DB 행 ↔ 화면 모양');
test('fromRow / toRow — 누가·언제는 앱이 보내지 않는다', () => {
  const r = { id: 'i', family_id: 'f', title: 't', brand: null, expires_on: '2026-10-01', memo: null, image_path: 'f/a.jpg',
    created_by: 'u1', reserved_by: null, used: true, used_by: 'u2', used_at: '2026-09-29T01:00:00Z', created_at: 'c', updated_at: 'u' };
  const x = L.fromRow(r);
  assert.equal(x.expiresOn, '2026-10-01');
  assert.equal(x.usedBy, 'u2');
  assert.equal(x.used, true);
  const back = L.toRow(Object.assign({}, x, { brand: '' }));
  assert.deepEqual(Object.keys(back).sort(), ['brand', 'expires_on', 'image_path', 'memo', 'reserved_by', 'title', 'used'].sort());
  assert.equal(back.brand, null);
  assert.ok(!('used_by' in back) && !('created_by' in back) && !('family_id' in back));
});

console.log('체험 모드 예시 데이터');
test('예시: 8장 — 사용 가능 6 · 7일 이내 4 · 사용함 1 · 만료 1 (오늘 기준으로 만들어짐)', () => {
  for (const day of [TODAY, '2027-02-28', '2026-12-31']) {
    const db = Sample.build(day);
    assert.equal(db.giftcons.length, 8);
    assert.deepEqual(L.summarize(db.giftcons, day), { usable: 6, soon: 4, used: 1, expired: 1, total: 8 }, day);
  }
});
test('예시: 모든 카드에 사진 · 예약자는 구성원 · 기록이 등록 순서로 있다', () => {
  const db = Sample.build(TODAY);
  const ids = db.members.map((m) => m.userId);
  for (const x of db.giftcons) {
    assert.ok(db.images[x.id] && db.images[x.id].startsWith('data:image/svg+xml'), x.id);
    if (x.reservedBy) assert.ok(ids.includes(x.reservedBy));
    assert.ok(L.validateGiftcon(x).ok, x.title);
  }
  assert.equal(db.log.filter((e) => e.action === '등록').length, 8);
  assert.equal(db.log.filter((e) => e.action === '사용').length, 1);
  assert.equal(db.log.filter((e) => e.action === '예약').length, 2);
  for (let i = 1; i < db.log.length; i++) assert.ok(db.log[i - 1].createdAt <= db.log[i].createdAt);
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' · 실패 있음' : ''));
