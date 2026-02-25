(function(){
    "use strict";

    // ====== Constants ======
    const START_MIN = 9 * 60;   // 09:00
    const END_MIN   = 22 * 60;  // 22:00 (exclusive)
    const dayNames = ["월","화","수","목","금","토","일"];

    const PRESET = [
      { key:"red",    label:"빨강",  value:"#e53935" },
      { key:"orange", label:"주황",  value:"#fb8c00" },
      { key:"yellow", label:"노랑",  value:"#fdd835" },
      { key:"green",  label:"초록",  value:"#43a047" },
      { key:"blue",   label:"파랑",  value:"#1e88e5" },
      { key:"indigo", label:"남색",  value:"#3949ab" },
      { key:"violet", label:"보라",  value:"#8e24aa" }
    ];

    const STORAGE_KEY = "jw-academy-schedule-v4";

    // ====== Utilities ======
    const $ = (sel) => document.querySelector(sel);
    const escapeHtml = (s) => (s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const pad2 = (n) => String(n).padStart(2,"0");
    const minToTime = (m) => `${pad2(Math.floor(m/60))}:${pad2(m%60)}`;
    const slotCount = (slotMin) => Math.floor((END_MIN - START_MIN) / slotMin);
    const slotStartMin = (slotIndex, slotMin) => START_MIN + slotIndex * slotMin;
    const slotKey = (day, slot) => `${day}-${slot}`;
    const otherPlan = (plan) => plan === "regular" ? "naesin" : "regular";
    const nowStamp = () => new Date().toISOString();

    function uid(){
      // short unique id
      return Math.random().toString(36).slice(2,9) + "-" + Date.now().toString(36);
    }

    function hashToIndex(str, mod){
      let h = 0;
      for(let i=0;i<str.length;i++){
        h = (h * 31 + str.charCodeAt(i)) >>> 0;
      }
      return h % mod;
    }

    function normalizeSubject(s){
      return (s||"").trim().replace(/\s+/g," ");
    }

    // 한글 IME 조합(입력 중) 값이 "과목"으로 저장되면서
    // ㄱ/구/국/국ㅇ/수하 같은 중간값 칩이 생기는 문제 방지용 필터
    function hasCompatJamo(s){
      // 호환 자모(ㄱ-ㅎ, ㅏ-ㅣ)가 포함되면 조합 중간값일 확률이 매우 높음
      return /[ㄱ-ㅎㅏ-ㅣ]/.test(s||"");
    }

    function isValidSubjectName(subject){
      const s = normalizeSubject(subject);
      if(!s) return false;
      if(hasCompatJamo(s)) return false;
      // 과목명은 보통 2글자 이상(국어/수학/영어/과학...).
      // 1글자(국/수/영/ㅇ/ㅅ/...)는 조합 중간값일 가능성이 높아 표시/저장을 막는다.
      if(s.length < 2) return false;
      return true;
    }

    function filterCompleteSubjects(subjects){
      const arr = Array.from(new Set((subjects||[]).map(normalizeSubject).filter(Boolean)));

      // 1) 확실히 조합 중간값인 패턴 제거(자모 포함/너무 짧음)
      let filtered = arr.filter(isValidSubjectName);

      // 2) 받침이 빠진 조합 중간값 제거 (예: "수하" -> "수학")
      //    NFD로 분해했을 때, 더 긴 과목명이 "짧은 과목명 + (받침 1글자)" 형태면
      //    짧은 쪽은 조합 중간값으로 간주하고 숨긴다.
      const nfdList = filtered.map(s => ({ s, nfd: s.normalize("NFD") }));
      filtered = filtered.filter(s => {
        const snfd = s.normalize("NFD");
        return !nfdList.some(o => {
          if(o.s === s) return false;
          if(!o.nfd.startsWith(snfd)) return false;
          if(o.nfd.length !== snfd.length + 1) return false;
          const extra = o.nfd.slice(-1);
          // 종성(받침) 자모 영역
          return /[\u11A8-\u11FF]/.test(extra);
        });
      });

      return filtered.sort((a,b) => a.localeCompare(b, "ko"));
    }

    // ====== State ======
    const defaultProfile = () => ({
      id: uid(),
      name: "1학기",
      regular: {},   // slotKey -> {subject, color}
      naesin: {},    // slotKey -> {subject, color}
      subjectColors: {}, // subject -> color
      updatedAt: nowStamp()
    });

    const defaultState = () => ({
      version: 4,
      profiles: [ defaultProfile() ],
      activeProfileId: null,
      settings: {
        slotMinutes: 60,
        viewMode: "compare",   // compare | regular | naesin
        activePlan: "regular", // regular | naesin
        tool: "paint",         // paint | erase
        preventOverlap: true,
        autoColor: true,
        locked: false
      },
      ui: {
        subject: "",
        color: PRESET[4].value,
        anchor: null // {day, slot} for range fill
      }
    });

    let state = loadState();
    if(!state.activeProfileId){
      state.activeProfileId = state.profiles[0].id;
    }

    // ====== DOM ======
    const subtitleEl = $("#subtitle");
    const lockBtn = $("#lockBtn");
    const printBtn = $("#printBtn");

    // print header(평소 숨김)
    const printTitle = $("#printTitle");
    const printMeta = $("#printMeta");

    const profileSelect = $("#profileSelect");
    const newProfileBtn = $("#newProfileBtn");
    const renameProfileBtn = $("#renameProfileBtn");
    const deleteProfileBtn = $("#deleteProfileBtn");

    const viewSeg = $("#viewSeg");
    const planSeg = $("#planSeg");
    const toolSeg = $("#toolSeg");

    const preventOverlapCb = $("#preventOverlap");
    const autoColorCb = $("#autoColor");

    const subjectInput = $("#subjectInput");
    const paletteEl = $("#palette");
    const colorPicker = $("#colorPicker");

    const subjectChips = $("#subjectChips");
    const lockHint = $("#lockHint");

    const gridScroll = $("#gridScroll");

    const gridEl = $("#grid");
    const listRegular = $("#listRegular");
    const listNaesin = $("#listNaesin");
    const listConflicts = $("#listConflicts");

    const toastEl = $("#toast");
    const toastText = $("#toastText");
    const toastBtn = $("#toastBtn");

    const cellMap = new Map(); // slotKey -> button element

    // subject input IME composing flag (한글 조합 중)
    let subjectComposing = false;

    // ====== Storage ======
    function loadState(){
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return defaultState();
        const data = JSON.parse(raw);
        // minimal migration
        if(!data || typeof data !== "object") return defaultState();
        if(!Array.isArray(data.profiles) || data.profiles.length === 0) return defaultState();
        if(!data.settings) data.settings = defaultState().settings;
        if(!data.ui) data.ui = defaultState().ui;
        data.version = 4;
        // ensure fields
        for(const p of data.profiles){
          p.regular = p.regular || {};
          p.naesin = p.naesin || {};
          p.subjectColors = p.subjectColors || {};
          p.updatedAt = p.updatedAt || nowStamp();
          if(!p.id) p.id = uid();
          if(!p.name) p.name = "학기";
        }
        if(!data.activeProfileId) data.activeProfileId = data.profiles[0].id;
        return data;
      }catch(e){
        console.warn("loadState failed", e);
        return defaultState();
      }
    }

    function saveState(){
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }catch(e){
        console.warn("saveState failed", e);
        showToast("저장 실패: 브라우저 저장공간을 확인해주세요.");
      }
    }

    function activeProfile(){
      return state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
    }

    function planMap(plan){
      const p = activeProfile();
      return plan === "regular" ? p.regular : p.naesin;
    }

    function updateProfileStamp(){
      const p = activeProfile();
      p.updatedAt = nowStamp();
    }

    // ====== Toast ======
    let toastTimer = null;
    function showToast(msg, actionText=null, actionFn=null){
      toastText.textContent = msg;
      if(actionText && actionFn){
        toastBtn.style.display = "";
        toastBtn.textContent = actionText;
        toastBtn.onclick = () => { actionFn(); hideToast(); };
      }else{
        toastBtn.style.display = "none";
        toastBtn.onclick = null;
      }
      toastEl.classList.add("show");
      if(toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, 2600);
    }
    function hideToast(){
      toastEl.classList.remove("show");
    }

    // ====== Color helpers ======
    function getSubjectColor(subject){
      const p = activeProfile();
      const map = p.subjectColors || {};
      const subj = normalizeSubject(subject);
      if(map[subj]) return map[subj];
      // 구버전 데이터(공백 포함 등) 호환
      if(subject && subject !== subj && map[subject]) return map[subject];
      return null;
    }
    function setSubjectColor(subject, color){
      const p = activeProfile();
      const subj = normalizeSubject(subject);
      // 조합 중간값(ㄱ/구/국ㅇ/...)은 저장하지 않음
      if(!isValidSubjectName(subj)) return;
      p.subjectColors = p.subjectColors || {};
      p.subjectColors[subj] = color;
      updateProfileStamp();
      saveState();
    }
    function autoPickColor(subject){
      const idx = hashToIndex(subject, PRESET.length);
      return PRESET[idx].value;
    }

    // ====== Render controls ======
    function syncControls(){
      const p = activeProfile();

      // subtitle
      const vm = state.settings.viewMode;
      const vmText = vm === "compare" ? "정규반/내신반 비교" : (vm === "regular" ? "정규반 보기" : "내신반 보기");
      subtitleEl.textContent = `09:00 ~ 22:00 · ${p.name} · ${vmText}`;

      // lock
      document.body.classList.toggle("locked", !!state.settings.locked);
      lockBtn.textContent = state.settings.locked ? "🔒 잠금" : "🔓 잠금 해제";
      lockHint.textContent = state.settings.locked ? "잠금 중: 편집 불가" : "";

      // profile select
      profileSelect.innerHTML = "";
      for(const prof of state.profiles){
        const opt = document.createElement("option");
        opt.value = prof.id;
        opt.textContent = prof.name;
        if(prof.id === state.activeProfileId) opt.selected = true;
        profileSelect.appendChild(opt);
      }

      // segments
      for(const btn of viewSeg.querySelectorAll("button")){
        btn.classList.toggle("on", btn.dataset.view === state.settings.viewMode);
      }
      for(const btn of planSeg.querySelectorAll("button")){
        btn.classList.toggle("on", btn.dataset.plan === state.settings.activePlan);
      }
      for(const btn of toolSeg.querySelectorAll("button")){
        btn.classList.toggle("on", btn.dataset.tool === state.settings.tool);
      }

      preventOverlapCb.checked = !!state.settings.preventOverlap;
      autoColorCb.checked = !!state.settings.autoColor;

      // inputs
      subjectInput.value = state.ui.subject;
      colorPicker.value = state.ui.color;

      // disable while locked (keep print/lock available)
      const disabled = !!state.settings.locked;
      for(const el of [
        profileSelect, newProfileBtn, renameProfileBtn, deleteProfileBtn,
        ...viewSeg.querySelectorAll("button"),
        ...planSeg.querySelectorAll("button"),
        ...toolSeg.querySelectorAll("button"),
        preventOverlapCb, autoColorCb,
        subjectInput, colorPicker,
        ...paletteEl.querySelectorAll("button"),
      ]){
        if(!el) continue;
        // allow view change even when locked? user said click 이동 불편, lock for viewing. We'll disable most edits, but allow view change.
      }

      // In locked mode: disable editing-related controls only, allow view change + print + lock
      const editDisable = (el) => { if(el){ el.disabled = disabled; } };
      editDisable(profileSelect);
      editDisable(newProfileBtn);
      editDisable(renameProfileBtn);
      editDisable(deleteProfileBtn);
      // allow viewSeg even locked for viewing
      for(const b of planSeg.querySelectorAll("button")) b.disabled = disabled;
      for(const b of toolSeg.querySelectorAll("button")) b.disabled = disabled;
      preventOverlapCb.disabled = disabled;
      autoColorCb.disabled = disabled;
      subjectInput.disabled = disabled;
      colorPicker.disabled = disabled;
      for(const b of paletteEl.querySelectorAll("button")) b.disabled = disabled;

      // chips: disable in lock
      for(const c of subjectChips.querySelectorAll("button")) c.disabled = disabled;
    }

    // ====== Build palette + chips ======
    function buildPalette(){
      paletteEl.innerHTML = "";
      for(const c of PRESET){
        const b = document.createElement("button");
        b.type = "button";
        b.className = "colorbtn";
        b.title = c.label;
        b.style.background = c.value;
        b.dataset.color = c.value;
        b.addEventListener("click", () => {
          if(state.settings.locked) return;
          state.ui.color = c.value;
          colorPicker.value = c.value;
          // if subject exists, treat manual pick as subject color assignment
          const subj = normalizeSubject(state.ui.subject);
          if(isValidSubjectName(subj)){
            setSubjectColor(subj, c.value);
            showToast(`"${subj}" 색상 저장`);
          }
          saveState();
          renderAll();
        });
        paletteEl.appendChild(b);
      }
    }

    function collectAllSubjects(){
      const p = activeProfile();
      const set = new Set();
      for(const k in p.regular){
        const s = p.regular[k]?.subject;
        if(s) set.add(normalizeSubject(s));
      }
      for(const k in p.naesin){
        const s = p.naesin[k]?.subject;
        if(s) set.add(normalizeSubject(s));
      }
      // include subjectColors keys
      for(const s in (p.subjectColors||{})){
        set.add(normalizeSubject(s));
      }
      return Array.from(set).filter(Boolean);
    }

    function collectKnownSubjects(){
      // "완성된 과목명"만 노출
      return filterCompleteSubjects(collectAllSubjects());
    }

    function collectHiddenSubjects(){
      const all = collectAllSubjects();
      const visible = new Set(filterCompleteSubjects(all));
      return all.filter(s => s && !visible.has(s)).sort((a,b) => a.localeCompare(b, "ko"));
    }

    function _deleteSubjectFromProfile(p, subject){
      const subj = normalizeSubject(subject);
      let removedRegular = 0;
      let removedNaesin = 0;
      let removedColor = false;

      for(const k of Object.keys(p.regular || {})){
        const item = p.regular[k];
        if(item && normalizeSubject(item.subject) === subj){
          delete p.regular[k];
          removedRegular++;
        }
      }
      for(const k of Object.keys(p.naesin || {})){
        const item = p.naesin[k];
        if(item && normalizeSubject(item.subject) === subj){
          delete p.naesin[k];
          removedNaesin++;
        }
      }
      if(p.subjectColors){
        for(const k of Object.keys(p.subjectColors)){
          if(normalizeSubject(k) === subj){
            delete p.subjectColors[k];
            removedColor = true;
          }
        }
      }
      return { removedRegular, removedNaesin, removedColor };
    }

    function deleteSubjectEverywhere(subject, opts={render:true}){
      const subj = normalizeSubject(subject);
      if(!subj) return { removedRegular:0, removedNaesin:0, removedColor:false };
      const p = activeProfile();
      const res = _deleteSubjectFromProfile(p, subj);

      // clear current selection if needed
      if(normalizeSubject(state.ui.subject) === subj){
        state.ui.subject = "";
        subjectInput.value = "";
      }
      state.ui.anchor = null;

      if(opts.render){
        updateProfileStamp();
        saveState();
        renderAll();
      }
      return res;
    }

    function cleanupHiddenSubjects(){
      const hidden = collectHiddenSubjects();
      if(hidden.length === 0) return;
      const preview = hidden.slice(0, 6).join(", ") + (hidden.length > 6 ? " …" : "");
      const ok = confirm(`미완성/오타 과목 ${hidden.length}개를 정리할까요?
(${preview})

※ 이 과목으로 칠해진 칸도 함께 지워집니다.`);
      if(!ok) return;

      const p = activeProfile();
      let totalCells = 0;
      let clearedSelection = false;

      for(const s of hidden){
        const subj = normalizeSubject(s);
        const res = _deleteSubjectFromProfile(p, subj);
        totalCells += (res.removedRegular + res.removedNaesin);
        if(normalizeSubject(state.ui.subject) === subj){
          clearedSelection = true;
        }
      }

      if(clearedSelection){
        state.ui.subject = "";
        subjectInput.value = "";
      }

      state.ui.anchor = null;
      updateProfileStamp();
      saveState();
      renderAll();
      showToast(totalCells > 0 ? `미완성 과목 정리 완료 (${totalCells}칸)` : "미완성 과목 정리 완료");
    }

    function buildSubjectChips(){
      const subjects = collectKnownSubjects();
      const hidden = collectHiddenSubjects();

      subjectChips.innerHTML = "";
      if(subjects.length === 0 && hidden.length === 0){
        return;
      }

      for(const subj of subjects){
        const wrap = document.createElement("div");
        wrap.className = "chipwrap";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.dataset.subject = subj;
        btn.innerHTML = `<span class="dot" style="--c:${escapeHtml(getSubjectColor(subj) || autoPickColor(subj))}"></span>${escapeHtml(subj)}`;
        btn.addEventListener("click", () => {
          if(state.settings.locked) return;
          state.ui.subject = subj;
          // auto color
          if(state.settings.autoColor){
            state.ui.color = getSubjectColor(subj) || autoPickColor(subj);
            colorPicker.value = state.ui.color;
          }
          state.ui.anchor = null;
          saveState();
          renderAll();
        });
        if(normalizeSubject(state.ui.subject) === subj){
          btn.classList.add("on");
        }

        const del = document.createElement("button");
        del.type = "button";
        del.className = "chipdel danger";
        del.textContent = "×";
        del.title = "과목 삭제";
        del.setAttribute("aria-label", `과목 삭제: ${subj}`);
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if(state.settings.locked) return;
          const ok = confirm(`"${subj}" 과목을 삭제할까요?

※ 이 과목으로 칠해진 칸도 함께 지워집니다.`);
          if(!ok) return;
          const res = deleteSubjectEverywhere(subj, {render:true});
          const total = res.removedRegular + res.removedNaesin;
          showToast(total > 0 ? `"${subj}" 삭제 (${total}칸)` : `"${subj}" 삭제`);
        });

        wrap.appendChild(btn);
        wrap.appendChild(del);
        subjectChips.appendChild(wrap);
      }

      // 숨겨진(미완성/오타) 과목이 있으면 정리 버튼만 노출
      if(hidden.length > 0){
        const cleanBtn = document.createElement("button");
        cleanBtn.type = "button";
        cleanBtn.className = "chip";
        cleanBtn.textContent = `🧹 미완성 ${hidden.length}개 정리`;
        cleanBtn.addEventListener("click", () => {
          if(state.settings.locked) return;
          cleanupHiddenSubjects();
        });
        subjectChips.appendChild(cleanBtn);
      }
    }

    // ====== Grid build + render ======
    function buildGridSkeleton(){
      cellMap.clear();
      gridEl.innerHTML = "";
      const slotMin = state.settings.slotMinutes;
      const slots = slotCount(slotMin);

      // Set grid rows: header row separate height
      // We'll implement header as separate elements with sticky top.
      // With grid-auto-rows same, we emulate header height by giving .th height var(--header-h) and align self.
      // Build header row
      const timeHead = document.createElement("div");
      timeHead.className = "th timehead";
      timeHead.textContent = "시간";
      gridEl.appendChild(timeHead);

      for(let d=0; d<7; d++){
        const th = document.createElement("div");
        th.className = "th";
        th.textContent = dayNames[d];
        gridEl.appendChild(th);
      }

      // Rows
      for(let s=0; s<slots; s++){
        const t = document.createElement("div");
        t.className = "time";
        t.textContent = minToTime(slotStartMin(s, slotMin));
        gridEl.appendChild(t);

        for(let d=0; d<7; d++){
          const wrapper = document.createElement("div");
          wrapper.className = "cell";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cellbtn";
          btn.dataset.day = String(d);
          btn.dataset.slot = String(s);
          btn.addEventListener("click", onCellClick);
          // prevent persistent focus that can cause '이동' 느낌
          btn.addEventListener("mouseup", () => btn.blur());
          btn.addEventListener("touchend", () => btn.blur());
          wrapper.appendChild(btn);
          gridEl.appendChild(wrapper);

          cellMap.set(slotKey(d,s), btn);
        }
      }
    }

    function computeRunStart(plan, d, s, map){
      const slotMin = state.settings.slotMinutes;
      const k = slotKey(d,s);
      const cur = map[k];
      if(!cur) return false;
      if(s === 0) return true;
      const prev = map[slotKey(d, s-1)];
      if(!prev) return true;
      return !(prev.subject === cur.subject && prev.color === cur.color);
    }

    function updateCell(d, s){
      const k = slotKey(d,s);
      const btn = cellMap.get(k);
      if(!btn) return;

      const p = activeProfile();
      const reg = p.regular[k] || null;
      const nae = p.naesin[k] || null;

      const conflict = !!(reg && nae);
      const vm = state.settings.viewMode;

      // background
      let bg = "";
      if(vm === "compare"){
        if(reg && nae){
          bg = `linear-gradient(135deg, ${reg.color} 0%, ${reg.color} 49%, ${nae.color} 51%, ${nae.color} 100%)`;
        }else if(reg){
          bg = reg.color;
        }else if(nae){
          bg = nae.color;
        }
      }else if(vm === "regular"){
        if(reg) bg = reg.color;
      }else if(vm === "naesin"){
        if(nae) bg = nae.color;
      }

      btn.style.background = bg ? bg : "transparent";
      btn.classList.toggle("filled", !!bg);
      btn.classList.toggle("conflict", conflict);

      // anchor highlight
      const a = state.ui.anchor;
      btn.classList.toggle("anchor", !!(a && a.day === d && a.slot === s));

      // labels
      let labelsHtml = "";
      if(vm === "compare"){
        if(reg && computeRunStart("regular", d, s, p.regular)){
          labelsHtml += `<span class="badge"><small>정</small> ${escapeHtml(reg.subject)}</span>`;
        }
        if(nae && computeRunStart("naesin", d, s, p.naesin)){
          labelsHtml += `<span class="badge"><small>내</small> ${escapeHtml(nae.subject)}</span>`;
        }
      }else if(vm === "regular"){
        if(reg && computeRunStart("regular", d, s, p.regular)){
          labelsHtml = `<span class="badge">${escapeHtml(reg.subject)}</span>`;
        }
        // if conflict exists, show tiny warning badge on run start maybe
        if(conflict && (!labelsHtml)){
          // if label hidden due to run continuation, still show subtle dot? ignore
        }
      }else if(vm === "naesin"){
        if(nae && computeRunStart("naesin", d, s, p.naesin)){
          labelsHtml = `<span class="badge">${escapeHtml(nae.subject)}</span>`;
        }
      }

      if(labelsHtml){
        btn.innerHTML = `<div class="labels">${labelsHtml}</div>`;
      }else{
        btn.innerHTML = "";
      }

      // title tooltip
      const slotMin = state.settings.slotMinutes;
      const start = minToTime(slotStartMin(s, slotMin));
      const end = minToTime(slotStartMin(s+1, slotMin));
      const day = dayNames[d];
      let tip = `${day} ${start}~${end}`;
      if(reg) tip += ` · 정:${reg.subject}`;
      if(nae) tip += ` · 내:${nae.subject}`;
      if(conflict) tip += " · ⚠️겹침";
      btn.title = tip;
      btn.setAttribute("aria-label", tip);
    }

    function renderGrid(){
      // ensure skeleton built
      if(cellMap.size === 0){
        buildGridSkeleton();
      }
      const slotMin = state.settings.slotMinutes;
      const slots = slotCount(slotMin);
      for(let s=0; s<slots; s++){
        for(let d=0; d<7; d++){
          updateCell(d,s);
        }
      }
    }

    // ====== Editing ======
    function ensureSubjectReady(){
      if(subjectComposing){
        showToast("과목명을 입력 중입니다. 입력을 완료한 뒤 선택하세요.");
        return null;
      }
      const subj = normalizeSubject(state.ui.subject);
      if(!isValidSubjectName(subj)){
        showToast("과목명을 완성해서 입력하세요. (예: 국어)");
        return null;
      }
      // apply auto color mapping
      if(state.settings.autoColor){
        const saved = getSubjectColor(subj);
        const picked = saved || autoPickColor(subj);
        state.ui.color = picked;
        colorPicker.value = picked;
        if(!saved){
          setSubjectColor(subj, picked);
        }
      }
      return subj;
    }

    function setSlot(plan, d, s, subject, color){
      const k = slotKey(d,s);
      const map = planMap(plan);
      map[k] = { subject, color };
    }

    function clearSlot(plan, d, s){
      const k = slotKey(d,s);
      const map = planMap(plan);
      if(map[k]) delete map[k];
    }

    function applyPaintRange(plan, d, s1, s2, subject, color){
      const a = Math.min(s1,s2);
      const b = Math.max(s1,s2);
      const other = otherPlan(plan);
      const otherMap = planMap(other);
      const thisMap = planMap(plan);

      let blocked = 0;
      let painted = 0;

      for(let s=a; s<=b; s++){
        const k = slotKey(d,s);
        if(state.settings.preventOverlap && otherMap[k]){
          blocked++;
          continue;
        }
        thisMap[k] = { subject, color };
        painted++;
      }
      return {painted, blocked};
    }

    function applyEraseRange(plan, d, s1, s2){
      const a = Math.min(s1,s2);
      const b = Math.max(s1,s2);
      const map = planMap(plan);
      let erased = 0;
      for(let s=a; s<=b; s++){
        const k = slotKey(d,s);
        if(map[k]){
          delete map[k];
          erased++;
        }
      }
      return erased;
    }

    function onCellClick(ev){
      if(state.settings.locked){
        // 보기 전용: 클릭해도 아무것도 안 함 (이동/키보드 등 방지)
        state.ui.anchor = null;
        renderAll();
        return;
      }
      const btn = ev.currentTarget;
      const d = parseInt(btn.dataset.day, 10);
      const s = parseInt(btn.dataset.slot, 10);
      const plan = state.settings.activePlan;
      const tool = state.settings.tool;

      if(tool === "erase"){
        // 지우기도: 같은 요일에서 시작칸 → 끝칸으로 범위 삭제
        if(state.ui.anchor && state.ui.anchor.day === d){
          const erased = applyEraseRange(plan, d, state.ui.anchor.slot, s);
          state.ui.anchor = null;
          updateProfileStamp();
          saveState();
          showToast(erased > 0 ? `삭제 ${erased}칸` : "삭제할 칸이 없습니다");
          renderAll();
          return;
        }

        // anchor 설정 + 현재 칸 지우기
        state.ui.anchor = { day: d, slot: s };
        clearSlot(plan, d, s);
        updateProfileStamp();
        saveState();
        renderAll();
        return;
      }

      // paint
      const subject = ensureSubjectReady();
      if(!subject) return;

      const color = state.ui.color;

      // first click sets anchor; second click fills range (same day)
      if(state.ui.anchor && state.ui.anchor.day === d){
        const res = applyPaintRange(plan, d, state.ui.anchor.slot, s, subject, color);
        state.ui.anchor = null;
        updateProfileStamp();
        saveState();
        if(res.blocked > 0 && res.painted === 0){
          showToast(`겹침으로 차단됨 (${res.blocked}칸)`);
        }else if(res.blocked > 0){
          showToast(`채움 ${res.painted}칸 · 겹침 차단 ${res.blocked}칸`);
        }else{
          showToast(`채움 ${res.painted}칸`);
        }
        renderAll();
        return;
      }

      // set anchor and paint one cell immediately
      state.ui.anchor = { day: d, slot: s };
      // paint this cell (respect overlap rule)
      const other = otherPlan(plan);
      const otherMap = planMap(other);
      if(state.settings.preventOverlap && otherMap[slotKey(d,s)]){
        showToast("겹치는 시간이라 채울 수 없습니다.");
        // anchor stays? better clear to avoid confusion
        state.ui.anchor = null;
        renderAll();
        return;
      }
      setSlot(plan, d, s, subject, color);
      updateProfileStamp();
      saveState();
      renderAll();
    }

    // ====== Lists / Conflicts ======
    function buildEntriesForPlan(map){
      const slotMin = state.settings.slotMinutes;
      const slots = slotCount(slotMin);
      const entries = [];
      for(let d=0; d<7; d++){
        let s=0;
        while(s<slots){
          const item = map[slotKey(d,s)];
          if(!item){ s++; continue; }
          const start = s;
          let end = s+1;
          while(end<slots){
            const nxt = map[slotKey(d,end)];
            if(!nxt || nxt.subject !== item.subject || nxt.color !== item.color) break;
            end++;
          }
          entries.push({
            day: d, startSlot: start, endSlot: end,
            subject: item.subject, color: item.color
          });
          s = end;
        }
      }
      return entries;
    }

    function renderEntries(container, plan){
      const map = planMap(plan);
      const entries = buildEntriesForPlan(map);
      container.innerHTML = "";
      if(entries.length === 0){
        container.innerHTML = `<div class="hint" style="padding:0;">(비어있음)</div>`;
        return;
      }
      const slotMin = state.settings.slotMinutes;
      for(const e of entries){
        const startMin = slotStartMin(e.startSlot, slotMin);
        const endMin = slotStartMin(e.endSlot, slotMin);
        const time = `${dayNames[e.day]} · ${minToTime(startMin)}~${minToTime(endMin)}`;
        const div = document.createElement("div");
        div.className = "entry";
        div.innerHTML = `
          <div class="left">
            <div class="topline"><span class="dot" style="--c:${escapeHtml(e.color)}"></span>${escapeHtml(e.subject)}</div>
            <div class="meta">${escapeHtml(time)}</div>
          </div>
          <div class="actions">
            <button type="button" class="danger">삭제</button>
          </div>
        `;
        const delBtn = div.querySelector("button");
        delBtn.disabled = !!state.settings.locked;
        delBtn.addEventListener("click", () => {
          if(state.settings.locked) return;
          const map = planMap(plan);
          for(let s=e.startSlot; s<e.endSlot; s++){
            delete map[slotKey(e.day,s)];
          }
          state.ui.anchor = null;
          updateProfileStamp();
          saveState();
          renderAll();
        });
        container.appendChild(div);
      }
    }

    function buildConflictEntries(){
      const p = activeProfile();
      const slotMin = state.settings.slotMinutes;
      const slots = slotCount(slotMin);
      const entries = [];
      for(let d=0; d<7; d++){
        let s=0;
        while(s<slots){
          const r = p.regular[slotKey(d,s)];
          const n = p.naesin[slotKey(d,s)];
          if(!(r && n)){ s++; continue; }
          const start = s;
          let end = s+1;
          while(end<slots){
            const rr = p.regular[slotKey(d,end)];
            const nn = p.naesin[slotKey(d,end)];
            if(!(rr && nn)) break;
            if(rr.subject !== r.subject || nn.subject !== n.subject || rr.color !== r.color || nn.color !== n.color) break;
            end++;
          }
          entries.push({
            day: d, startSlot: start, endSlot: end,
            regular: r, naesin: n
          });
          s = end;
        }
      }
      return entries;
    }

    function renderConflicts(){
      const entries = buildConflictEntries();
      listConflicts.innerHTML = "";
      if(entries.length === 0){
        listConflicts.innerHTML = `<div class="hint" style="padding:0;">(겹침 없음 🎉)</div>`;
        return;
      }
      const slotMin = state.settings.slotMinutes;
      for(const e of entries){
        const startMin = slotStartMin(e.startSlot, slotMin);
        const endMin = slotStartMin(e.endSlot, slotMin);
        const time = `${dayNames[e.day]} · ${minToTime(startMin)}~${minToTime(endMin)}`;
        const div = document.createElement("div");
        div.className = "entry";
        div.innerHTML = `
          <div class="left">
            <div class="topline">
              <span class="dot" style="--c:${escapeHtml(e.regular.color)}"></span>정:${escapeHtml(e.regular.subject)}
              <span class="dot" style="--c:${escapeHtml(e.naesin.color)}; margin-left:8px;"></span>내:${escapeHtml(e.naesin.subject)}
            </div>
            <div class="meta">⚠️ ${escapeHtml(time)}</div>
          </div>
          <div class="actions">
            <button type="button" class="danger">정규 지우기</button>
            <button type="button" class="danger">내신 지우기</button>
          </div>
        `;
        const [btnReg, btnNae] = div.querySelectorAll("button");
        btnReg.disabled = !!state.settings.locked;
        btnNae.disabled = !!state.settings.locked;

        btnReg.addEventListener("click", () => {
          if(state.settings.locked) return;
          const map = planMap("regular");
          for(let s=e.startSlot; s<e.endSlot; s++){
            delete map[slotKey(e.day,s)];
          }
          state.ui.anchor = null;
          updateProfileStamp();
          saveState();
          renderAll();
        });
        btnNae.addEventListener("click", () => {
          if(state.settings.locked) return;
          const map = planMap("naesin");
          for(let s=e.startSlot; s<e.endSlot; s++){
            delete map[slotKey(e.day,s)];
          }
          state.ui.anchor = null;
          updateProfileStamp();
          saveState();
          renderAll();
        });

        listConflicts.appendChild(div);
      }
    }

    function renderLists(){
      renderEntries(listRegular, "regular");
      renderEntries(listNaesin, "naesin");
      renderConflicts();
    }

    // ====== Events ======
    lockBtn.addEventListener("click", () => {
      state.settings.locked = !state.settings.locked;
      state.ui.anchor = null;
      saveState();
      syncControls();
      renderGrid();
      showToast(state.settings.locked ? "잠금: 보기 전용" : "잠금 해제: 편집 가능");
    });

    printBtn.addEventListener("click", () => {
      // 인쇄 전에 비교 모드로 전환 (원복 가능)
      const prev = state.settings.viewMode;
      const prevScroll = {
        x: gridScroll ? gridScroll.scrollLeft : 0,
        y: gridScroll ? gridScroll.scrollTop : 0
      };

      state.settings.viewMode = "compare";
      saveState();
      syncControls();
      renderAll();
      setTimeout(() => {
        // 인쇄 헤더 갱신 + 스크롤 원점(좌상단)으로 맞추기
        try{
          const p = activeProfile();
          const now = new Date();
          if(printTitle){
            printTitle.textContent = `정우 학원 스케줄 · ${p.name} · 정규반/내신반 비교`;
          }
          if(printMeta){
            printMeta.textContent = `출력: ${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())} · (시간표만 1장 출력)`;
          }
        }catch(e){ /* ignore */ }

        if(gridScroll){
          gridScroll.scrollLeft = 0;
          gridScroll.scrollTop = 0;
        }

        window.print();
        // print 후 다시 원복
        state.settings.viewMode = prev;
        saveState();
        syncControls();
        renderAll();

        // 사용자 스크롤 위치도 원복
        setTimeout(() => {
          if(gridScroll){
            gridScroll.scrollLeft = prevScroll.x;
            gridScroll.scrollTop = prevScroll.y;
          }
        }, 0);
      }, 120);
    });

    profileSelect.addEventListener("change", () => {
      if(state.settings.locked) return;
      state.activeProfileId = profileSelect.value;
      state.ui.anchor = null;
      saveState();
      renderAll(true);
    });

    newProfileBtn.addEventListener("click", () => {
      if(state.settings.locked) return;
      const name = normalizeSubject(prompt("새 학기 이름을 입력하세요 (예: 2학기)") || "");
      if(!name) return;
      const p = defaultProfile();
      p.name = name;
      // unique name not required
      state.profiles.push(p);
      state.activeProfileId = p.id;
      state.ui.anchor = null;
      saveState();
      showToast(`"${name}" 생성`);
      renderAll(true);
    });

    renameProfileBtn.addEventListener("click", () => {
      if(state.settings.locked) return;
      const p = activeProfile();
      const name = normalizeSubject(prompt("학기 이름을 바꿔주세요", p.name) || "");
      if(!name) return;
      p.name = name;
      updateProfileStamp();
      saveState();
      renderAll(true);
    });

    deleteProfileBtn.addEventListener("click", () => {
      if(state.settings.locked) return;
      if(state.profiles.length <= 1){
        showToast("학기는 최소 1개는 있어야 합니다.");
        return;
      }
      const p = activeProfile();
      const ok = confirm(`"${p.name}" 학기를 삭제할까요? (되돌릴 수 없음)`);
      if(!ok) return;
      state.profiles = state.profiles.filter(x => x.id !== p.id);
      state.activeProfileId = state.profiles[0].id;
      state.ui.anchor = null;
      saveState();
      renderAll(true);
    });

    viewSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-view]");
      if(!b) return;
      state.settings.viewMode = b.dataset.view;
      saveState();
      renderAll();
    });

    planSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-plan]");
      if(!b) return;
      if(state.settings.locked) return;
      state.settings.activePlan = b.dataset.plan;
      state.ui.anchor = null;
      saveState();
      renderAll();
    });

    toolSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tool]");
      if(!b) return;
      if(state.settings.locked) return;
      state.settings.tool = b.dataset.tool;
      state.ui.anchor = null;
      saveState();
      renderAll();
    });

    preventOverlapCb.addEventListener("change", () => {
      if(state.settings.locked) return;
      state.settings.preventOverlap = !!preventOverlapCb.checked;
      saveState();
      renderAll();
    });

    autoColorCb.addEventListener("change", () => {
      if(state.settings.locked) return;
      state.settings.autoColor = !!autoColorCb.checked;
      // apply auto color to current subject
      const subj = normalizeSubject(state.ui.subject);
      if(subj && state.settings.autoColor && isValidSubjectName(subj)){
        const c = getSubjectColor(subj) || autoPickColor(subj);
        state.ui.color = c;
        colorPicker.value = c;
        if(!getSubjectColor(subj)) setSubjectColor(subj, c);
      }
      saveState();
      renderAll();
    });

    // IME(한글) 조합 중에는 input 이벤트가 여러 번 발생하면서
    // "ㄱ/구/국/수하" 같은 중간값이 과목 리스트(칩)로 저장될 수 있다.
    // composition 이벤트로 조합 중 상태를 감지해서, 조합이 끝난 뒤에만 과목 색상/칩 데이터에 반영한다.
    subjectInput.addEventListener("compositionstart", () => {
      subjectComposing = true;
    });
    subjectInput.addEventListener("compositionend", () => {
      subjectComposing = false;
      if(state.settings.locked) return;
      state.ui.subject = subjectInput.value;

      const subj = normalizeSubject(state.ui.subject);
      if(subj && state.settings.autoColor && isValidSubjectName(subj)){
        const c = getSubjectColor(subj) || autoPickColor(subj);
        state.ui.color = c;
        colorPicker.value = c;
        if(!getSubjectColor(subj)) setSubjectColor(subj, c);
      }
      state.ui.anchor = null;
      saveState();
      renderAll();
    });

    subjectInput.addEventListener("input", (e) => {
      if(state.settings.locked) return;
      state.ui.subject = subjectInput.value;

      // 조합 중에는 저장/칩 업데이트를 하지 않음
      if(subjectComposing || (e && e.isComposing)){
        state.ui.anchor = null;
        saveState();
        return;
      }

      const subj = normalizeSubject(state.ui.subject);
      if(subj && state.settings.autoColor && isValidSubjectName(subj)){
        const c = getSubjectColor(subj) || autoPickColor(subj);
        state.ui.color = c;
        colorPicker.value = c;
        if(!getSubjectColor(subj)) setSubjectColor(subj, c);
      }
      state.ui.anchor = null;
      saveState();
      renderAll();
    });

    colorPicker.addEventListener("input", () => {
      if(state.settings.locked) return;
      state.ui.color = colorPicker.value;
      // if subject exists, assign to subject mapping (manual)
      const subj = normalizeSubject(state.ui.subject);
      if(subj){
        setSubjectColor(subj, state.ui.color);
      }
      saveState();
      renderAll();
    });

    // ESC clears anchor (desktop)
    window.addEventListener("keydown", (e) => {
      if(e.key === "Escape"){
        state.ui.anchor = null;
        saveState();
        renderAll();
      }
    });

    // ====== Service Worker ======
    if("serviceWorker" in navigator){
      window.addEventListener("load", async () => {
        try{
          const reg = await navigator.serviceWorker.register("./sw.js");
          // update toast
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            if(!sw) return;
            sw.addEventListener("statechange", () => {
              if(sw.state === "installed" && navigator.serviceWorker.controller){
                showToast("새 버전이 있습니다", "새로고침", () => location.reload());
              }
            });
          });
        }catch(err){
          console.warn("sw register failed", err);
        }
      });
    }

    // ====== Render all ======
    function renderAll(rebuild=false){
      if(rebuild){
        cellMap.clear();
      }
      // palette selection highlight
      for(const b of paletteEl.querySelectorAll("button.colorbtn")){
        b.classList.toggle("on", b.dataset.color === state.ui.color);
      }

      syncControls();
      buildSubjectChips();
      renderGrid();
      renderLists();
    }

    // ====== Init ======
    buildPalette();
    renderAll(true);

  })();