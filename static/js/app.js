/* EVANDON - giao diện (SPA, định tuyến bằng #hash). Mỗi view ứng với chức năng (1)-(18) trong bảng yêu cầu. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = n => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + " đ";
const main = $("#main");
let ME, CATS, charts = [];
const stLabel = c => (CATS.status.find(s => s.code === c) || {}).name || c;
const badge = (c, label) => `<span class="pill st-${c}">${esc(label ?? stLabel(c))}</span>`;
const NEXT = {PENDING: ["CONFIRMED", "Nhận đơn"], CONFIRMED: ["IN_TRANSIT", "Bắt đầu giao"], IN_TRANSIT: ["ARRIVED", "Đã đến nơi"]};
const REQ = {PENDING: ["PENDING", "Chờ duyệt"], APPROVED: ["DELIVERED", "Đã duyệt"], REJECTED: ["CANCELLED", "Từ chối"]};
const ROLE = {customer: "Khách hàng", shipper: "Shipper", admin: "Admin"};
const LBL = {recv_name: "Người nhận", recv_phone: "SĐT nhận", recv_addr: "Địa chỉ nhận", qty: "Số lượng", weight: "Khối lượng"};
const IC = {dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  add: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 010 8"/>', tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1"/>',
  hist: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4M12 7v5l3 2"/>', db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'};
const MENU = {
  customer: [["dashboard", "Tổng quan", "dashboard"], ["new", "Tạo vận đơn", "add"], ["waybills", "Tra cứu & lịch sử", "list"], ["requests", "Yêu cầu của tôi", "inbox"]],
  shipper: [["dashboard", "Tổng quan", "dashboard"], ["waybills?st=PENDING", "Đơn chờ nhận", "inbox"], ["waybills", "Vận đơn của tôi", "list"], ["reports", "Thống kê & báo cáo", "chart"]],
  admin: [["dashboard", "Giám sát tổng hợp", "dashboard"], ["waybills", "Tất cả vận đơn", "list"], ["requests", "Yêu cầu hủy/điều chỉnh", "inbox"], ["reports", "Báo cáo", "chart"],
    ["users", "Người dùng", "users"], ["categories", "Danh mục", "tag"], ["audit", "Nhật ký thao tác", "hist"], ["backup", "Sao lưu & phục hồi", "db"]]};

async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {method, headers: {"Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body)});
  let d = {}; try { d = await r.json(); } catch (e) { d = {error: "Lỗi máy chủ"}; }
  if (r.status === 401) location = "/login";
  if (!r.ok) throw new Error(d.error || "Lỗi hệ thống");
  return d;
}
function toast(m, t = "ok") { const e = document.createElement("div"); e.className = "toast " + t; e.textContent = m; $("#toasts").append(e); setTimeout(() => e.remove(), 4200); }
function modal(title, body, onOk, okText = "Lưu") {   // hộp thoại dùng thẻ <dialog> gốc của trình duyệt
  const d = document.createElement("dialog"); d.className = "modal";
  d.innerHTML = `<form><header><b>${title}</b><button type="button" class="x" data-x>&times;</button></header><div class="mb">${body}</div><footer><button type="button" class="btn" data-x>Hủy</button><button class="btn pri">${okText}</button></footer></form>`;
  d.onclick = e => { if (e.target.dataset.x !== undefined) d.close(); };
  d.onclose = () => d.remove();
  $("form", d).onsubmit = async e => { e.preventDefault(); try { if (await onOk(d) !== false) d.close(); } catch (err) { toast(err.message, "err"); } };
  document.body.append(d); d.showModal(); return d;
}
const head = (t, s = "", r = "") => `<div class="ph"><div><h1>${t}</h1><p>${s}</p></div><div class="pa">${r}</div></div>`;
const readFile = f => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });

/* ===== Bảng dữ liệu: tìm kiếm, lọc, sắp xếp, phân trang, xuất Excel/PDF ===== */
function table(el, c) {
  const S = {q: "", f: {}, from: "", to: "", col: -1, dir: 1, page: 1, size: 10};
  const val = (r, col) => col.x ? col.x(r) : r[col.k];
  el.innerHTML = `<div class="tbar"><input class="inp" id="tq" placeholder="Tìm kiếm trong bảng...">` +
    (c.filters || []).map(f => `<select class="inp" data-f="${f.k}"><option value="">${f.label}: tất cả</option>${f.opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select>`).join("") +
    (c.dateKey ? `<input type="date" class="inp" id="tf" title="Từ ngày"><input type="date" class="inp" id="tt" title="Đến ngày">` : "") +
    `<span class="sp"></span><button class="btn" id="xl">Xuất Excel</button><button class="btn" id="pd">Xuất PDF</button></div>
    <div class="tw"><table class="tbl"><thead><tr>${c.cols.map((x, i) => `<th ${x.k ? `data-c="${i}" class="srt"` : ""}>${x.t}</th>`).join("")}</tr></thead><tbody></tbody></table></div><div class="tfoot"></div>`;
  const rows = () => {
    let a = c.rows.filter(r => (!S.q || c.cols.some(x => x.k && String(val(r, x) ?? "").toLowerCase().includes(S.q))) &&
      Object.entries(S.f).every(([k, v]) => !v || String(r[k]) === v) &&
      (!c.dateKey || ((!S.from || r[c.dateKey].slice(0, 10) >= S.from) && (!S.to || r[c.dateKey].slice(0, 10) <= S.to))));
    if (S.col >= 0) { const col = c.cols[S.col]; a = [...a].sort((p, q) => { const x = val(p, col), y = val(q, col); return (typeof x === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "vi")) * S.dir; }); }
    return a;
  };
  function draw() {
    const a = rows(), pages = Math.max(1, Math.ceil(a.length / S.size)); S.page = Math.min(S.page, pages);
    $("tbody", el).innerHTML = a.length ? a.slice((S.page - 1) * S.size, S.page * S.size).map(r => `<tr data-i="${c.rows.indexOf(r)}">${c.cols.map(x => `<td class="${x.cls || ""}">${x.f ? x.f(r) : esc(r[x.k])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${c.cols.length}" class="empty">Không có dữ liệu phù hợp</td></tr>`;
    el.querySelectorAll("th[data-c]").forEach(t => t.dataset.s = +t.dataset.c === S.col ? (S.dir > 0 ? "▲" : "▼") : "");
    $(".tfoot", el).innerHTML = `<span>${a.length} bản ghi</span><span class="sp"></span><button class="btn sm" data-p="${S.page - 1}" ${S.page <= 1 ? "disabled" : ""}>‹ Trước</button><span>Trang ${S.page}/${pages}</span><button class="btn sm" data-p="${S.page + 1}" ${S.page >= pages ? "disabled" : ""}>Sau ›</button>
      <select class="inp" id="ps">${[10, 25, 50].map(n => `<option ${n === S.size ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  }
  const exp = () => rows().map(r => Object.fromEntries(c.cols.filter(x => x.k).map(x => [x.t, val(r, x)])));
  el.oninput = e => { const i = e.target.id; if (i === "tq") S.q = e.target.value.toLowerCase(); else if (i === "tf") S.from = e.target.value; else if (i === "tt") S.to = e.target.value; else return; S.page = 1; draw(); };
  el.onchange = e => { if (e.target.dataset.f) { S.f[e.target.dataset.f] = e.target.value; S.page = 1; draw(); } else if (e.target.id === "ps") { S.size = +e.target.value; S.page = 1; draw(); } };
  el.onclick = e => {
    const p = e.target.closest("[data-p]"), th = e.target.closest("th[data-c]"), ab = e.target.closest("[data-act]"), tr = e.target.closest("tbody tr[data-i]");
    if (p) { S.page = +p.dataset.p; return draw(); }
    if (th) { const i = +th.dataset.c; S.dir = S.col === i ? -S.dir : 1; S.col = i; return draw(); }
    if (e.target.id === "xl") { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exp()), "Du lieu"); return XLSX.writeFile(wb, (c.name || "export") + ".xlsx"); }
    if (e.target.id === "pd") {   // PDF: mở bản in của trình duyệt, chọn "Lưu dưới dạng PDF" (giữ đúng font tiếng Việt)
      const d = exp(), h = Object.keys(d[0] || {}), w = window.open("", "_blank");
      w.document.write(`<html><head><meta charset="utf-8"><title>${esc(c.name)}</title><style>body{font:12px Arial}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#EEE}</style></head><body><h3>${esc(c.name)} - ${new Date().toLocaleString("vi-VN")}</h3><table><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr>${d.map(r => `<tr>${h.map(x => `<td>${esc(r[x])}</td>`).join("")}</tr>`).join("")}</table></body></html>`);
      w.document.close(); return w.print();
    }
    if (ab && tr) return c.onAct && c.onAct(ab.dataset.act, c.rows[+tr.dataset.i]);
    if (tr && c.onRow && !e.target.closest("a")) c.onRow(c.rows[+tr.dataset.i]);
  };
  draw();
}

/* ===== Cột bảng vận đơn dùng chung + nút thao tác nhanh trên từng dòng (giảm số lần click) ===== */
function actBtn(r) {
  if (ME.role === "shipper" && NEXT[r.status] && (r.status === "PENDING" || r.shipper === ME.username)) return `<button class="btn pri sm" data-act="next">${NEXT[r.status][1]}</button>`;
  if (ME.role === "customer" && r.status === "ARRIVED") return `<button class="btn ok sm" data-act="confirm">Xác nhận nhận hàng</button>`;
  return "";
}
const wbCols = () => [
  {k: "code", t: "Mã vận đơn", f: r => `<a class="lk" href="#/waybills/${r.code}">${r.code}</a>`},
  {k: "recv_name", t: "Người nhận", f: r => `${esc(r.recv_name)}<div class="sub">${esc(r.recv_addr)}</div>`},
  {k: "goods_name", t: "Hàng hóa", f: r => `${esc(r.goods_name)}<div class="sub">${esc(r.goods_type)} · SL ${r.qty}</div>`},
  {k: "weight", t: "KL (kg)", cls: "num"}, {k: "fee", t: "Cước phí", f: r => money(r.fee), cls: "num"},
  {k: "status", t: "Trạng thái", f: r => badge(r.status), x: r => stLabel(r.status)},
  {k: "created_at", t: "Ngày tạo", f: r => r.created_at.slice(0, 16)}, {t: "Thao tác", f: actBtn, cls: "act"}];

/* ===== Thao tác nghiệp vụ dùng ở cả bảng lẫn trang chi tiết ===== */
async function doAction(act, w) {
  try {
    if (act === "next") { await api(`/waybills/${w.code}/status`, "POST", {to: NEXT[w.status][0]}); toast(`${w.code}: ${NEXT[w.status][1]}`); return route(); }
    if (act === "confirm") {   // (9)(10) xác nhận nhận hàng, báo sự cố ngay trong lúc xác nhận
      const d = modal("Xác nhận nhận hàng " + w.code, `<p>Xác nhận bạn đã nhận được hàng. Nếu hàng có vấn đề, hãy báo cáo sự cố cùng lúc.</p><label class="chk"><input type="checkbox" id="hi"> Báo cáo sự cố</label>
        <div id="ib" hidden class="mb" style="padding:0"><label>Loại sự cố<select id="ik"><option>Hư hỏng</option><option>Thiếu hàng</option><option>Giao chậm</option></select></label><label>Mô tả<textarea id="idc" rows="3" placeholder="Mô tả tình trạng hàng hóa"></textarea></label><label>Ảnh (tùy chọn)<input type="file" id="ii" accept="image/*"></label></div>`,
        async d => { const b = {}; if ($("#hi", d).checked) { const f = $("#ii", d).files[0]; b.incident = {kind: $("#ik", d).value, descr: $("#idc", d).value, image: f ? await readFile(f) : ""}; }
          await api(`/waybills/${w.code}/confirm`, "POST", b); toast("Đã xác nhận nhận hàng"); route(); }, "Xác nhận đã nhận hàng");
      $("#hi", d).onchange = e => $("#ib", d).hidden = !e.target.checked; return;
    }
    if (act === "cancel") return modal("Yêu cầu hủy vận đơn " + w.code, `<label>Lý do hủy<textarea id="rs" rows="3" placeholder="Nhập lý do"></textarea></label>`,
      async d => { await api(`/waybills/${w.code}/request`, "POST", {kind: "cancel", reason: $("#rs", d).value}); toast("Đã gửi yêu cầu hủy"); route(); }, "Gửi yêu cầu");
    if (act === "adjust") return modal("Yêu cầu điều chỉnh " + w.code, Object.keys(LBL).map(k => `<label>${LBL[k]}<input id="a_${k}" value="${esc(w[k])}"></label>`).join(""),
      async d => { const f = {}; Object.keys(LBL).forEach(k => { if ($("#a_" + k, d).value.trim() !== String(w[k])) f[k] = $("#a_" + k, d).value; }); await api(`/waybills/${w.code}/request`, "POST", {kind: "adjust", fields: f}); toast("Đã gửi yêu cầu điều chỉnh"); route(); }, "Gửi yêu cầu");
  } catch (e) { toast(e.message, "err"); }
}

/* ===== (17)(13) Khối thống kê: thẻ KPI có đường xu hướng, so sánh kỳ trước, biểu đồ cột + biểu đồ tròn ===== */
const ICN = {box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  truck: '<path d="M1 6h13v10H1zM14 10h5l4 4v2h-9"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>', check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', dollar: '<path d="M12 3v18M16 7.5c-.8-1.3-2.2-2-4-2-2.4 0-4 1.2-4 3s1.5 2.5 4 3 4 1.2 4 3-1.6 3-4 3c-1.9 0-3.4-.8-4.2-2.2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'};
const ico = n => `<svg viewBox="0 0 24 24">${ICN[n]}</svg>`;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const RANGES = {month: ["Tháng này", () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; }],
  last: ["Tháng trước", () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)]; }],
  d7: ["7 ngày qua", () => { const t = new Date(); return [new Date(t.getTime() - 6 * 864e5), t]; }],
  d30: ["30 ngày qua", () => { const t = new Date(); return [new Date(t.getTime() - 29 * 864e5), t]; }], all: ["Tất cả", () => [null, null]]};
let dashRange = "month";

// Tính toán thuần (không đụng DOM): lọc theo kỳ, lấy kỳ trước cùng độ dài để so sánh, danh sách ngày cho biểu đồ
function calcStats(all, from, to) {
  const inR = (r, f, t) => (!f || r.created_at.slice(0, 10) >= f) && (!t || r.created_at.slice(0, 10) <= t);
  let prev = null;
  if (from && to) {
    const f0 = new Date(from + "T00:00:00"), t0 = new Date(to + "T00:00:00"), n = Math.round((t0 - f0) / 864e5) + 1;
    const pt = new Date(f0.getTime() - 864e5), pf = new Date(pt.getTime() - (n - 1) * 864e5);
    prev = all.filter(r => inR(r, ymd(pf), ymd(pt)));
  }
  const end = to ? new Date(to + "T00:00:00") : new Date(); end.setHours(0, 0, 0, 0);
  let start = from ? new Date(from + "T00:00:00") : null; if (!start || (end - start) / 864e5 > 29) start = new Date(end.getTime() - 29 * 864e5);
  const days = []; for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) days.push(ymd(d));
  return {rows: all.filter(r => inR(r, from, to)), prev, days};
}
const spark = (v, w = 92, h = 34) => { const m = Math.max(1, ...v); return `<svg class="spk" viewBox="0 0 ${w} ${h}"><polyline points="${v.map((x, i) => `${(i / Math.max(1, v.length - 1) * w).toFixed(1)},${(h - 4 - x / m * (h - 10)).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
const miniBars = v => { const m = Math.max(1, ...v); return `<svg class="mb" viewBox="0 0 70 40">${v.map((x, i) => `<rect x="${i * 10}" y="${40 - Math.max(3, x / m * 38)}" width="7" height="${Math.max(3, x / m * 38)}" rx="2"/>`).join("")}</svg>`; };

async function statsView(el, from = "", to = "", all) {
  all = all || await api("/waybills"); const {rows, prev, days} = calcStats(all, from, to), tail = days.slice(-14);
  const byDay = {}; rows.forEach(r => (byDay[r.created_at.slice(0, 10)] ||= []).push(r));
  const cnt = (a, ...s) => a.filter(r => s.includes(r.status)).length, fee = a => a.filter(r => r.status === "DELIVERED").reduce((s, r) => s + r.fee, 0);
  const delta = (c, p) => { if (!prev) return `<div class="kd"><small>Toàn thời gian</small></div>`; if (!p) return `<div class="kd">${c ? "<b class='up'>Mới phát sinh</b>" : "<small>Chưa có dữ liệu kỳ trước</small>"}</div>`;
    const pc = Math.round((c - p) / p * 100); return `<div class="kd"><b class="${pc > 0 ? "up" : pc < 0 ? "dn" : ""}">${pc > 0 ? "↑" : pc < 0 ? "↓" : "–"} ${Math.abs(pc)}%</b><small>so với kỳ trước</small></div>`; };
  const K = [["Tổng vận đơn", a => a.length, "blue", "box"], ["Chờ xử lý", a => cnt(a, "PENDING", "CONFIRMED"), "purple", "clock"], ["Đang vận chuyển", a => cnt(a, "IN_TRANSIT", "ARRIVED"), "orange", "truck"],
    ["Đã giao", a => cnt(a, "DELIVERED"), "green", "check"], ["Đã hủy", a => cnt(a, "CANCELLED"), "red", "x"]];
  const revDays = days.slice(-7).map(d => fee(byDay[d] || [])), rev = fee(rows), pRev = prev ? fee(prev) : 0;
  el.innerHTML = `<div class="kpis5">${K.map(([t, f, c, i]) => { const cur = f(rows); return `<div class="kc c-${c}"><div class="kh"><span class="ico">${ico(i)}</span>${t}</div>
      <div class="kb"><b>${cur}</b>${spark(tail.map(d => f(byDay[d] || [])))}</div>${delta(cur, prev ? f(prev) : 0)}</div>`; }).join("")}
    <div class="kc rev c-blue"><div class="kh"><span class="ico">${ico("dollar")}</span>Doanh thu (đã giao)</div><div class="kb"><b>${money(rev)}</b>${delta(rev, pRev)}${miniBars(revDays)}</div></div></div>
    <div class="charts"><div class="card"><div class="ch"><h3><span class="ico sm">${ico("box")}</span>Vận đơn tạo mới theo ngày</h3></div><div class="cb"><canvas id="c1"></canvas></div></div>
    <div class="card"><div class="ch"><h3><span class="ico sm">${ico("chart")}</span>Cơ cấu trạng thái</h3></div><div class="dn"><div class="cb2"><canvas id="c2"></canvas></div><ul class="lg2" id="lg2"></ul></div></div></div>`;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  const grad = c => { const a = c.chart.chartArea; if (!a) return "#2F6FDE"; const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, "#4C8DFF"); g.addColorStop(1, "#1E4FC4"); return g; };
  charts.push(new Chart($("#c1"), {type: "bar", data: {labels: days.map(d => d.slice(5)), datasets: [{data: days.map(d => (byDay[d] || []).length), backgroundColor: grad, borderRadius: 4, maxBarThickness: 28}]},
    options: {responsive: true, maintainAspectRatio: false, plugins: {legend: {display: false}, tooltip: {callbacks: {label: c => c.parsed.y + " vận đơn"}}}, scales: {x: {grid: {display: false}}, y: {beginAtZero: true, ticks: {precision: 0}, grid: {color: "#EEF2F8"}}}}}));
  const COL = {PENDING: "#7C5CE0", CONFIRMED: "#2F6FDE", IN_TRANSIT: "#F59E0B", ARRIVED: "#FBBF77", DELIVERED: "#1FA463", CANCELLED: "#E5484D"};
  const sts = CATS.status.map(s => ({...s, n: cnt(rows, s.code)})).filter(s => s.n), total = rows.length;
  $("#lg2").innerHTML = sts.map(s => `<li><span><i style="background:${COL[s.code]}"></i>${esc(s.name)}</span><b>${s.n}</b></li>`).join("") || `<li class="sub">Chưa có dữ liệu</li>`;
  const center = {id: "center", afterDraw(ch) { const a = ch.chartArea, x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2, c = ch.ctx; c.save(); c.textAlign = "center";
    c.fillStyle = "#6B7A99"; c.font = "13px Inter"; c.fillText("Tổng", x, y - 16); c.fillStyle = "#0B2A6B"; c.font = "700 28px Inter"; c.fillText(total, x, y + 14); c.fillStyle = "#6B7A99"; c.font = "12px Inter"; c.fillText("vận đơn", x, y + 32); c.restore(); }};
  const pct = {id: "pct", afterDatasetsDraw(ch) { const d = ch.data.datasets[0].data, c = ch.ctx; c.save(); c.fillStyle = "#fff"; c.font = "600 12px Inter"; c.textAlign = "center"; c.textBaseline = "middle";
    ch.getDatasetMeta(0).data.forEach((arc, i) => { const p = Math.round(d[i] / total * 100); if (p >= 5) { const q = arc.tooltipPosition(); c.fillText(p + "%", q.x, q.y); } }); c.restore(); }};
  charts.push(new Chart($("#c2"), {type: "doughnut", plugins: [center, pct], data: {labels: sts.map(s => s.name), datasets: [{data: sts.map(s => s.n), backgroundColor: sts.map(s => COL[s.code]), borderColor: "#fff", borderWidth: 2}]},
    options: {responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: {legend: {display: false}}}}));
}
const rowNav = {onRow: r => location.hash = "#/waybills/" + r.code, onAct: doAction};

async function vDash() {
  const rows = await api("/waybills"), pend = rows.filter(r => r.status === "PENDING").length;
  const quick = {customer: `<a class="btn pri" href="#/new">+ Tạo vận đơn</a>`, shipper: `<a class="btn pri" href="#/waybills?st=PENDING">Nhận đơn mới (${pend})</a>`, admin: `<a class="btn pri" href="#/requests">Yêu cầu chờ duyệt</a>`}[ME.role];
  const today = new Date().toLocaleDateString("vi-VN", {weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"});
  main.innerHTML = `<div class="ph hello"><div class="hi"><span class="wave">👋</span><div><h1>Chào mừng, ${esc(ME.full_name)}!</h1><p>Hệ thống quản lý vận đơn E-Logistics – Kết nối hàng hóa, vươn xa cùng bạn.</p></div></div>
    <div class="pa">${quick}<span class="chip"><span class="ci">${ico("cal")}</span>${today}</span><select class="inp rng" id="rng" aria-label="Khoảng thời gian">${Object.entries(RANGES).map(([k, v]) => `<option value="${k}" ${k === dashRange ? "selected" : ""}>${v[0]}</option>`).join("")}</select></div></div>
    <div id="st"></div><div class="card"><h3>Vận đơn gần đây</h3><div id="rt"></div></div>`;
  const draw = async () => { charts.forEach(c => c.destroy()); charts = []; const [f, t] = RANGES[dashRange][1](); await statsView($("#st"), f ? ymd(f) : "", t ? ymd(t) : "", rows); };
  $("#rng").onchange = e => { dashRange = e.target.value; draw().catch(err => toast(err.message, "err")); };
  await draw(); table($("#rt"), {rows: rows.slice(0, 60), cols: wbCols(), name: "Van-don-gan-day", ...rowNav});
}

/* (4)(5) Tra cứu & lịch sử vận đơn */
async function vList(p) {
  const rows = await api("/waybills");
  main.innerHTML = head("Tra cứu & lịch sử vận đơn", "Tìm theo mã hoặc từ khóa, lọc theo thời gian và trạng thái", ME.role === "customer" ? `<a class="btn pri" href="#/new">+ Tạo vận đơn</a>` : "") + `<div class="card" id="t"></div>`;
  table($("#t"), {rows, cols: wbCols(), name: "Van-don", dateKey: "created_at", filters: [{k: "status", label: "Trạng thái", opts: CATS.status.map(s => [s.code, s.name])}], ...rowNav});
  if (p.get("q")) { $("#tq").value = p.get("q"); $("#tq").dispatchEvent(new Event("input", {bubbles: true})); }
  if (p.get("st")) { const s = $('select[data-f="status"]'); s.value = p.get("st"); s.dispatchEvent(new Event("change", {bubbles: true})); }
}

/* (6) Chi tiết + timeline */
async function vDetail(code) {
  const d = await api("/waybills/" + code), w = d.waybill, FLOW = ["PENDING", "CONFIRMED", "IN_TRANSIT", "ARRIVED", "DELIVERED"], at = FLOW.indexOf(w.status);
  const label = {next: NEXT[w.status] ? NEXT[w.status][1] : "", confirm: "Xác nhận nhận hàng", adjust: "Yêu cầu điều chỉnh", cancel: "Yêu cầu hủy"};
  main.innerHTML = head(`${w.code} ${badge(w.status)}`, `Tạo lúc ${w.created_at}` + (d.shipper ? ` · Shipper: ${esc(d.shipper.full_name)} (${esc(d.shipper.phone)})` : " · Chưa có shipper nhận"),
    `<a class="btn" href="#/waybills">‹ Danh sách</a><button class="btn" onclick="print()">In</button>` + d.actions.map(a => `<button class="btn ${a === "cancel" ? "dng" : a === "confirm" ? "ok" : "pri"}" data-act="${a}">${label[a]}</button>`).join("")) +
    `<div class="card">${w.status === "CANCELLED" ? `<div class="alert">Vận đơn này đã bị hủy.</div>` : `<div class="steps">${FLOW.map((s, i) => `<div class="step ${i < at ? "done" : i === at ? "now" : ""}"><i>${i < at ? "✓" : i + 1}</i>${stLabel(s)}</div>`).join("")}</div>`}</div>
    <div class="card"><div class="kv"><div><small>Người gửi</small><b>${esc(w.sender_name)}</b><br>${esc(w.sender_phone)}<br>${esc(w.sender_addr)}</div>
    <div><small>Người nhận</small><b>${esc(w.recv_name)}</b><br>${esc(w.recv_phone)}<br>${esc(w.recv_addr)}</div>
    <div><small>Hàng hóa</small><b>${esc(w.goods_name)}</b> (${esc(w.goods_type)})<br>SL ${w.qty} · ${w.weight} kg<br>Giá trị ${money(w.value)}</div><div><small>Cước phí</small><b>${money(w.fee)}</b></div></div></div>
    <div class="g2c"><div class="card"><h3>Hành trình vận chuyển</h3><div class="tl">${d.history.map(h => `<div class="tl-i"><i class="dot st-${h.status}"></i><b>${stLabel(h.status)}</b> <span class="sub">${h.at} · ${esc(h.actor)}</span><div>${esc(h.note)}</div></div>`).join("")}</div></div>
    <div><div class="card"><h3>Sự cố đã báo cáo</h3>${d.incidents.map(i => `<div class="inc"><b>${esc(i.kind)}</b> <span class="sub">${i.at}</span><br>${esc(i.descr)}${i.image ? `<br><img src="${i.image}" alt="Ảnh sự cố">` : ""}</div>`).join("") || `<span class="sub">Không có</span>`}</div>
    <div class="card"><h3>Yêu cầu hủy / điều chỉnh</h3>${d.requests.map(r => `<div>${r.kind === "cancel" ? "Hủy" : "Điều chỉnh"} ${badge(...REQ[r.status])} <span class="sub">${r.at}</span><br>${esc(reqText(r))}</div>`).join("") || `<span class="sub">Không có</span>`}</div></div></div>`;
  $(".pa").onclick = e => { const b = e.target.closest("[data-act]"); if (b) doAction(b.dataset.act, w); };
}
const reqText = r => r.kind === "cancel" ? r.detail : Object.entries(JSON.parse(r.detail)).map(([k, v]) => `${LBL[k]}: ${v}`).join("; ");

/* (7)(8) Khai báo hàng hóa + gửi yêu cầu: lưới nhập nhanh nhiều dòng */
const FIELDS = [["recv_name", "Người nhận *", "text"], ["recv_phone", "SĐT *", "tel"], ["recv_addr", "Địa chỉ nhận *", "text"], ["goods_name", "Tên hàng *", "text"], ["goods_type", "Loại *", "select"], ["qty", "SL", "number"], ["weight", "KL (kg) *", "number"], ["value", "Giá trị (đ)", "number"]];
const gridRow = () => `<tr>${FIELDS.map(([k, , t]) => `<td>${t === "select" ? `<select class="g" data-k="${k}">${CATS.goods_type.map(c => `<option>${esc(c.name)}</option>`).join("")}</select>` : `<input class="g" data-k="${k}" type="${t}" ${t === "number" ? 'min="0" step="any"' : ""} placeholder="${k === "qty" ? "1" : ""}">`}</td>`).join("")}<td><button class="x" tabindex="-1" title="Xóa dòng">×</button></td></tr>`;
function vNew() {
  main.innerHTML = head("Tạo vận đơn", "Khai báo hàng hóa và gửi yêu cầu vận chuyển. Trạng thái ban đầu: Chờ xác nhận") +
    `<div class="card"><h3>Người gửi</h3><div class="g3"><label>Họ tên / đơn vị *<input id="sn" value="${esc(ME.full_name)}"></label><label>SĐT *<input id="sp" value="${esc(ME.phone)}"></label><label>Địa chỉ lấy hàng *<input id="sa" value="${esc(ME.address)}"></label></div></div>
    <div class="card"><div class="ph" style="margin-bottom:6px"><h3>Hàng hóa và người nhận <span class="sub" id="cnt"></span></h3><button class="btn" id="add">+ Thêm dòng</button></div>
    <p class="hint">Mỗi dòng là một vận đơn. Enter/Tab: sang ô kế tiếp (ô cuối tự thêm dòng mới). Dán dữ liệu từ Excel (Ctrl+V) vào ô bất kỳ để điền nhiều dòng. Ctrl+Enter: gửi.</p>
    <div class="tw"><table class="tbl grid"><thead><tr>${FIELDS.map(f => `<th>${f[1]}</th>`).join("")}<th></th></tr></thead><tbody id="gb"></tbody></table></div></div>
    <div class="sticky"><span id="sum"></span><button class="btn ok" id="send">Gửi yêu cầu tạo vận đơn</button></div>`;
  const gb = $("#gb"), data = () => [...gb.rows].map(tr => Object.fromEntries([...tr.querySelectorAll(".g")].map(i => [i.dataset.k, i.value.trim()]))).filter(r => FIELDS.some(f => f[0] !== "goods_type" && r[f[0]]));
  const upd = () => { const d = data(); $("#sum").textContent = `${d.length} vận đơn · cước ước tính ${money(d.reduce((a, r) => a + 20000 + 6000 * (+r.weight || 0), 0))}`; };
  const addRow = () => { gb.insertAdjacentHTML("beforeend", gridRow()); return gb.lastElementChild; };
  for (let i = 0; i < 3; i++) addRow(); upd();
  $("#add").onclick = () => addRow().querySelector(".g").focus();
  gb.oninput = upd;
  gb.onclick = e => { if (e.target.classList.contains("x")) { e.target.closest("tr").remove(); if (!gb.rows.length) addRow(); upd(); } };
  gb.onkeydown = e => {
    const all = [...gb.querySelectorAll(".g")], i = all.indexOf(e.target);
    if (e.key === "Enter" && e.ctrlKey) return $("#send").click();
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey && i === all.length - 1)) { e.preventDefault(); (all[i + 1] || addRow().querySelector(".g")).focus(); }
  };
  gb.onpaste = e => {
    const t = e.clipboardData.getData("text"); if (!/[\t\n]/.test(t.trim())) return; e.preventDefault();
    let tr = e.target.closest("tr"); const c0 = [...tr.querySelectorAll(".g")].indexOf(e.target);
    t.trim().split(/\r?\n/).forEach((line, li) => {
      if (li) tr = tr.nextElementSibling || addRow();
      line.split("\t").forEach((v, ci) => { const el = tr.querySelectorAll(".g")[c0 + ci]; if (!el) return;
        if (el.tagName === "SELECT") { const o = [...el.options].find(o => o.text.toLowerCase() === v.trim().toLowerCase()); if (o) el.value = o.value; } else el.value = v.trim(); });
    }); upd();
  };
  $("#send").onclick = async () => {
    try { const r = await api("/waybills", "POST", {sender: {name: $("#sn").value, phone: $("#sp").value, addr: $("#sa").value}, items: data()});
      toast(`Đã gửi ${r.codes.length} yêu cầu vận đơn`); location.hash = "#/waybills?st=PENDING"; } catch (e) { toast(e.message, "err"); }
  };
}

/* (11) Yêu cầu hủy / điều chỉnh: khách hàng xem, admin duyệt */
async function vReq() {
  const rows = await api("/requests");
  main.innerHTML = head(ME.role === "admin" ? "Yêu cầu hủy / điều chỉnh" : "Yêu cầu của tôi", "Chỉ áp dụng cho vận đơn chưa vận chuyển") + `<div class="card" id="t"></div>`;
  table($("#t"), {rows, name: "Yeu-cau", dateKey: "at", filters: [{k: "status", label: "Trạng thái", opts: [["PENDING", "Chờ duyệt"], ["APPROVED", "Đã duyệt"], ["REJECTED", "Từ chối"]]}], onRow: r => location.hash = "#/waybills/" + r.code,
    cols: [{k: "code", t: "Vận đơn", f: r => `<a class="lk" href="#/waybills/${r.code}">${r.code}</a>`}, {k: "kind", t: "Loại", f: r => r.kind === "cancel" ? "Hủy vận đơn" : "Điều chỉnh", x: r => r.kind === "cancel" ? "Hủy vận đơn" : "Điều chỉnh"},
      {k: "detail", t: "Nội dung", f: r => esc(reqText(r)), x: reqText}, {k: "by_user", t: "Người gửi"}, {k: "at", t: "Thời gian"},
      {k: "status", t: "Trạng thái", f: r => badge(...REQ[r.status]), x: r => REQ[r.status][1]},
      {t: "Xử lý", cls: "act", f: r => ME.role === "admin" && r.status === "PENDING" ? `<button class="btn ok sm" data-act="ok">Duyệt</button> <button class="btn dng sm" data-act="no">Từ chối</button>` : ""}],
    onAct: async (a, r) => { try { await api(`/requests/${r.id}/decide`, "POST", {approve: a === "ok"}); toast(a === "ok" ? "Đã duyệt yêu cầu" : "Đã từ chối yêu cầu"); route(); } catch (e) { toast(e.message, "err"); } }});
}

/* (13) Thống kê, báo cáo có xuất file */
async function vReport() {
  const iso = d => d.toISOString().slice(0, 10), t = new Date();
  main.innerHTML = head("Thống kê & báo cáo vận đơn", "Chọn khoảng thời gian, xuất Excel/PDF ở bảng chi tiết") +
    `<div class="card tbar"><label>Từ ngày<input type="date" id="rf" value="${iso(new Date(t - 29 * 864e5))}"></label><label>Đến ngày<input type="date" id="rt2" value="${iso(t)}"></label><button class="btn pri" id="go" style="margin-top:16px">Xem báo cáo</button></div><div id="st"></div><div class="card"><h3>Chi tiết vận đơn</h3><div id="rt"></div></div>`;
  const run = async () => {
    charts.forEach(c => c.destroy()); charts = []; const f = $("#rf").value, to = $("#rt2").value;
    await statsView($("#st"), f, to);
    const rows = (await api("/waybills")).filter(r => (!f || r.created_at.slice(0, 10) >= f) && (!to || r.created_at.slice(0, 10) <= to));
    table($("#rt"), {rows, cols: wbCols(), name: `Bao-cao-van-don_${f}_${to}`, filters: [{k: "status", label: "Trạng thái", opts: CATS.status.map(s => [s.code, s.name])}], ...rowNav});
  };
  $("#go").onclick = () => run().catch(e => toast(e.message, "err")); run();
}

/* (14) Quản lý người dùng */
async function vUsers() {
  const rows = await api("/users");
  main.innerHTML = head("Quản lý người dùng", "Thêm, sửa, khóa/mở khóa tài khoản và gán vai trò", `<button class="btn pri" id="nu">+ Thêm người dùng</button>`) + `<div class="card" id="t"></div>`;
  const form = u => `<div class="g2"><label>Tên đăng nhập<input id="fu" value="${esc(u.username || "")}" ${u.username ? "disabled" : ""}></label>
    <label>Vai trò<select id="fr">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label>Họ tên<input id="fn" value="${esc(u.full_name || "")}"></label><label>SĐT<input id="fp" value="${esc(u.phone || "")}"></label><label>Email<input id="fe" value="${esc(u.email || "")}"></label>
    <label>${u.username ? "Mật khẩu mới (bỏ trống nếu giữ)" : "Mật khẩu"}<input id="fw" type="password"></label></div>`;
  const save = async (d, u) => { const b = {role: $("#fr", d).value, full_name: $("#fn", d).value, phone: $("#fp", d).value, email: $("#fe", d).value, password: $("#fw", d).value};
    if (!u) b.username = $("#fu", d).value; await api(u ? "/users/" + u.username : "/users", u ? "PUT" : "POST", b); toast("Đã lưu"); route(); };
  $("#nu").onclick = () => modal("Thêm người dùng", form({}), d => save(d));
  table($("#t"), {rows, name: "Nguoi-dung", filters: [{k: "role", label: "Vai trò", opts: Object.entries(ROLE)}],
    cols: [{k: "username", t: "Tài khoản"}, {k: "full_name", t: "Họ tên"}, {k: "role", t: "Vai trò", f: r => ROLE[r.role], x: r => ROLE[r.role]}, {k: "phone", t: "SĐT"}, {k: "email", t: "Email"},
      {k: "active", t: "Trạng thái", f: r => r.active ? badge("ACTIVE", "Hoạt động") : badge("LOCKED", "Đã khóa"), x: r => r.active ? "Hoạt động" : "Đã khóa"},
      {t: "Thao tác", cls: "act", f: r => `<button class="btn sm" data-act="ed">Sửa</button> <button class="btn sm ${r.active ? "dng" : ""}" data-act="lk">${r.active ? "Khóa" : "Mở khóa"}</button>`}],
    onAct: async (a, r) => { if (a === "ed") return modal("Sửa người dùng " + r.username, form(r), d => save(d, r));
      try { await api("/users/" + r.username, "PUT", {active: r.active ? 0 : 1}); toast("Đã cập nhật tài khoản"); route(); } catch (e) { toast(e.message, "err"); } }});
}

/* (16) Quản lý danh mục */
async function vCats() {
  const KINDS = [["goods_type", "Loại hàng hóa"], ["carrier", "Đơn vị vận chuyển"], ["status", "Trạng thái vận đơn"]]; let kind = "goods_type";
  const draw = async () => {
    CATS = (await api("/me")).cats;
    main.innerHTML = head("Quản lý danh mục", "Dữ liệu dùng cho form tạo vận đơn và nhãn trạng thái", kind !== "status" ? `<button class="btn pri" id="ca">+ Thêm</button>` : "") +
      `<div class="tabs">${KINDS.map(k => `<button class="${k[0] === kind ? "on" : ""}" data-k="${k[0]}">${k[1]}</button>`).join("")}</div><div class="card" id="t"></div>`;
    $(".tabs").onclick = e => { const b = e.target.closest("[data-k]"); if (b) { kind = b.dataset.k; draw(); } };
    if ($("#ca")) $("#ca").onclick = () => modal("Thêm danh mục", `<label>Tên<input id="cn"></label>`, async d => { await api("/categories", "POST", {kind, name: $("#cn", d).value}); toast("Đã thêm"); draw(); });
    table($("#t"), {rows: CATS[kind] || [], name: kind, cols: [{k: "name", t: "Tên"}, ...(kind === "status" ? [{k: "code", t: "Mã hệ thống"}] : []),
      {t: "Thao tác", cls: "act", f: () => `<button class="btn sm" data-act="ed">Đổi tên</button>` + (kind !== "status" ? ` <button class="btn dng sm" data-act="del">Xóa</button>` : "")}],
      onAct: async (a, r) => { if (a === "ed") return modal("Đổi tên", `<label>Tên<input id="cn" value="${esc(r.name)}"></label>`, async d => { await api("/categories/" + r.id, "PUT", {name: $("#cn", d).value}); toast("Đã lưu"); draw(); });
        if (confirm("Xóa danh mục này?")) try { await api("/categories/" + r.id, "DELETE"); toast("Đã xóa"); draw(); } catch (e) { toast(e.message, "err"); } }});
  };
  draw();
}

/* (15) Nhật ký thao tác */
async function vAudit() {
  const rows = await api("/audit");
  main.innerHTML = head("Nhật ký thao tác", "Ai - làm gì - lúc nào (1000 thao tác gần nhất)") + `<div class="card" id="t"></div>`;
  table($("#t"), {rows, name: "Nhat-ky-thao-tac", dateKey: "at", cols: [{k: "at", t: "Thời gian"}, {k: "actor", t: "Người dùng"}, {k: "action", t: "Hành động"}, {k: "target", t: "Đối tượng"}]});
}

/* (18) Sao lưu & phục hồi */
async function vBackup() {
  const d = await api("/backups");
  main.innerHTML = head("Sao lưu & phục hồi dữ liệu", "Sao lưu thủ công hoặc theo lịch; phục hồi sẽ tự sao lưu trạng thái hiện tại trước khi ghi đè", `<button class="btn pri" id="bk">Sao lưu ngay</button>`) +
    `<div class="card"><h3>Sao lưu theo lịch</h3><label style="max-width:260px">Chu kỳ<select id="sch">${[[0, "Tắt"], [6, "Mỗi 6 giờ"], [12, "Mỗi 12 giờ"], [24, "Mỗi ngày"]].map(([h, t]) => `<option value="${h}" ${d.schedule.hours === h ? "selected" : ""}>${t}</option>`).join("")}</select></label></div><div class="card" id="t"></div>`;
  $("#bk").onclick = async () => { try { await api("/backups", "POST"); toast("Đã sao lưu dữ liệu"); route(); } catch (e) { toast(e.message, "err"); } };
  $("#sch").onchange = async e => { await api("/backups/schedule", "POST", {hours: +e.target.value}); toast("Đã lưu lịch sao lưu"); };
  table($("#t"), {rows: d.items, name: "Ban-sao-luu", cols: [{k: "name", t: "Tên tệp"}, {k: "kb", t: "Dung lượng (KB)", cls: "num"}, {k: "at", t: "Thời gian"},
    {t: "Thao tác", cls: "act", f: r => `<a class="btn sm" href="/api/backups/${r.name}">Tải về</a> <button class="btn dng sm" data-act="rs">Phục hồi</button>`}],
    onAct: async (a, r) => { if (!confirm(`Phục hồi dữ liệu từ ${r.name}?\nDữ liệu hiện tại sẽ được sao lưu trước khi ghi đè.`)) return;
      try { await api("/backups/restore", "POST", {name: r.name}); toast("Đã phục hồi dữ liệu"); route(); } catch (e) { toast(e.message, "err"); } }});
}

/* (2) Hồ sơ cá nhân */
function vProfile() {
  main.innerHTML = head("Hồ sơ cá nhân", `Tài khoản: ${esc(ME.username)} · Vai trò: ${ROLE[ME.role]}`) + `<div class="g2c"><div class="card"><h3>Thông tin cá nhân</h3><div class="g2">
    <label>Họ tên<input id="pn" value="${esc(ME.full_name)}"></label><label>SĐT<input id="pp" value="${esc(ME.phone)}"></label><label>Email<input id="pe" value="${esc(ME.email)}"></label><label>Địa chỉ<input id="pa" value="${esc(ME.address)}"></label></div>
    <p><button class="btn pri" id="ps">Lưu thay đổi</button></p></div><div class="card"><h3>Đổi mật khẩu</h3><div style="display:grid;gap:12px"><label>Mật khẩu hiện tại<input type="password" id="o"></label>
    <label>Mật khẩu mới (tối thiểu 6 ký tự)<input type="password" id="n"></label><label>Nhập lại mật khẩu mới<input type="password" id="n2"></label></div><p><button class="btn pri" id="pc">Đổi mật khẩu</button></p></div></div>`;
  $("#ps").onclick = async () => { try { const b = {full_name: $("#pn").value, phone: $("#pp").value, email: $("#pe").value, address: $("#pa").value}; await api("/profile", "PUT", b); Object.assign(ME, b); $("#ub").innerHTML = userBtn(); toast("Đã cập nhật hồ sơ"); } catch (e) { toast(e.message, "err"); } };
  $("#pc").onclick = async () => { if ($("#n").value !== $("#n2").value) return toast("Mật khẩu nhập lại không khớp", "err");
    try { await api("/password", "POST", {old: $("#o").value, new: $("#n").value}); toast("Đã đổi mật khẩu"); ["o", "n", "n2"].forEach(i => $("#" + i).value = ""); } catch (e) { toast(e.message, "err"); } };
}

/* ===== Định tuyến, thông báo, khung giao diện ===== */
const CUBE = '<svg class="cube" width="42" height="42" viewBox="0 0 40 40"><path d="M20 3l15 8.5v17L20 37 5 28.5v-17z" fill="#2F6FDE"/><path d="M20 3l15 8.5L20 20 5 11.5z" fill="#7FB0FF"/><path d="M20 20v17L5 28.5v-17z" fill="#1D4ED8"/><path d="M20 20v17l15-8.5v-17z" fill="#2B63D9"/></svg>';
const initials = n => n.trim().split(/\s+/).slice(-2).map(w => w[0]).join("").toUpperCase();   // "Trần Văn Giao" -> "VG"
const userBtn = () => `<span class="av">${esc(initials(ME.full_name))}</span><span class="un">${esc(ME.full_name)}<small>${ROLE[ME.role]}</small></span><span class="sub">▾</span>`;

const ROUTES = {dashboard: vDash, waybills: vList, new: vNew, requests: vReq, reports: vReport, users: vUsers, categories: vCats, audit: vAudit, backup: vBackup, profile: vProfile};
async function route() {
  const cur = location.hash.slice(2) || "dashboard", [path, qs] = cur.split("?"), [name, arg] = path.split("/");
  const ok = (MENU[ME.role] || []).map(m => m[0].split("?")[0]).concat("profile");
  charts.forEach(c => c.destroy()); charts = []; $("#side").classList.remove("open");
  document.querySelectorAll("aside nav a").forEach(a => a.classList.toggle("on", a.dataset.r === cur || (a.dataset.r.split("?")[0] === name && !MENU[ME.role].some(m => m[0] === cur))));
  try {
    if (name === "waybills" && arg) await vDetail(arg);
    else if (ROUTES[name] && ok.includes(name)) await ROUTES[name](new URLSearchParams(qs || ""));
    else location.hash = "#/dashboard";
  } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
async function loadNoti() {
  const set = (ok, t) => { const s = $("#sys"); if (s) { s.classList.toggle("off", !ok); $("#sst").textContent = t; } };
  try {
    const d = await api("/notifications"); $("#nb").textContent = d.unread; $("#nb").hidden = !d.unread;
    $("#nl").innerHTML = d.items.map(n => `<a class="ni ${n.is_read ? "" : "un"}" href="#/waybills/${n.code}">${esc(n.msg)}<small>${n.at.slice(5, 16)}</small></a>`).join("") || `<div class="empty">Chưa có thông báo</div>`;
    set(true, "Hệ thống hoạt động ổn định");
  } catch (e) { set(false, "Mất kết nối máy chủ"); }
}
(async () => {
  const m = await api("/me"); ME = m.user; CATS = m.cats;
  $("#side").innerHTML = `<div class="brand">${CUBE}<span>EVANDON<small>Logistics Management</small></span><button class="clp" id="clp" title="Thu gọn menu">«</button></div><nav>` +
    MENU[ME.role].map(([r, t, i]) => `<a href="#/${r}" data-r="${r}" title="${t}"><svg viewBox="0 0 24 24">${IC[i]}</svg><span>${t}</span></a>`).join("") +
    `</nav><div class="sys" id="sys"><i></i><div><span id="sst">Hệ thống hoạt động ổn định</span><small>v1.0.0</small></div></div>`;
  $("#clp").onclick = () => $("#app").classList.toggle("collapsed");
  $("#ub").innerHTML = userBtn();
  $("#burger").onclick = () => $("#side").classList.toggle("open");
  $("#gs").onkeydown = e => { if (e.key === "Enter" && e.target.value.trim()) location.hash = "#/waybills?q=" + encodeURIComponent(e.target.value.trim()); };
  $("#bell").onclick = () => { $("#np").hidden = !$("#np").hidden; $("#um").hidden = true; };
  $("#ub").onclick = () => { $("#um").hidden = !$("#um").hidden; $("#np").hidden = true; };
  $("#mr").onclick = async () => { await api("/notifications/read", "POST"); loadNoti(); };
  $("#lo").onclick = async e => { e.preventDefault(); await api("/logout", "POST"); location = "/login"; };
  document.addEventListener("click", e => { if (!e.target.closest(".pop")) { $("#np").hidden = $("#um").hidden = true; } else if (e.target.closest(".pp a")) $("#np").hidden = $("#um").hidden = true; });
  addEventListener("hashchange", route); route(); loadNoti(); setInterval(loadNoti, 30000);
})();
