/*
 * 신페리오(New Peoria) 계산 로직. DOM 의존 없음. 브라우저(window.Peoria)와 Node(require) 양쪽에서 쓴다.
 *
 * 국내·일본식(기본): 핸디 = (숨김홀 타수 합 × 18/n − 코스 파) × 계수
 * 해외 대회식(옵션):  핸디 = (숨김홀 타수 합 − 숨김홀 파 합) × 18/n × 계수
 *   숨김홀 파 합이 코스 파 × n/18 이면 두 식은 같다.
 * 네트 = 그로스 − 핸디
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Peoria = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOLES = 18;
  const DEFAULT_PARS = Object.freeze([4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4]);

  const ROUNDING = Object.freeze({
    round1: { label: '소수 첫째 자리 반올림', fn: (x) => Math.round(x * 10) / 10 },
    floor1: { label: '소수 첫째 자리 버림', fn: (x) => Math.floor(x * 10 + 1e-9) / 10 },
    round0: { label: '정수 반올림', fn: (x) => Math.round(x) },
    floor0: { label: '정수 버림', fn: (x) => Math.floor(x + 1e-9) }
  });

  const HOLE_CAPS = Object.freeze({
    doublePar: { label: '더블파 (양파)', cap: (p) => p * 2 },
    tripleBogey: { label: '트리플보기 (+3)', cap: (p) => p + 3 },
    doubleBogey: { label: '더블보기 (+2)', cap: (p) => p + 2 },
    none: { label: '제한 없음', cap: () => Infinity }
  });

  const FORMULAS = Object.freeze({
    coursePar: '국내·일본식: (숨김 합 × 배수 − 코스 파) × 계수',
    overPar: '해외 대회식: (숨김 합 − 숨김 파) × 배수 × 계수'
  });

  const TIE_BREAKS = Object.freeze({
    handicap: '핸디캡 적은 사람 (= 그로스 적은 사람)',
    countback: '카운트백 (후반 9 → 6 → 3 → 18번, 이어서 전반)',
    holeback: '18번 홀부터 한 홀씩 거꾸로',
    age: '연장자',
    shared: '공동 순위'
  });

  const DEFAULT_SETTINGS = Object.freeze({
    formula: 'coursePar',
    coefficient: 0.8,
    holeCap: 'doublePar',     // HOLE_CAPS 키
    capScope: 'handicap',     // 'handicap' 핸디 계산에만 | 'all' 그로스까지
    maxHandicap: 36,          // null 이면 제한 없음
    maxHandicapF: null,       // 여성 상한 (null 이면 maxHandicap 과 같음)
    minZero: true,            // 음수 핸디 → 0
    rounding: 'round1',
    tieBreak: 'handicap',     // 1순위
    tieBreak2: 'age',         // 2순위 (1순위로 못 가리면)
    excludeMedalist: false,   // 메달리스트는 네트 순위에서 제외 (1인 1수상)
    splitByGender: false      // 남녀 따로 순위
  });

  const fix0 = (x) => (Object.is(x, -0) ? 0 : x);
  const round1 = (x) => fix0(Math.round(Number((x * 10).toFixed(6))) / 10);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const isScore = (n) => Number.isInteger(n) && n >= 1 && n <= 30;
  const isTotal = (n) => Number.isInteger(n) && n >= 1 && n <= 300;

  /** 이전 버전 저장값(capDoublePar)을 새 설정으로 옮긴다 */
  function normalizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS, ...raw };
    if (raw && raw.holeCap == null && raw.capDoublePar === false) s.holeCap = 'none';
    delete s.capDoublePar;
    if (!ROUNDING[s.rounding]) s.rounding = DEFAULT_SETTINGS.rounding;
    if (!HOLE_CAPS[s.holeCap]) s.holeCap = DEFAULT_SETTINGS.holeCap;
    if (!FORMULAS[s.formula]) s.formula = DEFAULT_SETTINGS.formula;
    if (!TIE_BREAKS[s.tieBreak]) s.tieBreak = DEFAULT_SETTINGS.tieBreak;
    if (!TIE_BREAKS[s.tieBreak2]) s.tieBreak2 = DEFAULT_SETTINGS.tieBreak2;
    if (s.capScope !== 'all') s.capScope = 'handicap';
    const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
    s.coefficient = num(s.coefficient, 0.1, 1.5) ?? DEFAULT_SETTINGS.coefficient;
    s.maxHandicap = s.maxHandicap === null ? null : (num(s.maxHandicap, 0, 108) ?? DEFAULT_SETTINGS.maxHandicap);
    s.maxHandicapF = num(s.maxHandicapF, 0, 108);
    for (const k of ['minZero', 'excludeMedalist', 'splitByGender']) s[k] = typeof s[k] === 'boolean' ? s[k] : DEFAULT_SETTINGS[k];
    return s;
  }

  function validateCourse(pars, hidden) {
    const errors = [];
    if (!Array.isArray(pars) || pars.length !== HOLES || !pars.every((p) => Number.isInteger(p) && p >= 3 && p <= 6)) {
      errors.push('홀별 파는 18개, 각 3~6이어야 합니다.');
    }
    if (!Array.isArray(hidden) || hidden.length === 0) {
      errors.push('숨김홀을 1개 이상 고르세요.');
    } else if (new Set(hidden).size !== hidden.length || !hidden.every((h) => Number.isInteger(h) && h >= 0 && h < HOLES)) {
      errors.push('숨김홀 번호가 잘못되었습니다.');
    }
    return errors;
  }

  /** 숨김홀 점검: 파 합이 코스 파 × n/18 과 같은지, 전·후반 균형이 맞는지 */
  function courseCheck(pars, hidden) {
    const coursePar = sum(pars);
    const hiddenPar = sum(hidden.map((h) => pars[h]));
    const expectedPar = (coursePar * hidden.length) / HOLES;
    const front = hidden.filter((h) => h < 9).length;
    const warnings = [];
    // 기대값이 정수가 아니면(예: 48.7) 정확히 맞출 수 없으므로 1타 이상 벌어질 때만 알린다
    if (hidden.length && Math.abs(hiddenPar - expectedPar) >= (Number.isInteger(expectedPar) ? 0.5 : 1)) {
      const target = Number.isInteger(expectedPar) ? expectedPar : `${Math.floor(expectedPar)}~${Math.ceil(expectedPar)}`;
      warnings.push(`숨김홀 파 합이 ${hiddenPar}입니다. 보통은 ${target}에 맞춥니다. 식에 따라 결과가 달라질 수 있습니다.`);
    }
    if (hidden.length % 2 === 0 && front !== hidden.length / 2) {
      warnings.push(`전반 ${front}개 · 후반 ${hidden.length - front}개로 치우쳐 있습니다.`);
    }
    return { coursePar, hiddenPar, expectedPar, front, back: hidden.length - front, warnings };
  }

  function applyRounding(x, mode) {
    const r = ROUNDING[mode] || ROUNDING.round1;
    return fix0(r.fn(Number(x.toFixed(9))));
  }

  /**
   * 선수 1명의 결과. 입력을 바꾸지 않고 새 객체를 돌려준다.
   * player.scores (18홀 타수) 또는 player.totals {gross, hiddenSum} (합계만 입력) 중 하나를 쓴다.
   */
  function computePlayer(player, pars, hidden, settings) {
    const s = normalizeSettings(settings);
    const coursePar = sum(pars);
    const hiddenPar = sum(hidden.map((h) => pars[h]));
    const multiplier = HOLES / hidden.length;
    const capOf = HOLE_CAPS[s.holeCap].cap;
    const base = { id: player.id, name: player.name, birthYear: player.birthYear ?? null, gender: player.gender || '' };

    let gross, hiddenSum, front = null, back = null, scores = null, countScores = null, hiddenDetail = null;
    const notes = [];
    const totals = player.totals;
    if (totals && (totals.gross != null || totals.hiddenSum != null)) {
      if (!isTotal(totals.gross) || !isTotal(totals.hiddenSum)) return { ...base, complete: false, missing: [], mode: 'total' };
      const n = hidden.length;
      if (totals.hiddenSum < n || totals.hiddenSum > totals.gross - (HOLES - n)) {
        return { ...base, complete: false, missing: [], mode: 'total', error: `숨김홀 합계는 ${n}~${totals.gross - (HOLES - n)} 사이여야 합니다. (홀마다 1타 이상)` };
      }
      gross = totals.gross;
      hiddenSum = totals.hiddenSum;
      notes.push('합계 입력');
    } else {
      scores = player.scores || [];
      const missing = [];
      for (let i = 0; i < HOLES; i++) if (!isScore(scores[i])) missing.push(i);
      if (missing.length > 0) return { ...base, complete: false, missing, mode: 'holes' };
      const capped = scores.map((v, i) => Math.min(v, capOf(pars[i])));
      const grossScores = s.capScope === 'all' ? capped : scores;
      front = sum(grossScores.slice(0, 9));
      back = sum(grossScores.slice(9, 18));
      gross = front + back;
      countScores = grossScores;
      hiddenDetail = hidden.map((h) => ({ hole: h + 1, par: pars[h], score: scores[h], counted: capped[h] }));
      hiddenSum = sum(hiddenDetail.map((d) => d.counted));
      const cappedHoles = hiddenDetail.filter((d) => d.counted !== d.score).map((d) => d.hole);
      if (cappedHoles.length) notes.push(`${HOLE_CAPS[s.holeCap].label} 상한: ${cappedHoles.join(', ')}번 홀`);
      if (s.capScope === 'all' && grossScores.some((v, i) => v !== scores[i])) notes.push('그로스에도 상한 적용');
    }

    const rawHandicap = s.formula === 'overPar'
      ? (hiddenSum - hiddenPar) * multiplier * s.coefficient
      : (hiddenSum * multiplier - coursePar) * s.coefficient;
    let handicap = applyRounding(rawHandicap, s.rounding);
    const cap = base.gender === 'F' && s.maxHandicapF != null ? s.maxHandicapF : s.maxHandicap;
    let capped = false;
    if (s.minZero && handicap < 0) { handicap = 0; notes.push('음수 핸디 0 처리'); }
    if (cap != null && handicap > cap) { handicap = cap; capped = true; notes.push(`핸디 상한 ${cap} 적용`); }

    return {
      ...base,
      complete: true,
      mode: scores ? 'holes' : 'total',
      missing: [],
      scores,
      countScores,
      hiddenDetail,
      front, back, gross, hiddenSum, hiddenPar, multiplier, coursePar,
      formula: s.formula,
      coefficient: s.coefficient,
      rawHandicap: round1(rawHandicap),
      handicap,
      capped,
      net: round1(gross - handicap),
      notes
    };
  }

  /** 카운트백 단계 (그로스 타수): 후반 9 → 6 → 3 → 18번, 이어서 전반 9 → 6 → 3 → 9번 */
  const COUNTBACK_STEPS = Object.freeze([
    { label: '후반 9홀', holes: [9, 10, 11, 12, 13, 14, 15, 16, 17] },
    { label: '마지막 6홀', holes: [12, 13, 14, 15, 16, 17] },
    { label: '마지막 3홀', holes: [15, 16, 17] },
    { label: '18번 홀', holes: [17] },
    { label: '전반 9홀', holes: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    { label: '전반 마지막 6홀', holes: [3, 4, 5, 6, 7, 8] },
    { label: '전반 마지막 3홀', holes: [6, 7, 8] },
    { label: '9번 홀', holes: [8] }
  ]);

  /** 규칙 하나로 비교. decided=false 면 이 규칙으로는 못 가림 */
  function compareOne(a, b, rule) {
    if (rule === 'handicap') {
      if (a.handicap === b.handicap) return { decided: false };
      return { decided: true, order: a.handicap - b.handicap, reason: `핸디 ${Math.min(a.handicap, b.handicap)} vs ${Math.max(a.handicap, b.handicap)}` };
    }
    if (rule === 'countback' || rule === 'holeback') {
      if (!a.scores || !b.scores) return { decided: false, reason: '합계 입력이라 홀별 비교 불가' };
      const steps = rule === 'countback'
        ? COUNTBACK_STEPS
        : Array.from({ length: HOLES }, (_, k) => ({ label: `${HOLES - k}번 홀`, holes: [HOLES - 1 - k] }));
      for (const step of steps) {
        const ca = a.countScores || a.scores, cb = b.countScores || b.scores;
        const sa = sum(step.holes.map((h) => ca[h]));
        const sb = sum(step.holes.map((h) => cb[h]));
        if (sa !== sb) return { decided: true, order: sa - sb, reason: `${step.label} ${Math.min(sa, sb)}타 vs ${Math.max(sa, sb)}타` };
      }
      return { decided: false };
    }
    if (rule === 'age') {
      const ya = a.birthYear, yb = b.birthYear;
      if (ya != null && yb != null && ya !== yb) return { decided: true, order: ya - yb, reason: `연장자 (${Math.min(ya, yb)}년생)` };
      if ((ya == null) !== (yb == null)) return { decided: true, order: ya == null ? 1 : -1, reason: '출생연도 입력자 우선' };
      return { decided: false };
    }
    return { decided: false }; // shared
  }

  /** 1순위 → 2순위 규칙으로 차례로 비교. 'shared' 를 만나면 거기서 멈춘다 */
  function compareTie(a, b, rules) {
    for (const rule of rules) {
      if (rule === 'shared') break;
      const r = compareOne(a, b, rule);
      if (r.decided) return r;
    }
    return { decided: false, order: 0 };
  }

  function rankGroup(done, s, medalistId) {
    const rules = [s.tieBreak, s.tieBreak2].filter((r, i, arr) => r && arr.indexOf(r) === i);
    const pool = done.filter((r) => !(s.excludeMedalist && r.id === medalistId));
    const sorted = [...pool].sort((a, b) => a.net - b.net || compareTie(a, b, rules).order || 0);
    const ranked = [];
    sorted.forEach((r, i) => {
      const prev = sorted[i - 1];
      let rank = i + 1;
      let tieReason = null;
      if (prev && prev.net === r.net) {
        const cmp = compareTie(prev, r, rules);
        if (!cmp.decided) rank = ranked[i - 1].rank;
        else tieReason = cmp.reason;
      }
      ranked.push({ ...r, rank, tieReason });
    });
    return ranked.map((r) => ({ ...r, tie: ranked.some((o) => o !== r && o.rank === r.rank), medalist: r.id === medalistId }));
  }

  /**
   * 전체 순위. splitByGender 면 groups 에 남(M)·여(F)·미지정 순위를 따로 담는다.
   * ranked 는 항상 전체 순위.
   */
  function rankPlayers(players, pars, hidden, settings) {
    const s = normalizeSettings(settings);
    const results = players.map((p) => computePlayer(p, pars, hidden, s));
    const done = results.filter((r) => r.complete);
    const incomplete = results.filter((r) => !r.complete);

    const minGross = done.length ? Math.min(...done.map((r) => r.gross)) : null;
    const rules = [s.tieBreak, s.tieBreak2].filter((r, i, arr) => r && arr.indexOf(r) === i);
    // 그로스 → 네트 → 동점 규칙 → 이름·id 순. 마지막 두 단계는 입력 순서에 좌우되지 않게 하려는 고정 순서
    const medalist = done.filter((r) => r.gross === minGross).sort((a, b) =>
      a.net - b.net || compareTie(a, b, rules).order || String(a.name).localeCompare(String(b.name), 'ko') || String(a.id).localeCompare(String(b.id))
    )[0] || null;
    const medalistId = medalist ? medalist.id : null;

    const ranked = rankGroup(done, s, medalistId);
    const excluded = done
      .filter((r) => s.excludeMedalist && r.id === medalistId)
      .map((r) => ({ ...r, rank: null, tie: false, tieReason: null, medalist: true }));

    let groups = null;
    if (s.splitByGender) {
      const keys = [['M', '남자'], ['F', '여자'], ['', '성별 미지정']];
      groups = keys
        .map(([g, label]) => ({ key: g, label, ranked: rankGroup(done.filter((r) => r.gender === g), s, medalistId) }))
        .filter((g) => g.ranked.length > 0);
    }
    return { ranked, excluded, incomplete, medalistId, groups };
  }

  /**
   * 자동 시상. 순위표(ranked)와 홀별 타수로 판정할 수 있는 것만 다룬다.
   * 롱기·니어는 현장 측정이라 화면에서 직접 적는다.
   */
  function computeAwards(result, pars, options = {}) {
    const all = [...result.ranked, ...result.excluded];
    const awards = [];
    const byRank = (k) => result.ranked.filter((r) => r.rank === k);
    const medal = all.find((r) => r.medalist);
    if (medal) awards.push({ key: 'medal', title: '메달리스트', winners: [medal], detail: `${medal.gross}타` });
    [['win', '우승', 1], ['second', '준우승', 2], ['third', '3위', 3]].forEach(([key, title, k]) => {
      const w = byRank(k);
      if (w.length) awards.push({ key, title, winners: w, detail: `네트 ${w[0].net}` });
    });
    if (options.booby && result.ranked.length >= 4) {
      const lastRank = Math.max(...result.ranked.map((r) => r.rank));
      const above = result.ranked.filter((r) => r.rank < lastRank);
      const boobyRank = above.length ? Math.max(...above.map((r) => r.rank)) : null;
      const w = result.ranked.filter((r) => r.rank === boobyRank);
      if (w.length && boobyRank > 3) awards.push({ key: 'booby', title: '부비상 (뒤에서 2등)', winners: w, detail: `네트 ${w[0].net}` });
    }
    const withScores = all.filter((r) => r.scores);
    const countBy = (fn) => withScores.map((r) => ({ r, n: r.scores.filter((v, i) => fn(v, pars[i])).length }));
    const most = (list, key, title, unit) => {
      const max = Math.max(0, ...list.map((x) => x.n));
      if (max > 0) awards.push({ key, title, winners: list.filter((x) => x.n === max).map((x) => x.r), detail: `${max}${unit}` });
    };
    if (options.mostBirdies !== false) most(countBy((v, p) => v < p), 'birdie', '다버디상', '개 · 버디 이상');
    if (options.mostPars) most(countBy((v, p) => v === p), 'par', '다파상', '개');
    const aces = withScores.flatMap((r) => r.scores.map((v, i) => (v === 1 ? { r, hole: i + 1 } : null)).filter(Boolean));
    if (aces.length) awards.push({ key: 'ace', title: '홀인원', winners: aces.map((a) => a.r), detail: aces.map((a) => `${a.hole}번 홀`).join(', ') });
    return awards;
  }

  // ---------- 추첨 ----------
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /** 추첨 검증코드 6자리. 같은 코드·같은 파·같은 개수면 같은 숨김홀이 나온다 */
  function makeDrawCode(rng = Math.random) {
    return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)]).join('');
  }

  /** 문자열 시드 난수 (mulberry32 + 문자열 해시) */
  function seededRng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 숨김홀 추첨. 전·후반 각 count/2 홀.
   * 1순위 구성표(12홀: 파3 1·파4 4·파5 1 / 6홀: 파3·4·5 하나씩),
   * 2순위 파 합을 코스 파 × n/18 에 맞춘 조합, 3순위 무작위. method 에 어느 단계로 뽑았는지 남긴다.
   */
  function drawHidden(pars, rng = Math.random, count = 12) {
    count = Math.min(HOLES, Math.max(1, Math.round(Number(count)) || 12));
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const per = Math.floor(count / 2);
    const recipeFor = (n) => (n === 6 ? { 3: 1, 4: 4, 5: 1 } : n === 3 ? { 3: 1, 4: 1, 5: 1 } : null);
    const methods = [];
    const pickNine = (start, n) => {
      const holes = Array.from({ length: 9 }, (_, i) => start + i);
      const recipe = recipeFor(n);
      if (recipe) {
        const picked = [];
        let ok = true;
        for (const [p, k] of Object.entries(recipe)) {
          const pool = shuffle(holes.filter((h) => pars[h] === Number(p)));
          if (pool.length < k) { ok = false; break; }
          picked.push(...pool.slice(0, k));
        }
        if (ok) { methods.push('recipe'); return picked; }
      }
      const target = (sum(holes.map((h) => pars[h])) * n) / 9;
      for (let tries = 0; tries < 3000; tries++) {
        const pick = shuffle(holes).slice(0, n);
        if (sum(pick.map((h) => pars[h])) === target) { methods.push('parSum'); return pick; }
      }
      methods.push('random');
      return shuffle(holes).slice(0, n);
    };
    const holes = [...pickNine(0, per), ...pickNine(9, count - per)].sort((a, b) => a - b);
    const method = methods.includes('random') ? 'random' : methods.includes('parSum') ? 'parSum' : 'recipe';
    return { holes, method };
  }

  function pickHiddenHoles(pars, rng = Math.random, count = 12) {
    return drawHidden(pars, rng, count).holes;
  }

  /** 검증코드로 추첨. 같은 코드면 언제 다시 해도 같은 결과 */
  function drawFromCode(code, pars, count = 12) {
    const clean = String(code).trim().toUpperCase();
    return { code: clean, ...drawHidden(pars, seededRng(`${clean}|${count}|${pars.join('')}`), count) };
  }

  /**
   * 엑셀·메모 붙여넣기 파싱. 한 줄에 "이름 + 18개 숫자" (탭·쉼표·공백 구분).
   * relative=true 면 숫자를 파 대비(+/-)로 보고 타수로 바꾼다.
   */
  function parsePasted(text, pars, relative) {
    const rows = [];
    const errors = [];
    const failedLines = [];   // 고쳐서 다시 넣도록 실패한 줄 원문을 돌려준다
    let skipped = 0;          // 머리글·파 줄처럼 선수가 아닌 줄
    const HEADER_WORD = /^(이름|성명|선수|name|홀|hole|파|par|out|in|합계|total|tot)$/i;
    String(text).normalize('NFKC').split(/\r\n|\r|\n/).forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let cells = trimmed.split(/[\t,]+|\s+/).filter(Boolean);
      const isNum = (c) => /^[+-]?\d+$/.test(c);
      const numsAll = cells.filter(isNum).map(Number);
      const sequential = numsAll.length >= HOLES && numsAll.slice(0, HOLES).every((n, i) => n === i + 1);
      if (cells.some((c) => HEADER_WORD.test(c)) || sequential) { skipped++; return; }
      const fail = (msg) => { errors.push(msg); failedLines.push(line); };
      // 끝에 합계 열이 붙은 줄(18개 + 합계)은 합계를 떼어 낸다
      if (cells.length > HOLES && cells.slice(-(HOLES + 1)).every(isNum)) {
        const t = cells.slice(-(HOLES + 1)).map(Number);
        const body = t.slice(0, HOLES);
        if (t[HOLES] === sum(body) || (relative && t[HOLES] === sum(body) + sum(pars))) cells = cells.slice(0, -1);
      }
      const tail = cells.slice(-HOLES);
      if (cells.length < HOLES || !tail.every(isNum)) {
        const count = cells.filter(isNum).length;
        return fail(`${idx + 1}번째 줄: 끝에 숫자 18개가 필요합니다. (현재 숫자 ${count}개)`);
      }
      const nums = tail.map(Number);
      if (relative && nums.every((n) => n >= 3)) {
        return fail(`${idx + 1}번째 줄: 타수를 그대로 적은 것 같습니다. "파 대비"를 끄고 다시 넣으세요.`);
      }
      const nameParts = cells.slice(0, cells.length - HOLES);
      const scores = nums.map((n, i) => (relative ? pars[i] + n : n));
      if (!scores.every(isScore)) {
        return fail(`${idx + 1}번째 줄: 1~30 범위를 벗어난 타수가 있습니다.`);
      }
      rows.push({ name: nameParts.join(' ') || `선수${rows.length + 1}`, scores });
    });
    return { rows, errors, failedLines, skipped };
  }

  return {
    HOLES, DEFAULT_PARS, DEFAULT_SETTINGS, ROUNDING, HOLE_CAPS, FORMULAS, TIE_BREAKS, COUNTBACK_STEPS,
    round1, isScore, isTotal, applyRounding, normalizeSettings, validateCourse, courseCheck,
    computePlayer, rankPlayers, computeAwards,
    makeDrawCode, seededRng, drawHidden, pickHiddenHoles, drawFromCode, parsePasted
  };
});
