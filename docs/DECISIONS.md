# DECISIONS – Các quyết định khi triển khai Phase 1

Spec (docs/SPEC.md) để ngỏ một số điểm. Dưới đây là các quyết định đã chọn và lý do.

## Kiến trúc
1. **Monorepo npm workspaces** gồm `packages/core` (hàm thuần, không phụ thuộc), `packages/server` (Express + SQLite),
   `packages/web` (React + Vite). Web import `@dutoan/core` trực tiếp từ mã nguồn qua alias của Vite; server dùng bản build `dist`.
2. **Lưới dự toán tự viết** thay cho AG Grid: nhẹ, không phụ thuộc giấy phép, và kiểm soát hoàn toàn phím tắt kiểu F1/G8
   (Enter lưu và xuống dòng, ↑/↓ di chuyển, Esc hủy, F3 tra định mức, gõ mã hiệu tự điền tên/đơn vị).
3. **bcryptjs** thay cho `bcrypt` native: cùng định dạng hash bcrypt, không cần công cụ biên dịch C++ trên Windows.
4. **better-sqlite3 ^12** (có bản dựng sẵn cho Node 20–24). CSDL mặc định `data/dutoan.db`, đổi bằng `DB_PATH`.
5. **Không có router**: điều hướng bằng hash (`#/projects`, `#/project/:id`) để chạy được cả khi mở file tĩnh sau này trong Electron.

## Tính toán
6. **Mô hình định mức đơn giản hóa**: mỗi định mức liệt kê trực tiếp hao phí tài nguyên (VL/NC/M). Chưa có phân tích vữa/cấp phối
   bê tông lồng nhau, “vật liệu khác %”, “máy khác %”, hệ số điều chỉnh nhân công/máy. Định mức bê tông mẫu đã quy đổi sẵn cấp phối.
   → Phase 2 cần bổ sung khi nạp Định mức 12/2021 chính thức.
7. **Không làm tròn trong tính toán**; chỉ làm tròn khi hiển thị (#,##0). File Excel dùng công thức nên kết quả khớp với Excel.
8. **Nhóm quy mô chi phí** để chọn tỷ lệ mặc định được xác định theo **chi phí trực tiếp T** (tránh vòng lặp khi G phụ thuộc chính tỷ lệ).
   Các tỷ lệ trong `data/rates-default.json` là **GIÁ TRỊ MẪU** – phải kiểm tra lại theo Phụ lục TT11/2021 & TT09/2024.
9. **Tỷ lệ lưu dưới dạng %** (6,5 nghĩa là 6,5%). Cơ sở tính chi phí chung chọn được T hoặc NC. Người dùng có thể tắt “Tự động” để nhập tay.
10. **Giá**: thư viện có *giá gốc* (`resources.base_price`); mỗi công trình có *giá công trình* ghi đè (`project_prices`).
    Chênh lệch giá (CLVT) = (giá công trình − giá gốc) × khối lượng.
11. **Tổng dự toán**: dự phòng khối lượng phát sinh và dự phòng trượt giá đều tính trên (Gxd + Gtb + Gqlda + Gtv + Gk) × tỷ lệ
    (đơn giản hóa; chưa tính trượt giá theo chỉ số và thời gian thực hiện).
12. **Diễn giải khối lượng**: bộ phân tích công thức an toàn (không dùng `eval`): + − × / ^, ngoặc, “x” là nhân, dấu phẩy thập phân,
    chú thích trong `[...]` hoặc `"..."` được bỏ qua.

## Trợ lý AI
13. **Engine không lưu trạng thái**: câu hỏi làm rõ trả về các lựa chọn, mỗi lựa chọn mang theo intent đã bổ sung; khi hỏi giá trị
    tự do (khối lượng, giá, tên), server trả `pending` và client gửi lại cùng câu trả lời.
14. **Quy đổi đơn vị**: “50 m3” cho định mức đơn vị 100m3 → 0,5; giá “đ/tấn” cho vật tư tính theo kg → chia 1000 (hỗ trợ tấn↔kg, m3↔lít).
    Đơn vị không quy đổi được thì hỏi lại người dùng.
15. **Hoàn tác (undo)** áp dụng cho các thao tác do trợ lý thực hiện (lưu trong bảng `assistant_history` kèm thao tác ngược).
    Chỉnh sửa trực tiếp trên lưới chưa có undo ở Phase 1.
16. **ClaudeProvider** dùng SDK chính thức `@anthropic-ai/sdk`, model mặc định `claude-opus-5` (đổi bằng `ANTHROPIC_MODEL`).
    Claude chỉ chuyển câu lệnh thành một lời gọi tool (cùng bộ tool với rule-based); việc hỏi lại, xem trước, xác nhận vẫn do
    `AssistantEngine` đảm nhận. Lỗi API hoặc từ chối → tự động quay về `RuleBasedProvider`.

## Bảo mật & người dùng
17. JWT hết hạn sau 12 giờ, lưu ở `localStorage`. Khóa ký lấy từ `JWT_SECRET`; nếu không đặt, tạo ngẫu nhiên và lưu `data/.jwt-secret`.
18. Tài khoản quản trị khởi tạo luôn bị **bắt buộc đổi mật khẩu**. Mặc định `admin/admin123` chỉ khi `NODE_ENV` khác `production`;
    ở production nếu thiếu `ADMIN_PASS` sẽ sinh mật khẩu tạm ngẫu nhiên và in ra log. Mật khẩu tối thiểu 8 ký tự.
19. Hai vai trò: *admin* (xem mọi công trình, quản lý người dùng, nạp định mức/giá gốc vào thư viện dùng chung) và *user*
    (chỉ công trình của mình; được nhập giá và công tác cho công trình của mình).

## Nhập / xuất dữ liệu
20. **Nhập định mức** theo dạng bảng phẳng: mỗi dòng là một thành phần hao phí; mã định mức có thể chỉ ghi ở dòng đầu (các dòng sau
    kế thừa). Loại tài nguyên lấy từ cột “Loại” hoặc đoán theo tên/mã (Nhân công…, Máy…, N./M.). Nhập lại cùng mã sẽ thay hao phí cũ.
21. File `.xls` (Excel 97–2003) chưa hỗ trợ – thông báo người dùng lưu lại thành `.xlsx`. File tải lên được giữ trong bộ nhớ tối đa 1 giờ.
22. **Nhập theo đường dẫn tuyệt đối** chỉ bật khi `LOCAL_MODE=true` (mặc định bật khi không chạy production).
23. **Excel xuất ra thêm sheet TDT** (Tổng dự toán) ngoài 5 sheet yêu cầu. Chuỗi công thức: THVT (giá) → PTVT (đơn giá thành phần)
    → DTCT (đơn giá, thành tiền) → TH (tổng hợp chi phí) → TDT, nên sửa giá trong THVT là toàn bộ file cập nhật.
    Kết quả công thức được ghi sẵn và bật `fullCalcOnLoad` để Excel tính lại khi mở.
24. **Google Drive**: dùng Google Picker + Google Identity Services ở trình duyệt; máy chủ tải file bằng access token của người dùng
    (Google Sheets xuất sang .xlsx). Scope `drive.file` khi có `GOOGLE_APP_ID`, ngược lại `drive.readonly`.

## Dữ liệu mẫu
25. 43 định mức và 37 tài nguyên mẫu, mã hiệu theo kiểu Định mức 12/2021 nhưng **hao phí và giá chỉ mang tính minh họa**
    (`is_sample = 1`, có banner cảnh báo). Công trình mới được tạo sẵn hạng mục “Hạng mục chung”.
26. Electron: chỉ chuẩn bị khung (`desktop/`), chưa nằm trong workspaces để không phải tải Electron khi cài đặt.
