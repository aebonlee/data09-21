/*
 * 가족 기프티콘 관리 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.GCLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 기프티콘 한 장 (화면 안 모양 — DB 칸 이름은 fromRow/toRow 가 바꿔 줌)
 *   { id, familyId, title, brand, expiresOn:'YYYY-MM-DD', memo, imagePath,
 *     createdBy, reservedBy, used, usedBy, usedAt, createdAt, updatedAt }
 *
 * 유효기간은 「이 날까지 사용 가능」입니다. 남은 날 d = 유효기간 − 오늘.
 *   d < 0 → 만료, d = 0 → 오늘까지(D-DAY), 0 ≤ d ≤ 7 → 곧 만료, 그 밖 → 여유
 * 「사용함」은 사용자가 직접 표시합니다(발행처 자동 조회 없음 — 기획서 5장).
 */
(function (root) {
  'use strict';

  var SOON_DAYS = 7;                 // 「7일 이내 만료」 기준
  var DEFAULT_ALERT_DAYS = [7, 1];   // 알림 시점 기본값 (D-7, D-1)
  var ALERT_CHOICES = [30, 14, 7, 3, 1, 0];
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 고르기 전 원본 한도 (올릴 때는 줄여서)
  var IMAGE_MAX_SIDE = 1280;

  var STATUS_LABEL = { ok: '사용 가능', soon: '곧 만료', used: '사용함', expired: '만료' };
  var TABS = [
    { id: 'usable', label: '사용 가능' },
    { id: 'soon', label: '7일 이내 만료' },
    { id: 'used', label: '사용함' },
    { id: 'expired', label: '만료' },
    { id: 'all', label: '전체' }
  ];
  var ACTIONS = ['등록', '수정', '사용', '사용취소', '예약', '삭제'];

  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ── 날짜 ──────────────────────────────────────────────────
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  // 2026.10.5 · 2026/10/05 · 20261005 · 2026년 10월 5일 → 2026-10-05
  function normDate(s) {
    s = str(s);
    var m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    var out = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    return isDate(out) ? out : null;
  }
  function dayNum(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; }
  function daysLeft(expiresOn, today) { return dayNum(expiresOn) - dayNum(today); }
  function addDays(s, n) {
    var d = new Date(dayNum(s) * 86400000 + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function shortDate(s) {
    var p = s.split('-').map(Number);
    return p[0] + '. ' + p[1] + '. ' + p[2] + '.';
  }

  // ── 상태 ──────────────────────────────────────────────────
  function statusOf(g, today) {
    if (g.used) return 'used';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return 'expired';
    if (d <= SOON_DAYS) return 'soon';
    return 'ok';
  }
  // 크게 보이는 배지 글자
  function ddayText(g, today) {
    if (g.used) return '사용함';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return '만료';
    if (d === 0) return 'D-DAY';
    return 'D-' + d;
  }
  // 배지 아래 풀이 (색만으로 구분하지 않도록 글자로도 적음)
  function statusText(g, today) {
    if (g.used) return '사용함';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return '만료 · ' + (-d) + '일 지남';
    if (d === 0) return '오늘까지 사용';
    if (d <= SOON_DAYS) return '곧 만료 · ' + d + '일 남음';
    return '사용 가능 · ' + d + '일 남음';
  }

  // 요약 — usable 은 「아직 쓸 수 있는 것 전부」, soon 은 그중 7일 이내
  function summarize(list, today) {
    var s = { usable: 0, soon: 0, used: 0, expired: 0, total: list.length };
    list.forEach(function (g) {
      var st = statusOf(g, today);
      if (st === 'used') s.used++;
      else if (st === 'expired') s.expired++;
      else { s.usable++; if (st === 'soon') s.soon++; }
    });
    return s;
  }

  function inTab(g, tab, today) {
    var st = statusOf(g, today);
    if (tab === 'usable') return st === 'ok' || st === 'soon';
    if (tab === 'soon') return st === 'soon';
    if (tab === 'used') return st === 'used';
    if (tab === 'expired') return st === 'expired';
    return true;
  }
  // 정렬: 쓸 수 있는 것(유효기간 빠른 순) → 만료(최근 만료 먼저) → 사용함(최근 사용 먼저)
  function sortList(list, today) {
    var rank = { soon: 0, ok: 0, expired: 1, used: 2 };
    return list.slice().sort(function (a, b) {
      var ra = rank[statusOf(a, today)], rb = rank[statusOf(b, today)];
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : str(a.title).localeCompare(str(b.title));
      if (ra === 1) return a.expiresOn > b.expiresOn ? -1 : a.expiresOn < b.expiresOn ? 1 : 0;
      return str(b.usedAt).localeCompare(str(a.usedAt));
    });
  }
  function filterList(list, tab, today) {
    return sortList(list.filter(function (g) { return inTab(g, tab, today); }), today);
  }

  // ── 알림 (1단계: 앱 안 띠·목록) ───────────────────────────
  // '7, 1' · [7,1,'0'] → [7,1] (큰 것부터, 중복·범위 밖 제거)
  function parseAlertDays(v) {
    var arr = Array.isArray(v) ? v : str(v).split(/[\s,·]+/);
    var out = [];
    arr.forEach(function (x) {
      var s = str(x).replace(/^D-?/i, '');
      if (s === '') return;
      if (!/^\d+$/.test(s)) return;
      var n = +s;
      if (n <= 365 && out.indexOf(n) < 0) out.push(n);
    });
    return out.sort(function (a, b) { return b - a; });
  }
  // 알림 대상: 사용 안 함 · 만료 전 · 남은 날 ≤ 가장 큰 알림 시점.
  // level = 남은 날을 덮는 가장 작은 알림 시점 (D-3 이면 [7,1] 중 7 → 「D-7 알림」)
  function alertsFor(list, days, today) {
    days = parseAlertDays(days);
    if (!days.length) return [];
    var max = days[0];
    var out = [];
    list.forEach(function (g) {
      if (g.used) return;
      var d = daysLeft(g.expiresOn, today);
      if (d < 0 || d > max) return;
      var level = max;
      days.forEach(function (x) { if (x >= d && x < level) level = x; });
      out.push({ g: g, d: d, level: level });
    });
    return out.sort(function (a, b) { return a.d - b.d || str(a.g.title).localeCompare(str(b.g.title)); });
  }

  // ── 입력 검증 ─────────────────────────────────────────────
  function validateGiftcon(input) {
    var errors = [];
    var v = {
      title: str(input.title),
      brand: str(input.brand),
      expiresOn: normDate(input.expiresOn),
      memo: str(input.memo),
      reservedBy: str(input.reservedBy) || null
    };
    if (!v.title) errors.push('상품명을 적어 주세요.');
    else if (v.title.length > 100) errors.push('상품명은 100자까지입니다.');
    if (v.brand.length > 50) errors.push('발행처는 50자까지입니다.');
    if (!str(input.expiresOn)) errors.push('유효기간을 넣어 주세요.');
    else if (!v.expiresOn) errors.push('유효기간을 날짜(예: 2026-10-31)로 넣어 주세요.');
    if (v.memo.length > 500) errors.push('메모는 500자까지입니다.');
    return { ok: errors.length === 0, errors: errors, value: v };
  }
  function validateImageFile(f) {
    if (!f) return null;
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type || '')) return '사진 파일(JPG·PNG·WEBP)을 골라 주세요.';
    if (f.size > MAX_IMAGE_BYTES) return '사진이 너무 큽니다(10MB 까지).';
    return null;
  }
  // 긴 변을 max 로 줄인 크기 (작으면 그대로)
  function fitSize(w, h, max) {
    max = max || IMAGE_MAX_SIDE;
    if (w <= max && h <= max) return { w: w, h: h };
    var r = w >= h ? max / w : max / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }

  // ── 가족 · 초대 코드 · 연결 설정 ───────────────────────────
  function normalizeInviteCode(s) { return str(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  function isInviteCode(s) { return /^[A-HJ-NP-Z2-9]{8}$/.test(s); }
  function formatInviteCode(s) { return s && s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : s; }
  function validateDisplayName(s) {
    s = str(s);
    if (!s) return '표시 이름을 적어 주세요(예: 엄마).';
    if (s.length > 20) return '표시 이름은 20자까지입니다.';
    return null;
  }
  // 사용자가 붙여 넣는 본인 Supabase 주소·anon 키
  function validateConn(url, key) {
    url = str(url).replace(/\/+$/, '');
    key = str(key);
    var errors = [];
    if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(url)) errors.push('Project URL 을 https:// 로 시작하는 주소로 넣어 주세요(예: https://abcd1234.supabase.co).');
    if (!(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key) || /^sb_publishable_[\w-]{10,}$/.test(key))) errors.push('anon(public) 키를 그대로 붙여 넣어 주세요. service_role·secret 키는 넣지 마세요.');
    else if (/^eyJ/.test(key) && jwtRole(key) && jwtRole(key) !== 'anon') errors.push('이 키는 ' + jwtRole(key) + ' 키입니다. 브라우저에는 anon 키만 넣어야 합니다.');
    return { ok: errors.length === 0, errors: errors, url: url, key: key };
  }
  function jwtRole(key) {
    try {
      var p = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var txt = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary');
      return JSON.parse(txt).role || null;
    } catch (e) { return null; }
  }

  function memberName(members, id) {
    if (!id) return '';
    for (var i = 0; i < members.length; i++) if (members[i].userId === id) return members[i].displayName;
    return '(나간 가족)';
  }

  // ── 기록 — DB 트리거(giftcons_write_log)와 같은 규칙 ─────
  // before 가 null 이면 등록, after 가 null 이면 삭제. nameOf(id) 로 예약자 이름.
  function logEntriesFor(before, after, nameOf) {
    nameOf = nameOf || function (x) { return x; };
    var out = [];
    function push(action, g, detail) { out.push({ action: action, giftconId: g.id, title: g.title, detail: detail || null }); }
    if (!before && after) {
      push('등록', after);
      if (after.reservedBy) push('예약', after, '예약: ' + nameOf(after.reservedBy));
      if (after.used) push('사용', after);
      return out;
    }
    if (before && !after) { push('삭제', before); return out; }
    var diff = [];
    [['title', '상품명'], ['brand', '발행처'], ['expiresOn', '유효기간'], ['memo', '메모'], ['imagePath', '사진']].forEach(function (p) {
      if (str(before[p[0]]) !== str(after[p[0]])) diff.push(p[1]);
    });
    if (diff.length) push('수정', after, '바뀐 칸: ' + diff.join(', '));
    if ((before.reservedBy || null) !== (after.reservedBy || null)) {
      push('예약', after, after.reservedBy ? '예약: ' + nameOf(after.reservedBy) : '예약 해제');
    }
    if (after.used && !before.used) push('사용', after);
    else if (before.used && !after.used) push('사용취소', after);
    return out;
  }

  // ── DB 행 ↔ 화면 모양 ─────────────────────────────────────
  var MAP = [['id', 'id'], ['familyId', 'family_id'], ['title', 'title'], ['brand', 'brand'], ['expiresOn', 'expires_on'],
    ['memo', 'memo'], ['imagePath', 'image_path'], ['createdBy', 'created_by'], ['reservedBy', 'reserved_by'],
    ['used', 'used'], ['usedBy', 'used_by'], ['usedAt', 'used_at'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']];
  function fromRow(r) {
    var g = {};
    MAP.forEach(function (p) { g[p[0]] = r[p[1]] == null ? null : r[p[1]]; });
    g.used = !!g.used;
    return g;
  }
  // 앱이 보내는 칸만 (등록자·사용자·시각은 DB 트리거가 채움)
  function toRow(v) {
    var r = {};
    if ('title' in v) r.title = v.title;
    if ('brand' in v) r.brand = v.brand || null;
    if ('expiresOn' in v) r.expires_on = v.expiresOn;
    if ('memo' in v) r.memo = v.memo || null;
    if ('reservedBy' in v) r.reserved_by = v.reservedBy || null;
    if ('imagePath' in v) r.image_path = v.imagePath || null;
    if ('used' in v) r.used = !!v.used;
    return r;
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var api = {
    SOON_DAYS: SOON_DAYS, DEFAULT_ALERT_DAYS: DEFAULT_ALERT_DAYS, ALERT_CHOICES: ALERT_CHOICES,
    STATUS_LABEL: STATUS_LABEL, TABS: TABS, ACTIONS: ACTIONS, IMAGE_MAX_SIDE: IMAGE_MAX_SIDE,
    todayStr: todayStr, isDate: isDate, normDate: normDate, daysLeft: daysLeft, addDays: addDays, shortDate: shortDate,
    statusOf: statusOf, ddayText: ddayText, statusText: statusText, summarize: summarize,
    inTab: inTab, sortList: sortList, filterList: filterList,
    parseAlertDays: parseAlertDays, alertsFor: alertsFor,
    validateGiftcon: validateGiftcon, validateImageFile: validateImageFile, fitSize: fitSize,
    normalizeInviteCode: normalizeInviteCode, isInviteCode: isInviteCode, formatInviteCode: formatInviteCode,
    validateDisplayName: validateDisplayName, validateConn: validateConn, jwtRole: jwtRole,
    memberName: memberName, logEntriesFor: logEntriesFor, fromRow: fromRow, toRow: toRow, fmtDateTime: fmtDateTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GCLogic = api;
})(typeof window !== 'undefined' ? window : this);
