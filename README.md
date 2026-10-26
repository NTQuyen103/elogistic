# EVANDON - Hệ thống quản lý vận đơn điện tử nội địa (demo)

Flask + SQLite + HTML/CSS/JavaScript (Chart.js, SheetJS). 3 vai trò: **Khách hàng**, **Shipper**, **Admin (nhân viên vận đơn)**.

## Chạy
```bash
pip install -r requirements.txt
python app.py          # mở http://localhost:5000
```
Lần đầu tự tạo `evandon.db` kèm dữ liệu mẫu (30 vận đơn). Muốn làm lại từ đầu: tắt server, xóa `evandon.db`, chạy lại. Cần Internet khi mở trang (font, Chart.js, SheetJS tải từ CDN).

## Tài khoản demo (mật khẩu 123456)
| Tài khoản | Vai trò |
|---|---|
| `customer` | Khách hàng |
| `shipper`, `shipper2` | Shipper |
| `admin` | Admin |

## Bảng chức năng và vị trí trong code
| # | Chức năng | Ai dùng | API (`app.py`) / View (`static/js/app.js`) |
|---|---|---|---|
| 1 | Đăng nhập / đăng xuất, phân quyền | Tất cả | `/api/login`, `/api/logout`, decorator `@api(...)` |
| 2 | Hồ sơ, đổi mật khẩu | Tất cả | `/api/profile`, `/api/password` · `vProfile` |
| 3 | Thông báo | Tất cả | `/api/notifications` · chuông ở thanh trên |
| 4 | Tra cứu vận đơn | KH, Shipper | `/api/waybills` · ô tra cứu nhanh + `vList` |
| 5 | Lịch sử vận đơn (lọc thời gian, trạng thái) | KH, Shipper | `vList` |
| 6 | Timeline trạng thái | KH, Shipper | `/api/waybills/<mã>` · `vDetail` |
| 7, 8 | Khai báo hàng hóa, gửi yêu cầu tạo vận đơn | Khách hàng | `POST /api/waybills` · `vNew` (lưới nhập nhanh) |
| 9, 10 | Xác nhận nhận hàng + báo cáo sự cố | Khách hàng | `/api/waybills/<mã>/confirm` |
| 11 | Yêu cầu hủy / điều chỉnh | Khách hàng (Admin duyệt) | `/api/waybills/<mã>/request`, `/api/requests` |
| 12 | Cập nhật trạng thái vận chuyển | Shipper | `/api/waybills/<mã>/status` |
| 13 | Thống kê, báo cáo, xuất file | Shipper | `/api/stats` · `vReport` |
| 14 | Quản lý người dùng | Admin | `/api/users` · `vUsers` |
| 15 | Nhật ký thao tác | Admin | `/api/audit` · `vAudit` |
| 16 | Quản lý danh mục | Admin | `/api/categories` · `vCats` |
| 17 | Giám sát và dashboard tổng hợp | Admin | `/api/stats` · `vDash` |
| 18 | Sao lưu và phục hồi | Admin | `/api/backups...` · `vBackup` |

## Kịch bản demo
1. `customer`: **Tạo vận đơn**, nhập vài dòng (hoặc dán từ Excel), nhấn **Gửi yêu cầu** (trạng thái Chờ xác nhận).
2. `shipper`: **Đơn chờ nhận**, bấm **Nhận đơn**, **Bắt đầu giao**, **Đã đến nơi** ngay trên dòng của bảng.
3. `customer`: chuông báo, bấm **Xác nhận nhận hàng**, có thể tích **Báo cáo sự cố** kèm ảnh.
4. `admin`: xem dashboard, **Yêu cầu hủy/điều chỉnh**, **Nhật ký thao tác**, **Sao lưu & phục hồi**.

## Cấu trúc
```
evandon/
├── app.py              # Backend: CSDL, phân quyền, API, sao lưu
├── requirements.txt
├── README.md
├── templates/          # app.html (khung chính), login.html
└── static/
    ├── css/app.css
    └── js/app.js       # Giao diện (SPA), bảng dữ liệu, các view
```
`evandon.db` và thư mục `backups/` tự sinh khi chạy.

## Lưu ý
- Đổi `EVD_SECRET` (biến môi trường) khi triển khai thật; server dev chỉ phù hợp demo.
- Xuất PDF dùng hộp thoại in của trình duyệt (chọn "Lưu dưới dạng PDF") để giữ đúng tiếng Việt.
- Sao lưu theo lịch chạy bằng luồng nền khi `python app.py` đang chạy.
