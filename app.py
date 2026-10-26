"""
EVANDON - Hệ thống quản lý vận đơn điện tử nội địa (Flask + SQLite)
Actor: customer (Khách hàng), shipper, admin (Nhân viên vận đơn).  Chạy: python app.py
Số (1)-(18) ở chú thích là số thứ tự chức năng trong bảng yêu cầu.
"""
import os, re, json, random, sqlite3, time, uuid, threading
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, session, g, render_template, redirect, send_file
from werkzeug.security import generate_password_hash as hp, check_password_hash as cp

BASE = os.path.dirname(os.path.abspath(__file__)); DB = os.path.join(BASE, "evandon.db"); BK = os.path.join(BASE, "backups")
app = Flask(__name__)
app.secret_key = os.environ.get("EVD_SECRET", "dev-secret-doi-khi-trien-khai")
app.permanent_session_lifetime = timedelta(days=14)

ROLES = ("customer", "shipper", "admin")
STATUS = [("PENDING", "Chờ xác nhận"), ("CONFIRMED", "Đã tiếp nhận"), ("IN_TRANSIT", "Đang vận chuyển"),
          ("ARRIVED", "Đã đến nơi"), ("DELIVERED", "Đã giao"), ("CANCELLED", "Đã hủy")]
NEXT = {"PENDING": "CONFIRMED", "CONFIRMED": "IN_TRANSIT", "IN_TRANSIT": "ARRIVED"}   # luồng Shipper cập nhật
PHONE, EMAIL = re.compile(r"\+?\d{9,12}"), re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
fee_of = lambda kg: 20000 + 6000 * kg          # cước phí mô phỏng theo khối lượng
now = lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, password TEXT, role TEXT, full_name TEXT, phone TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS waybills(code TEXT PRIMARY KEY, customer TEXT, shipper TEXT, sender_name TEXT, sender_phone TEXT, sender_addr TEXT,
  recv_name TEXT, recv_phone TEXT, recv_addr TEXT, goods_name TEXT, goods_type TEXT, qty INTEGER, weight REAL, value REAL, fee REAL, status TEXT, created_at TEXT, delivered_at TEXT);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, status TEXT, note TEXT, actor TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, msg TEXT, code TEXT, at TEXT, is_read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, kind TEXT, descr TEXT, image TEXT, by_user TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, kind TEXT, detail TEXT, status TEXT DEFAULT 'PENDING', by_user TEXT, at TEXT, decided_by TEXT);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, code TEXT, name TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, at TEXT);
"""

# ---------- Tiện ích CSDL ----------
def conn():
    if "db" not in g: g.db = sqlite3.connect(DB); g.db.row_factory = sqlite3.Row
    return g.db
@app.teardown_appcontext
def _close(_):
    d = g.pop("db", None)
    if d: d.close()
def q(sql, a=()): return [dict(r) for r in conn().execute(sql, a)]
def one(sql, a=()): r = q(sql, a); return r[0] if r else None
def ex(sql, a=()): c = conn().execute(sql, a); conn().commit(); return c
def err(m, c=400): return jsonify(error=m), c
def body(): return request.get_json(silent=True) or {}

def audit(action, target=""):   # (15) ghi nhật ký: ai - làm gì - lúc nào
    ex("INSERT INTO audit(actor,action,target,at) VALUES(?,?,?,?)", (g.user["username"], action, target, now()))
def log(code, st, note=""): ex("INSERT INTO history(code,status,note,actor,at) VALUES(?,?,?,?,?)", (code, st, note, g.user["username"], now()))
def staff(role): return [r["username"] for r in q("SELECT username FROM users WHERE role=? AND active=1", (role,))]
def notify(users, msg, code=""):   # (3) thông báo trong hệ thống
    for u in set(users): conn().execute("INSERT INTO notifications(username,msg,code,at) VALUES(?,?,?,?)", (u, msg, code, now()))
    conn().commit()
def bad_contact(d):
    if d.get("phone") and not PHONE.fullmatch(d["phone"]): return "Số điện thoại không hợp lệ (9-12 chữ số)"
    if d.get("email") and not EMAIL.fullmatch(d["email"]): return "Email không hợp lệ"

def api(*roles):
    """Yêu cầu đăng nhập + kiểm soát vai trò (RBAC) cho mọi API."""
    def deco(fn):
        @wraps(fn)
        def w(*a, **k):
            u = one("SELECT * FROM users WHERE username=?", (session.get("u"),)) if session.get("u") else None
            if not u: return err("Chưa đăng nhập", 401)
            if not u["active"]: session.clear(); return err("Tài khoản đã bị khóa", 401)
            if roles and u["role"] not in roles: return err("Bạn không có quyền thực hiện thao tác này", 403)
            g.user = u; return fn(*a, **k)
        return w
    return deco

def scope():
    """Phạm vi dữ liệu theo vai trò: Admin thấy tất cả; Khách hàng chỉ đơn của mình; Shipper thấy đơn mình nhận + đơn đang chờ nhận."""
    u = g.user
    if u["role"] == "admin": return "1=1", ()
    if u["role"] == "customer": return "customer=?", (u["username"],)
    return "(shipper=? OR (status='PENDING' AND shipper IS NULL))", (u["username"],)
def get_wb(code):
    w, a = scope(); return one(f"SELECT * FROM waybills WHERE code=? AND {w}", (code,) + a)

# ---------- (1) Đăng nhập / Đăng xuất ----------
@app.post("/api/login")
def login():
    d = body(); ident = str(d.get("username", "")).strip(); u = one("SELECT * FROM users WHERE username=? OR (email<>'' AND lower(email)=lower(?))", (ident, ident))   # đăng nhập bằng tên đăng nhập hoặc email
    if not u or not cp(u["password"], str(d.get("password", ""))): return err("Sai tên đăng nhập hoặc mật khẩu")
    if not u["active"]: return err("Tài khoản đã bị khóa, vui lòng liên hệ quản trị", 403)
    session.clear(); session["u"] = u["username"]; session.permanent = bool(d.get("remember"))
    g.user = u; audit("Đăng nhập"); return jsonify(ok=True)
@app.post("/api/logout")
def logout():
    if session.get("u"): g.user = {"username": session["u"]}; audit("Đăng xuất")
    session.clear(); return jsonify(ok=True)
@app.get("/api/me")
@api()
def me():
    u = {k: g.user[k] for k in ("username", "role", "full_name", "phone", "email", "address")}
    cats = {}
    for c in q("SELECT id,kind,code,name FROM categories ORDER BY id"): cats.setdefault(c["kind"], []).append(c)
    return jsonify(user=u, cats=cats)

# ---------- (2) Hồ sơ cá nhân ----------
@app.put("/api/profile")
@api()
def profile():
    d = body()
    if not str(d.get("full_name", "")).strip(): return err("Họ tên không được để trống")
    if bad_contact(d): return err(bad_contact(d))
    ex("UPDATE users SET full_name=?,phone=?,email=?,address=? WHERE username=?",
       (d["full_name"].strip(), d.get("phone", ""), d.get("email", ""), d.get("address", ""), g.user["username"]))
    audit("Cập nhật hồ sơ"); return jsonify(ok=True)
@app.post("/api/password")
@api()
def password():
    d = body()
    if not cp(g.user["password"], str(d.get("old", ""))): return err("Mật khẩu hiện tại không đúng")
    if len(str(d.get("new", ""))) < 6: return err("Mật khẩu mới phải có ít nhất 6 ký tự")
    ex("UPDATE users SET password=? WHERE username=?", (hp(d["new"]), g.user["username"])); audit("Đổi mật khẩu"); return jsonify(ok=True)

# ---------- (3) Thông báo ----------
@app.get("/api/notifications")
@api()
def noti():
    items = q("SELECT * FROM notifications WHERE username=? ORDER BY id DESC LIMIT 30", (g.user["username"],))
    return jsonify(items=items, unread=sum(1 for i in items if not i["is_read"]))
@app.post("/api/notifications/read")
@api()
def noti_read(): ex("UPDATE notifications SET is_read=1 WHERE username=?", (g.user["username"],)); return jsonify(ok=True)

# ---------- (4)(5) Tra cứu, lịch sử vận đơn (lọc/sắp xếp/phân trang xử lý ở bảng dữ liệu) ----------
@app.get("/api/waybills")
@api()
def wb_list():
    w, a = scope(); return jsonify(q(f"SELECT * FROM waybills WHERE {w} ORDER BY created_at DESC LIMIT 3000", a))

def actions_for(w):
    r, s, out = g.user["role"], w["status"], []
    if r == "shipper" and s in NEXT and (s == "PENDING" or w["shipper"] == g.user["username"]): out.append("next")
    if r == "customer":
        if s == "ARRIVED": out.append("confirm")
        if s in ("PENDING", "CONFIRMED") and not one("SELECT 1 x FROM requests WHERE code=? AND status='PENDING'", (w["code"],)): out += ["adjust", "cancel"]
    return out

# (6) Chi tiết + timeline trạng thái
@app.get("/api/waybills/<code>")
@api()
def wb_detail(code):
    w = get_wb(code)
    if not w: return err("Không tìm thấy vận đơn", 404)
    sp = one("SELECT full_name,phone FROM users WHERE username=?", (w["shipper"],)) if w["shipper"] else None
    return jsonify(waybill=w, actions=actions_for(w), shipper=sp, history=q("SELECT * FROM history WHERE code=? ORDER BY id", (code,)),
                   incidents=q("SELECT * FROM incidents WHERE code=?", (code,)), requests=q("SELECT * FROM requests WHERE code=? ORDER BY id DESC", (code,)))

# ---------- (7)(8) Khai báo hàng hóa + gửi yêu cầu tạo vận đơn (nhập nhiều dòng cùng lúc) ----------
@app.post("/api/waybills")
@api("customer")
def wb_create():
    d = body(); s = d.get("sender") or {}; items = d.get("items") or []
    if not all(str(s.get(k, "")).strip() for k in ("name", "phone", "addr")): return err("Vui lòng nhập đủ thông tin người gửi")
    if bad_contact({"phone": s["phone"]}): return err("SĐT người gửi không hợp lệ")
    if not items: return err("Chưa có vận đơn nào để gửi")
    if len(items) > 200: return err("Tối đa 200 vận đơn mỗi lần gửi")
    rows = []
    for i, it in enumerate(items, 1):      # kiểm tra toàn bộ trước khi lưu (all-or-nothing)
        if any(not str(it.get(k, "")).strip() for k in ("recv_name", "recv_phone", "recv_addr", "goods_name", "goods_type")): return err(f"Dòng {i}: thiếu thông tin bắt buộc")
        if bad_contact({"phone": it["recv_phone"]}): return err(f"Dòng {i}: SĐT người nhận không hợp lệ")
        try: qty, kg, val = int(it.get("qty") or 1), float(it.get("weight") or 0), float(it.get("value") or 0)
        except ValueError: return err(f"Dòng {i}: số lượng, khối lượng, giá trị phải là số")
        if qty < 1 or kg <= 0 or val < 0: return err(f"Dòng {i}: số lượng và khối lượng phải lớn hơn 0")
        rows.append((it, qty, kg, val))
    codes = []
    for it, qty, kg, val in rows:
        code = "VD" + datetime.now().strftime("%y%m%d") + uuid.uuid4().hex[:5].upper(); codes.append(code)   # mã vận đơn duy nhất
        conn().execute("INSERT INTO waybills VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,NULL)",
            (code, g.user["username"], s["name"].strip(), s["phone"].strip(), s["addr"].strip(), it["recv_name"].strip(), it["recv_phone"].strip(),
             it["recv_addr"].strip(), it["goods_name"].strip(), it["goods_type"], qty, kg, val, fee_of(kg), now()))
        conn().execute("INSERT INTO history(code,status,note,actor,at) VALUES(?,?,?,?,?)", (code, "PENDING", "Khách hàng gửi yêu cầu tạo vận đơn", g.user["username"], now()))
    conn().commit(); audit("Gửi yêu cầu tạo vận đơn", ", ".join(codes[:5]) + ("..." if len(codes) > 5 else ""))
    notify(staff("shipper") + staff("admin"), f"{len(codes)} yêu cầu vận đơn mới từ {g.user['full_name']}", codes[0])
    return jsonify(codes=codes)

# ---------- (12) Shipper cập nhật trạng thái vận chuyển ----------
@app.post("/api/waybills/<code>/status")
@api("shipper")
def wb_status(code):
    w = get_wb(code); to = body().get("to")
    if not w: return err("Không tìm thấy vận đơn", 404)
    if NEXT.get(w["status"]) != to: return err("Không thể chuyển sang trạng thái này")
    me_ = g.user["username"]   # UPDATE có điều kiện để 2 shipper không nhận trùng một đơn
    c = ex("UPDATE waybills SET status=?, shipper=COALESCE(shipper,?) WHERE code=? AND status=? AND (shipper IS NULL OR shipper=?)", (to, me_, code, w["status"], me_))
    if not c.rowcount: return err("Vận đơn đã được shipper khác xử lý")
    label = dict(STATUS)[to]; log(code, to, f"{g.user['full_name']} cập nhật: {label}"); audit("Cập nhật trạng thái → " + label, code)
    notify([w["customer"]], f"Vận đơn {code}: {label}", code); return jsonify(ok=True)

# ---------- (9)(10) Khách hàng xác nhận nhận hàng (+ báo cáo sự cố ngay lúc xác nhận) ----------
@app.post("/api/waybills/<code>/confirm")
@api("customer")
def wb_confirm(code):
    w, d = get_wb(code), body()
    if not w or w["status"] != "ARRIVED": return err("Chỉ xác nhận được khi hàng đã đến nơi")
    inc = d.get("incident")
    if inc:
        if not str(inc.get("descr", "")).strip(): return err("Vui lòng mô tả sự cố")
        if len(inc.get("image", "")) > 700000: return err("Ảnh quá lớn (tối đa khoảng 500KB)")
        ex("INSERT INTO incidents(code,kind,descr,image,by_user,at) VALUES(?,?,?,?,?,?)", (code, inc.get("kind", "Khác"), inc["descr"].strip(), inc.get("image", ""), g.user["username"], now()))
        notify(staff("admin") + [w["shipper"]], f"Sự cố ({inc.get('kind')}) ở vận đơn {code}", code); audit("Báo cáo sự cố", code)
    ex("UPDATE waybills SET status='DELIVERED', delivered_at=? WHERE code=?", (now(), code))
    log(code, "DELIVERED", "Người nhận xác nhận đã nhận hàng" + (" (có báo cáo sự cố)" if inc else "")); audit("Xác nhận nhận hàng", code)
    notify([w["shipper"]], f"Vận đơn {code} đã được xác nhận giao", code); return jsonify(ok=True)

# ---------- (11) Yêu cầu hủy / điều chỉnh (khi chưa vận chuyển) ----------
@app.post("/api/waybills/<code>/request")
@api("customer")
def wb_request(code):
    w, d = get_wb(code), body(); kind = d.get("kind")
    if not w or w["status"] not in ("PENDING", "CONFIRMED"): return err("Chỉ hủy/điều chỉnh được khi vận đơn chưa vận chuyển")
    if one("SELECT 1 x FROM requests WHERE code=? AND status='PENDING'", (code,)): return err("Vận đơn đang có yêu cầu chờ duyệt")
    if kind == "cancel":
        detail = str(d.get("reason", "")).strip()
        if not detail: return err("Vui lòng nhập lý do hủy")
    elif kind == "adjust":
        f = {k: str(v).strip() for k, v in (d.get("fields") or {}).items() if k in ("recv_name", "recv_phone", "recv_addr", "qty", "weight")}
        if not f: return err("Chưa có thông tin nào thay đổi")
        if "recv_phone" in f and bad_contact({"phone": f["recv_phone"]}): return err("SĐT không hợp lệ")
        for k in ("qty", "weight"):
            if k in f:
                try:
                    if float(f[k]) <= 0: raise ValueError
                except ValueError: return err("Số lượng/khối lượng phải là số lớn hơn 0")
        detail = json.dumps(f, ensure_ascii=False)
    else: return err("Loại yêu cầu không hợp lệ")
    ex("INSERT INTO requests(code,kind,detail,by_user,at) VALUES(?,?,?,?,?)", (code, kind, detail, g.user["username"], now()))
    audit("Yêu cầu " + ("hủy" if kind == "cancel" else "điều chỉnh"), code); notify(staff("admin"), f"Yêu cầu {'hủy' if kind == 'cancel' else 'điều chỉnh'} vận đơn {code}", code)
    return jsonify(ok=True)
@app.get("/api/requests")
@api("customer", "admin")
def req_list():
    if g.user["role"] == "admin": return jsonify(q("SELECT * FROM requests ORDER BY id DESC"))
    return jsonify(q("SELECT * FROM requests WHERE by_user=? ORDER BY id DESC", (g.user["username"],)))
@app.post("/api/requests/<int:rid>/decide")
@api("admin")
def req_decide(rid):
    r = one("SELECT * FROM requests WHERE id=? AND status='PENDING'", (rid,)); ok = bool(body().get("approve"))
    if not r: return err("Yêu cầu không còn ở trạng thái chờ duyệt", 404)
    w = one("SELECT * FROM waybills WHERE code=?", (r["code"],))
    if ok:
        if w["status"] not in ("PENDING", "CONFIRMED"): return err("Vận đơn đã vận chuyển, không thể áp dụng yêu cầu")
        if r["kind"] == "cancel": ex("UPDATE waybills SET status='CANCELLED' WHERE code=?", (r["code"],)); log(r["code"], "CANCELLED", "Admin duyệt yêu cầu hủy: " + r["detail"])
        else:
            f = json.loads(r["detail"])
            for k, v in f.items(): ex(f"UPDATE waybills SET {k}=? WHERE code=?", (float(v) if k == "weight" else int(float(v)) if k == "qty" else v, r["code"]))
            if "weight" in f: ex("UPDATE waybills SET fee=? WHERE code=?", (fee_of(float(f["weight"])), r["code"]))
            log(r["code"], w["status"], "Admin duyệt điều chỉnh thông tin vận đơn")
    ex("UPDATE requests SET status=?, decided_by=? WHERE id=?", ("APPROVED" if ok else "REJECTED", g.user["username"], rid))
    audit(("Duyệt" if ok else "Từ chối") + " yêu cầu #%d" % rid, r["code"]); notify([r["by_user"]], f"Yêu cầu của bạn cho {r['code']} đã được {'duyệt' if ok else 'từ chối'}", r["code"])
    return jsonify(ok=True)

# ---------- (13)(17) Thống kê, báo cáo, dashboard ----------
@app.get("/api/stats")
@api()
def stats():
    w, a = scope(); f, t = request.args.get("from", ""), request.args.get("to", "")
    cond = w + (" AND substr(created_at,1,10)>=?" if f else "") + (" AND substr(created_at,1,10)<=?" if t else ""); a = a + tuple(x for x in (f, t) if x)
    bs = q(f"SELECT status, COUNT(*) n, COALESCE(SUM(value),0) v FROM waybills WHERE {cond} GROUP BY status", a)
    return jsonify(by_status=bs, total=sum(x["n"] for x in bs),
        revenue=one(f"SELECT COALESCE(SUM(fee),0) s FROM waybills WHERE {cond} AND status='DELIVERED'", a)["s"],
        by_day=q(f"SELECT substr(created_at,1,10) d, COUNT(*) n FROM waybills WHERE {cond} GROUP BY d ORDER BY d", a))

# ---------- (14) Quản lý người dùng ----------
@app.get("/api/users")
@api("admin")
def users(): return jsonify(q("SELECT username,role,full_name,phone,email,active FROM users ORDER BY role,username"))
@app.post("/api/users")
@api("admin")
def user_add():
    d = body(); u = str(d.get("username", "")).strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,30}", u): return err("Tên đăng nhập 3-30 ký tự: chữ thường, số hoặc dấu gạch dưới")
    if d.get("role") not in ROLES: return err("Vai trò không hợp lệ")
    if not str(d.get("full_name", "")).strip(): return err("Vui lòng nhập họ tên")
    if len(str(d.get("password", ""))) < 6: return err("Mật khẩu phải có ít nhất 6 ký tự")
    if bad_contact(d): return err(bad_contact(d))
    if one("SELECT 1 x FROM users WHERE username=?", (u,)): return err("Tên đăng nhập đã tồn tại")
    ex("INSERT INTO users(username,password,role,full_name,phone,email) VALUES(?,?,?,?,?,?)", (u, hp(d["password"]), d["role"], d["full_name"].strip(), d.get("phone", ""), d.get("email", "")))
    audit("Thêm người dùng", u); return jsonify(ok=True)
@app.put("/api/users/<u>")
@api("admin")
def user_edit(u):
    d = body()
    if not one("SELECT 1 x FROM users WHERE username=?", (u,)): return err("Không tìm thấy người dùng", 404)
    if u == g.user["username"] and (d.get("active") == 0 or d.get("role", "admin") != "admin"): return err("Không thể khóa hoặc hạ quyền chính mình")
    if "role" in d and d["role"] not in ROLES: return err("Vai trò không hợp lệ")
    if bad_contact(d): return err(bad_contact(d))
    for k in ("full_name", "role", "phone", "email", "active"):
        if k in d: ex(f"UPDATE users SET {k}=? WHERE username=?", (d[k], u))
    if d.get("password"):
        if len(d["password"]) < 6: return err("Mật khẩu mới phải có ít nhất 6 ký tự")
        ex("UPDATE users SET password=? WHERE username=?", (hp(d["password"]), u))
    audit("Khóa/mở khóa tài khoản" if "active" in d else "Sửa người dùng", u); return jsonify(ok=True)

# ---------- (15) Nhật ký thao tác ----------
@app.get("/api/audit")
@api("admin")
def audit_list(): return jsonify(q("SELECT * FROM audit ORDER BY id DESC LIMIT 1000"))

# ---------- (16) Quản lý danh mục ----------
@app.post("/api/categories")
@api("admin")
def cat_add():
    d = body(); n = str(d.get("name", "")).strip()
    if d.get("kind") not in ("goods_type", "carrier") or not n: return err("Dữ liệu không hợp lệ (danh sách trạng thái là cố định, chỉ đổi tên)")
    ex("INSERT INTO categories(kind,code,name) VALUES(?,'',?)", (d["kind"], n)); audit("Thêm danh mục", n); return jsonify(ok=True)
@app.put("/api/categories/<int:i>")
@api("admin")
def cat_edit(i):
    n = str(body().get("name", "")).strip()
    if not n: return err("Tên không được để trống")
    ex("UPDATE categories SET name=? WHERE id=?", (n, i)); audit("Đổi tên danh mục", n); return jsonify(ok=True)
@app.delete("/api/categories/<int:i>")
@api("admin")
def cat_del(i):
    c = one("SELECT * FROM categories WHERE id=?", (i,))
    if not c or c["kind"] == "status": return err("Không thể xóa mục này")
    ex("DELETE FROM categories WHERE id=?", (i,)); audit("Xóa danh mục", c["name"]); return jsonify(ok=True)

# ---------- (18) Sao lưu & phục hồi (thủ công hoặc theo lịch) ----------
SCH = os.path.join(BK, "schedule.json")
def sched(new=None):
    os.makedirs(BK, exist_ok=True)
    if new: json.dump(new, open(SCH, "w"))
    return json.load(open(SCH)) if os.path.exists(SCH) else {"hours": 0, "last": 0}
def do_backup():
    os.makedirs(BK, exist_ok=True); t = datetime.now()
    while os.path.exists(os.path.join(BK, f"evandon_{t:%Y%m%d_%H%M%S}.db")): t += timedelta(seconds=1)   # tránh ghi đè bản cùng giây
    name = f"evandon_{t:%Y%m%d_%H%M%S}.db"
    s, d = sqlite3.connect(DB), sqlite3.connect(os.path.join(BK, name)); s.backup(d); d.close(); s.close(); return name
def scheduler():   # luồng nền: kiểm tra mỗi phút, đến hạn thì tự sao lưu
    while True:
        time.sleep(60)
        try:
            s = sched()
            if s["hours"] and time.time() - s["last"] >= s["hours"] * 3600: do_backup(); s["last"] = time.time(); sched(s)
        except Exception: pass
@app.get("/api/backups")
@api("admin")
def bk_list():
    os.makedirs(BK, exist_ok=True)
    f = sorted((x for x in os.listdir(BK) if x.endswith(".db")), reverse=True)
    return jsonify(items=[{"name": x, "kb": round(os.path.getsize(os.path.join(BK, x)) / 1024), "at": datetime.fromtimestamp(os.path.getmtime(os.path.join(BK, x))).strftime("%Y-%m-%d %H:%M:%S")} for x in f], schedule=sched())
@app.post("/api/backups")
@api("admin")
def bk_make(): n = do_backup(); audit("Sao lưu dữ liệu", n); return jsonify(name=n)
@app.post("/api/backups/schedule")
@api("admin")
def bk_sched():
    h = int(body().get("hours", 0)); h = h if h in (0, 6, 12, 24) else 0; sched({"hours": h, "last": time.time()}); audit("Đặt lịch sao lưu", f"{h} giờ"); return jsonify(ok=True)
@app.get("/api/backups/<name>")
@api("admin")
def bk_get(name):
    if not re.fullmatch(r"evandon_\d{8}_\d{6}\.db", name) or not os.path.exists(os.path.join(BK, name)): return err("Không tìm thấy bản sao lưu", 404)
    return send_file(os.path.join(BK, name), as_attachment=True)
@app.post("/api/backups/restore")
@api("admin")
def bk_restore():
    name = str(body().get("name", ""))
    if not re.fullmatch(r"evandon_\d{8}_\d{6}\.db", name) or not os.path.exists(os.path.join(BK, name)): return err("Không tìm thấy bản sao lưu", 404)
    do_backup(); d = g.pop("db", None)    # sao lưu an toàn trạng thái hiện tại trước khi ghi đè
    if d: d.close()
    s, t = sqlite3.connect(os.path.join(BK, name)), sqlite3.connect(DB); s.backup(t); t.close(); s.close()
    audit("Phục hồi dữ liệu", name); return jsonify(ok=True)

# ---------- Trang giao diện ----------
@app.get("/")
def home(): return render_template("app.html") if session.get("u") else redirect("/login")
@app.get("/login")
def login_page(): return redirect("/") if session.get("u") else render_template("login.html")

# ---------- Khởi tạo CSDL + dữ liệu mẫu ----------
def init_db():
    c = sqlite3.connect(DB); c.executescript(SCHEMA)
    if not c.execute("SELECT 1 FROM users").fetchone():
        for u, n, r in [("admin", "Nhân viên vận đơn", "admin"), ("shipper", "Trần Văn Giao", "shipper"), ("shipper2", "Lê Hoàng Nhanh", "shipper"), ("customer", "Công ty Gốm Bát Tràng", "customer")]:
            c.execute("INSERT INTO users(username,password,role,full_name,phone,email,address) VALUES(?,?,?,?,?,?,?)", (u, hp("123456"), r, n, "0901234567", u + "@evandon.vn", "Bát Tràng, Gia Lâm, Hà Nội"))
        for k, names in {"goods_type": ["Điện tử", "Thời trang", "Thực phẩm", "Gốm sứ", "Khác"], "carrier": ["Đội giao nội thành", "Xe tải liên tỉnh", "Giao nhanh 2 giờ"]}.items():
            for n in names: c.execute("INSERT INTO categories(kind,code,name) VALUES(?,'',?)", (k, n))
        for s, n in STATUS: c.execute("INSERT INTO categories(kind,code,name) VALUES('status',?,?)", (s, n))
        R = random.Random(7); cities = ["Hà Nội", "Hải Phòng", "Đà Nẵng", "Huế", "TP. Hồ Chí Minh", "Cần Thơ"]; goods = ["Bộ ấm chén", "Lọ hoa", "Laptop", "Áo thun", "Mì gói", "Bình gốm"]
        flow = ["PENDING", "CONFIRMED", "IN_TRANSIT", "ARRIVED", "DELIVERED"]
        for i in range(30):
            st = R.choice(["PENDING", "CONFIRMED", "IN_TRANSIT", "IN_TRANSIT", "ARRIVED", "DELIVERED", "DELIVERED", "DELIVERED", "CANCELLED"])
            d0 = datetime.now() - timedelta(days=R.randint(0, 25), hours=R.randint(0, 8)); code = f"VD{d0:%y%m%d}{i:02d}{R.randint(100, 999)}"
            sh = None if st == "PENDING" else R.choice(["shipper", "shipper2"]); kg = R.randint(1, 40)
            steps = ["PENDING", "CANCELLED"] if st == "CANCELLED" else flow[:flow.index(st) + 1]
            c.execute("INSERT INTO waybills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (code, "customer", sh, "Công ty Gốm Bát Tràng", "0901234567", "Bát Tràng, Gia Lâm, Hà Nội",
                f"Khách {R.choice(cities)} {i}", "09" + str(R.randint(10000000, 99999999)), "Số %d, %s" % (R.randint(1, 99), R.choice(cities)), R.choice(goods), R.choice(["Gốm sứ", "Điện tử", "Thời trang", "Thực phẩm"]),
                R.randint(1, 20), kg, R.randint(2, 80) * 100000, fee_of(kg), st, d0.strftime("%Y-%m-%d %H:%M:%S"), (d0 + timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S") if st == "DELIVERED" else None))
            for k, s in enumerate(steps): c.execute("INSERT INTO history(code,status,note,actor,at) VALUES(?,?,?,?,?)", (code, s, dict(STATUS)[s], sh if s != "PENDING" and sh else "customer", (d0 + timedelta(hours=3 * k)).strftime("%Y-%m-%d %H:%M:%S")))
    c.commit(); c.close()

if __name__ == "__main__":
    init_db(); threading.Thread(target=scheduler, daemon=True).start()
    app.run(debug=False)
