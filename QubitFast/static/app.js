const $ = id => document.getElementById(id);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const AZ = 35 * Math.PI / 180, EL = 22 * Math.PI / 180;
const token = (() => {
  let t = localStorage.getItem("qf_token");
  if (!t) { t = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem("qf_token", t); }
  return t;
})();
let unseen = 0, current = null;

async function api(url, body) {
  const r = await fetch(url, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : undefined);
  const d = await r.json().catch(() => ({}));
  d._ok = r.ok; d._status = r.status;
  return d;
}

/* ---------- Bloch sphere ---------- */
function project([x, y, z], R, c) {
  const depth = x * Math.sin(AZ) + y * Math.cos(AZ);
  return [c + R * (x * Math.cos(AZ) - y * Math.sin(AZ)), c - R * (z * Math.cos(EL) - depth * Math.sin(EL))];
}
function blochSVG(v) {
  const c = 60, R = 46, [px, py] = project(v, R, c);
  const axis = (a, l) => { const [x, y] = project(a, R, c); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#35417a"/><text x="${x + (x > c ? 3 : -16)}" y="${y + 3}" fill="#8f9bc4" font-size="8">${l}</text>`; };
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Bloch sphere"><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#35417a"/>
  <ellipse cx="${c}" cy="${c}" rx="${R}" ry="${R * Math.sin(EL)}" fill="none" stroke="#243056" stroke-dasharray="3 3"/>
  ${axis([0, 0, 1], "|0⟩")}${axis([0, 0, -1], "|1⟩")}${axis([1, 0, 0], "x")}${axis([0, 1, 0], "y")}
  <line x1="${c}" y1="${c}" x2="${px}" y2="${py}" stroke="#5eead4" stroke-width="2"/><circle cx="${px}" cy="${py}" r="4" fill="#5eead4"/></svg>`;
}
const card = (s, label = "") => `<div class="card">${blochSVG(s.bloch)}<div>${label}<b>${s.bits}</b></div><div>θ ${s.theta_deg}° · φ ${s.phi_deg}°</div></div>`;
const when = t => new Date(t).toLocaleString([], {hour: "2-digit", minute: "2-digit", day: "numeric", month: "short"});

/* hero sphere: one slow orbit, off when the user prefers reduced motion */
let phi = 0.6;
function spin() {
  const th = 1.05;
  $("hero-sphere").innerHTML = blochSVG([Math.sin(th) * Math.cos(phi), Math.sin(th) * Math.sin(phi), Math.cos(th)]);
  phi += 0.025;
  if (!$("hero-sphere").closest("[hidden]") && !matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(spin);
}

/* ---------- navigation ---------- */
function show(p) {
  $$("[data-page]").forEach(s => s.hidden = s.dataset.page !== p);
  $$("#nav button").forEach(b => b.setAttribute("aria-current", b.dataset.go === p));
  if (p === "home") { loadStats(); spin(); }
  if (p === "inbox") loadInbox();
  if (p === "learn") loadLearn();
  if (p === "alerts") { unseen = 0; badge(); loadAlerts(); }
  history.replaceState(null, "", "#" + p); scrollTo(0, 0);
}
document.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) show(b.dataset.go); });
const badge = () => { $("badge").hidden = !unseen; $("badge").textContent = unseen; };

async function loadStats() {
  const s = await api("/stats");
  ["sent", "opened", "wrong", "locked"].forEach(k => $("st-" + k).textContent = s[k] ?? 0);
}

/* ---------- send ---------- */
$("gen").onclick = async () => { $("key-enc").value = (await api("/generate-key?length=8")).key; };
$("go-send").onclick = async () => {
  $("err-send").textContent = "";
  const d = await api("/send", {token, sender: $("s-name").value.trim(), to: $("s-to").value.trim(), message: $("msg").value, key: $("key-enc").value, expires: +$("exp").value, destruct: $("burn").checked});
  if (!d._ok) { $("err-send").textContent = d.error; $("sent").hidden = true; return; }
  $("sent-id").textContent = d.message.id;
  $("cipher").textContent = d.cipher_hex;
  $("grid-enc").innerHTML = d.groups.map(g => card(g.cipher, g.plain + " → ")).join("");
  $("sent").hidden = false; $("msg").value = "";
};

function popup(title, text) {
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="primary">OK</button></div>`;
  o.querySelector("button").onclick = () => o.remove();
  document.body.append(o); o.querySelector("button").focus();
}

/* ---------- inbox / receiver ---------- */
async function loadInbox() {
  const list = await api("/inbox");
  $("list").innerHTML = list.length ? "" : `<p class="lead">No messages yet. Send one first.</p>`;
  list.forEach(m => {
    const b = document.createElement("button");
    b.className = "msg"; b.setAttribute("aria-pressed", current && current.id === m.id);
    b.innerHTML = `<span>From ${esc(m.sender)} to ${esc(m.to)}<small>${when(m.created)} · ID ${m.id}${m.destruct ? " · burns after reading" : ""}${m.expires_at ? " · expires " + new Date(m.expires_at * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : ""}</small></span><span class="pill ${m.status}">${m.status}</span>`;
    b.onclick = () => { current = m; loadInbox(); panel(m); };
    $("list").append(b);
  });
}
const dots = a => `<div class="dots">${[0, 1, 2].map(i => `<i class="${i < a ? "on" : ""}"></i>`).join("")}<span>${a}/3 wrong attempts</span></div>`;
function panel(m) {
  const p = $("panel"); p.hidden = false;
  if (m.status === "locked") { p.innerHTML = `<h2>Locked</h2>${dots(3)}<p class="bad">3/3 wrong attempts. The sender has been alerted.</p>`; return; }
  p.innerHTML = `<h2>Message from ${esc(m.sender)}</h2>${dots(m.attempts)}
    <label>Secret key<input id="k" type="password" autocomplete="off" placeholder="Enter the shared key"></label>
    <button id="unlock" class="primary">Unlock message</button><p id="mstat" class="err" role="alert"></p><div id="reveal"></div>`;
  const go = async () => {
    $("unlock").disabled = true; $("mstat").className = "lead"; $("mstat").textContent = "Verifying key…";
    const [d] = await Promise.all([api("/open/" + m.id, {key: $("k").value}), new Promise(r => setTimeout(r, 1200))]);
    $("mstat").className = "err";
    if (d._ok) {
      $("mstat").textContent = ""; $("panel").querySelector(".dots").outerHTML = dots(0);
      $("reveal").innerHTML = `<h2>Decrypted message</h2><div class="plain"></div><h2>Qubit states received</h2><div class="grid">${d.groups.map(g => card(g, "→ " + g.plain + " · ")).join("")}</div>`;
      $("reveal").querySelector(".plain").textContent = d.message; m.status = "read";
      if (d.destroyed) { $("reveal").insertAdjacentHTML("afterbegin", '<p class="bad">This message has self-destructed. It cannot be opened again.</p>'); current = null; }
      loadInbox();
    } else if (d._status === 401) {
      m.attempts = d.attempts; $("unlock").disabled = false; $("k").value = ""; $("k").focus();
      $("mstat").textContent = `${d.error} ${d.max - d.attempts} left.`;
      $("panel").querySelector(".dots").outerHTML = dots(d.attempts);
    } else if (d._status === 423) {
      m.status = "locked"; panel(m); loadInbox();
      popup("Message locked", "Attempt 3/3. Someone tried to access this message, so it is now locked and the sender has been alerted.");
    } else { $("unlock").disabled = false; $("mstat").textContent = d.error || "Something went wrong."; }
  };
  $("unlock").onclick = go;
  $("k").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

/* ---------- qubit map ---------- */
let STATES = [];
async function loadLearn() {
  if (!STATES.length) STATES = await api("/states");
  $("grid-all").innerHTML = STATES.map(s => card(s, s.n + " = ")).join("");
  const run = () => {
    const p = Math.min(15, Math.max(0, +$("pv").value || 0)), k = Math.min(15, Math.max(0, +$("kv").value || 0));
    $("play").innerHTML = `<div>${p.toString(2).padStart(4, "0")} XOR ${k.toString(2).padStart(4, "0")} = <b>${(p ^ k).toString(2).padStart(4, "0")}</b></div>` + card(STATES[p ^ k], "cipher ");
  };
  $("pv").oninput = $("kv").oninput = run; run();
}

/* ---------- alerts (real time) ---------- */
const KIND = {locked: "Locked", read: "Read", expired: "Expired"}, TOAST = {locked: "Message locked", read: "Message read", expired: "Message expired"};
const alertHTML = a => `<div class="alert ${a.kind}"><b>${KIND[a.kind] || a.kind}</b> ${esc(a.text)}<small>${when(a.time)} · message ${a.id}</small>${a.kind === "locked" ? `<button data-unlock="${a.id}">Unlock message</button>` : ""}</div>`;
async function loadAlerts() {
  const list = await api("/alerts?token=" + token);
  $("alert-list").innerHTML = list.length ? list.map(alertHTML).join("") : `<p class="lead">No alerts yet.</p>`;
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-unlock]"); if (!b) return;
  await api("/unlock/" + b.dataset.unlock, {token}); b.textContent = "Unlocked"; b.disabled = true;
});
function toast(a) {
  const t = document.createElement("div");
  t.className = "toast " + a.kind;
  t.innerHTML = `<b>${TOAST[a.kind] || "Alert"}</b><div>${esc(a.text)}</div><button>Dismiss</button>`;
  t.querySelector("button").onclick = () => t.remove();
  $("toasts").append(t);
  if (a.kind !== "locked") setTimeout(() => t.remove(), 8000);
}
const es = new EventSource("/events?token=" + token);
es.onmessage = e => {
  const a = JSON.parse(e.data); toast(a);
  if (!$("alert-list").closest("[hidden]")) loadAlerts(); else { unseen++; badge(); }
  loadStats(); if (!$("list").closest("[hidden]")) loadInbox();
};

/* ---------- step-by-step animation ---------- */
const bin = (n, w = 4) => n.toString(2).padStart(w, "0");
const nibsOf = s => [...new TextEncoder().encode(s)].flatMap(b => [b >> 4, b & 15]);
const chip = (top, bottom, cls = "") => `<span class="chip ${cls}"><b>${esc(top)}</b>${esc(bottom)}</span>`;
let wTimer = null, wStep = 0, wSteps = [];
async function wBuild() {
  const text = $("w-text").value || "Hi", key = $("w-key").value || "qubit";
  if (!STATES.length) STATES = await api("/states");
  const bytes = [...new TextEncoder().encode(text)], plain = nibsOf(text), kn = nibsOf(key);
  const cipher = plain.map((n, i) => n ^ kn[i % kn.length]);
  const lab = b => b > 32 && b < 127 ? String.fromCharCode(b) : "0x" + b.toString(16);
  const chips = h => `<div class="chips">${h}</div>`;
  wSteps = [
    ["Text becomes bytes", chips(bytes.map(b => chip(lab(b), bin(b, 8))).join(""))],
    ["Bytes split into 4-bit groups", chips(plain.map(n => chip(n.toString(16), bin(n))).join(""))],
    ["Each group is XORed with the next key group", chips(plain.map((n, i) => chip(`${bin(n)} ⊕ ${bin(kn[i % kn.length])}`, "= " + bin(cipher[i]), "x")).join(""))],
    ["Each result picks a qubit state", `<div class="grid">${cipher.map(c => card(STATES[c])).join("")}</div>`],
  ];
}
function wShow() {
  if (wStep >= wSteps.length) return;
  const [t, h] = wSteps[wStep++];
  $("w-out").insertAdjacentHTML("beforeend", `<div class="stage"><h2>Step ${wStep}: ${t}</h2>${h}</div>`);
  if (wStep >= wSteps.length) { clearInterval(wTimer); $("w-next").disabled = $("w-auto").disabled = true; }
}
async function wStart(auto) {
  clearInterval(wTimer); await wBuild(); wStep = 0; $("w-out").innerHTML = "";
  $("w-next").disabled = $("w-auto").disabled = false; wShow();
  if (auto) wTimer = setInterval(wShow, 1600);
}
$("w-start").onclick = () => wStart(false);
$("w-next").onclick = wShow;
$("w-auto").onclick = () => wStart(true);
$("w-next").disabled = true;

/* ---------- BB84 key exchange with an eavesdropper ---------- */
const rbits = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x & 1);
let bbKey = "";
function runBB84() {
  const n = +$("b-n").value, eve = $("b-eve").checked, sym = b => b ? "×" : "+";
  const aBit = rbits(n), aBas = rbits(n), eBas = rbits(n), bBas = rbits(n), r1 = rbits(n), r2 = rbits(n), rows = [];
  for (let i = 0; i < n; i++) {
    let bit = aBit[i], bas = aBas[i], eRead = null;
    if (eve) { eRead = eBas[i] === bas ? bit : r1[i]; bit = eRead; bas = eBas[i]; }   // Eve measures and resends
    rows.push({i, aBit: aBit[i], aBas: aBas[i], eBas: eBas[i], eRead, bBas: bBas[i], bRead: bBas[i] === bas ? bit : r2[i], match: aBas[i] === bBas[i]});
  }
  const sift = rows.filter(r => r.match);
  sift.forEach((r, k) => r.role = k % 2 ? "key" : "test");
  const test = sift.filter(r => r.role === "test"), keyRows = sift.filter(r => r.role === "key");
  const errors = test.filter(r => r.aBit !== r.bRead).length, rate = test.length ? errors / test.length : 0, caught = rate > 0.11;
  const bits = keyRows.map(r => r.aBit).join("");
  bbKey = caught ? "" : Array.from({length: Math.floor(bits.length / 4)}, (_, k) => parseInt(bits.slice(4 * k, 4 * k + 4), 2).toString(16)).join("");
  $("b-stats").innerHTML = [[n, "qubits sent"], [sift.length, "bases matched"], [test.length, "bits compared"], [errors, "errors found"], [Math.round(rate * 100) + "%", "error rate"]].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  $("b-verdict").className = caught ? "err" : "ok";
  $("b-verdict").textContent = caught ? `Eavesdropper detected. The error rate is ${Math.round(rate * 100)}%, above the 11% limit, so Alice and Bob throw this key away.`
    : eve ? "Eve was listening, but this run showed no errors, so she slipped through. This is rare. Run it again." : `No eavesdropper detected. The error rate is ${Math.round(rate * 100)}%, so the remaining matched bits become the shared key.`;
  $("b-key").innerHTML = bbKey ? `<p>Shared key: <code>${bbKey}</code></p><button id="b-use" class="primary">Use this key in Send</button>` : "";
  if ($("b-use")) $("b-use").onclick = () => { $("key-enc").value = bbKey; show("send"); };
  const head = ["#", "Alice bit", "Alice basis"].concat(eve ? ["Eve basis", "Eve read"] : [], ["Bob basis", "Bob bit", "Result"]);
  $("b-table").innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>` + rows.slice(0, 24).map(r =>
    `<tr class="${r.match && r.aBit !== r.bRead ? "bad-row" : ""}"><td>${r.i + 1}</td><td>${r.aBit}</td><td>${sym(r.aBas)}</td>${eve ? `<td>${sym(r.eBas)}</td><td>${r.eRead}</td>` : ""}<td>${sym(r.bBas)}</td><td>${r.bRead}</td><td>${!r.match ? "bases differ, dropped" : r.role === "test" ? "compared in public" : "kept for key"}</td></tr>`).join("");
  $("b-out").hidden = false;
}
$("b-n").oninput = () => $("b-n-v").textContent = $("b-n").value;
$("b-run").onclick = runBB84;

const PAGES = ["home", "send", "inbox", "learn", "watch", "bb84", "alerts"];
show(PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home");
setInterval(() => { if (!$("hero-sphere").closest("[hidden]")) loadStats(); }, 5000);
