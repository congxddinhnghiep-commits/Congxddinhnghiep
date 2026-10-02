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
8. *(Bộ lịch sử TT 11/2021)* Nhóm quy mô chi phí được xác định theo **chi phí trực tiếp T**. Tỷ lệ của bộ này (nay ở
   `data/legal/tt11-2021.json`) vẫn là **GIÁ TRỊ MẪU** Phase 1. Với TT 36/2026 xem mục 27–29.
9. **Tỷ lệ lưu dưới dạng %** (6,5 nghĩa là 6,5%). Cơ sở tính chi phí chung chọn được T hoặc NC. Người dùng có thể tắt “Tự động” để nhập tay.
10. **Giá**: thư viện có *giá gốc* (`resources.base_price`); mỗi công trình có *giá công trình* ghi đè (`project_prices`).
    Chênh lệch giá (CLVT) = (giá công trình − giá gốc) × khối lượng.
11. **Tổng dự toán** (bộ lịch sử): dự phòng khối lượng phát sinh và trượt giá đều = (Gxd + Gtb + Gqlda + Gtv + Gk) × tỷ lệ.
    Với TT 36/2026 xem mục 32.
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
25. 43 định mức mẫu cho mỗi bộ định mức (TT38_2026 và TT12_2021) và 40 tài nguyên mẫu, mã hiệu theo kiểu sách định mức nhưng **hao phí và giá chỉ mang tính minh họa**
    (`is_sample = 1`, có banner cảnh báo). Công trình mới được tạo sẵn hạng mục “Hạng mục chung”.
26. Electron: chỉ chuẩn bị khung (`desktop/`), chưa nằm trong workspaces để không phải tải Electron khi cài đặt.

## Cập nhật pháp lý 2026 (TT 36/2026, TT 37/2026, TT 38/2026 – QĐ 1538/QĐ-BXD)
Nguồn: `docs/LEGAL-UPDATE-2026.md` (đã xác minh metadata ngày 2026-09-27).

27. **Bộ pháp lý có phiên bản**: `TT36_2026` (“TT 36/2026 + TT 38/2026”, hiện hành) và `TT11_2021` (“TT 11/2021 + TT 12/2021”, lịch sử).
    Mỗi công trình lưu `legal_set`. Mặc định theo **ngày lập giá** (`price_date`, ISO): từ 2026-07-01 → TT36; trước đó → TT11;
    để trống → TT36 (quy định tại thời điểm tạo). Ghi chú thời điểm giá dạng chữ (“Quý III/2026”) giữ ở trường riêng.
28. **Không tính lại ngầm**: khi nâng cấp CSDL Phase 1, mọi công trình đã có được gán `TT11_2021` và định mức cũ chuyển sang bộ
    `TT12_2021`, nên kết quả không đổi (có test). Đổi bộ pháp lý chỉ qua thao tác có xác nhận (API trả 409 nếu thiếu
    `confirmLegalSetChange`); khi đổi, hệ số được đặt lại theo mặc định của bộ mới, các khoản nhập tay (thiết bị, QLDA…) được giữ.
    Nếu ngày lập giá không khớp bộ pháp lý, hiển thị cảnh báo chứ không tự đổi.
29. **Engine TT 36/2026 theo Bảng 3.8** (đã đính chính): T; C = T × Bảng 3.3 hoặc NC × Bảng 3.4; TT = T × Bảng 3.5; GT = C + TT;
    TL = (T + GT) × Bảng 3.6; GXDTT; GTGT; GXD; dòng V riêng GXDNT = GXDTT × Bảng 3.7 × (1 + TGTGT).
    Khoảng tra: Bảng 3.3 theo T, Bảng 3.4 theo NC (sau Knc), Bảng 3.7 theo GXDTT. “Tổng chi phí xây dựng” chuyển sang tổng dự toán
    = GXD + GXDNT.
30. **Knc, Km**: Knc = 1 + tỷ lệ làm đêm × tỷ lệ chênh lệch đơn giá đêm; Km = 1 + g × (Knc − 1). Nhập theo % ở cài đặt công trình.
    Áp dụng ở bảng tổng hợp (NC = Σ NC chi tiết × Knc); các bảng chi tiết/PTVT vẫn hiển thị giá trị chưa nhân hệ số. Trong Excel,
    dòng NC/M ở sheet TH = tổng DTCT × ô hệ số.
31. **Bảng tỷ lệ là dữ liệu** (`data/legal/tt36-2026.json`): mỗi bảng có số hiệu, tiêu đề, nguồn, cơ sở tra, các khoảng, trạng thái.
    Giá trị lấy nguyên từ LEGAL-UPDATE-2026 (trích tự động) nên trạng thái mặc định là **`provisional`**; banner cảnh báo hiển thị
    tới khi quản trị viên đánh dấu “đã xác minh” từng bảng (lưu ở bảng `rate_table_status` kèm người/thời điểm – không sửa file).
    Tra khoảng dùng biên “≤”, **không nội suy**; nội suy tuyến tính chỉ khi bật cho từng bảng (khi văn bản yêu cầu).
    Ứng dụng không cho sửa giá trị tỷ lệ trên giao diện; muốn sửa phải sửa file dữ liệu (có lịch sử git).
32. **Hai khoản dự phòng**: Gdp1 = V × tỷ lệ; Gdp2 = V × tỷ lệ hoặc Σ_t (V/N) × [(1 + i)^t − 1] với N năm (làm tròn, ≥ 1) phân bổ
    đều, i = chỉ số giá xây dựng bình quân/năm. V = GXD + GXDNT + thiết bị + QLDA + tư vấn + khác (không gồm dự phòng).
    Công thức theo chỉ số là cách hiểu phổ biến của phương pháp trước đây – **cần đối chiếu nội dung đã đính chính của TT 36/2026**.
33. **Ánh xạ dòng khi bảng thiếu dòng**: Bảng 3.5/3.6 không có dòng “Tu bổ, phục hồi di tích” và các dòng “hầm” riêng ở Bảng 3.6;
    tạm dùng dòng gần nhất (dân dụng / ngành tương ứng) và **hiển thị cảnh báo**. Có thể chọn dòng Bảng 3.6 thủ công; lắp đặt
    thiết bị (Bảng 3.4 “lap_dat”) mặc định dùng dòng TL “Lắp đặt thiết bị công nghệ / đường dây điện”.
    Mặc định “công trình theo tuyến” (Bảng 3.7) = bật cho loại Giao thông, tắt cho loại khác – người dùng chỉnh được.
34. **Định mức có phiên bản** theo `dataset` (khóa chính dataset + mã): `TT38_2026` và `TT12_2021`. Công trình tra định mức theo bộ
    của bộ pháp lý; nhập định mức chọn bộ đích, không ghi đè bộ khác.
35. **Nhóm nhân công**: định mức mẫu TT38 dùng tài nguyên “Nhân công nhóm 2/3/4”; bộ TT12 giữ “Nhân công bậc x/7”. Việc gán
    bậc → nhóm trong dữ liệu mẫu chỉ để minh họa, **không** tra từ TT 38/2026. Giá nhân công nhóm là giá mẫu.
36. **Sổ căn cứ pháp lý** (`data/legal/documents.json`, màn hình “Căn cứ pháp lý”): số hiệu, cơ quan, ngày ban hành/hiệu lực,
    tình trạng, nguồn chính thức. Văn bản lịch sử (TT 11/2021, TT 12/2021, TT 09/2024) chưa được xác minh lại nên ngày để trống
    và gắn nhãn “chưa xác minh” thay vì điền theo trí nhớ.
37. **Excel TH**: đầu sheet liệt kê bộ pháp lý và các văn bản (số hiệu, ngày, nguồn), cảnh báo khi bảng tỷ lệ còn TẠM; thêm cột
    “Nguồn / căn cứ” cho từng dòng; mọi dòng là công thức Excel sinh từ biểu thức của engine (dùng chung cho TT36 và TT11).
38. ClaudeProvider/trợ lý không đổi: trợ lý chỉ thao tác trên dự toán; không được đổi bộ pháp lý hay đánh dấu xác minh bảng tỷ lệ.

## Update 2 (docs/UPDATE-2.md)

### A. Chi tiết pháp lý đã xác minh
39. **Bảng 3.3–3.7 = `verified`** trong file dữ liệu (verifiedBy “Claude (automated transcription, 2 passes)”, 2026-09-27) vì
    PL III của TT 36 không bị CV **9947/BXD-VPB** thay thế. Trạng thái trong CSDL (`rate_table_status`) vẫn ưu tiên hơn file,
    nên quản trị viên chuyển về TẠM được. Hai test cũ kiểm tra chuỗi nguồn/cảnh báo “TẠM” được sửa theo đúng yêu cầu này
    (số liệu tính tay không đổi).
40. **Cơ sở tra khoảng**: trường mới `projects.gxdtt_tmdt` (tỷ đồng). Nếu trống: lần 1 tra theo T, sau đó tra lại theo GXDTT
    vừa tính cho tới khi khoảng của cả Bảng 3.3 và 3.7 ổn định (tối đa 20 vòng). Nếu dao động ở biên khoảng, chọn lần tính có
    GXDTT lớn hơn và cảnh báo. Một “công trình” trong phần mềm = một công trình trong TMĐT; dự án nhiều công trình lập thành nhiều
    công trình riêng, mỗi công trình nhập giá trị TMĐT của chính nó.
41. **Nội suy** mặc định tắt cho mọi bảng; nếu quản trị viên bật, dự toán hiển thị cảnh báo “không có căn cứ trong TT 36”.
42. **Dòng cha** (Bảng 3.5/3.6) là *ghi chú* (không phải cảnh báo). Tỷ lệ TT riêng lưu ở `categories.tt_rate`;
    TT = T × tỷ lệ chung + Σ T_hm × (tỷ lệ_hm − tỷ lệ chung). Trong Excel dòng TT = công thức T × tỷ lệ + phần điều chỉnh (hằng số).
43. **Dự phòng**: G_TDP = (GXD + GXDNT) + thiết bị + QLDA + tư vấn + khác. kps > 5% bị chặn ở API (engine chỉ cảnh báo).
    GDP2 mặc định theo công thức 2.9 với lịch phân bổ % theo kỳ (năm/quý, mặc định chia đều; tổng phải = 100%), I_bq, ΔI.
    Cách “tỷ lệ % nhập tay” vẫn giữ để tương thích nhưng ghi rõ “không theo công thức 2.9” và cảnh báo; thiết lập cũ
    `index` (Update 1) được đọc thành công thức 2.9 với I_bq = 1 + tỷ lệ/100, chia đều theo số năm.
44. **Nhóm nhân công mẫu** đổi tên “(mẫu minh họa)”; dữ liệu mẫu không có gì lấy từ TT 38/2026 – định mức chính thức phải
    nhập từ phụ lục thay thế bằng chức năng nhập (nhận dòng “Nhân công nhóm N” là NC).

### B. Nhập file dự toán có sẵn
45. **SheetJS 0.20.3 từ CDN chính thức** (`cdn.sheetjs.com`) thay cho gói `xlsx` 0.18.5 trên npm (cũ, có lỗ hổng đã biết).
    Đọc được .xlsx/.xlsm/.xls, lấy giá trị cache của công thức, danh sách ô gộp. CSV vẫn dùng Papa Parse (giữ số dạng chữ).
    exceljs vẫn dùng để **xuất** Excel.
46. **Nhận diện tiêu đề**: quét 30 dòng đầu, thử tiêu đề 1 và 2 dòng (điền giá trị ô gộp chỉ cho dòng tiêu đề), chấm điểm theo
    từ đồng nghĩa có/không dấu và tiếng Trung; ưu tiên tiêu đề 2 dòng khi dòng thứ 2 “đủ” chỉ nhờ ô gộp dọc.
    Số chỉ có dấu chấm dạng nhóm 3 (“4.250”, “1.650.000”) hiểu là hàng nghìn (quy ước VN); có cả “.” và “,” thì dấu đứng sau là dấu thập phân.
47. **Phân loại dòng**: Cộng/Tổng/小计/合计 bị loại; hạng mục = có tên, không có khối lượng/đơn vị và (số La Mã / chữ A–E / chữ in hoa /
    “Hạng mục…”, “Phần…”); dòng đánh số cột ngay dưới tiêu đề bị bỏ. Cảnh báo: thiếu/lạ đơn vị, KL = 0/âm, trùng dòng (cùng hạng mục, mã, tên, đơn vị).
48. **Nguồn gốc** lưu ở các cột `source_*` của `estimate_items` và không bao giờ bị ghi đè; gán mã sau đó đổi tên/đơn vị theo định mức,
    quy đổi KL sang đơn vị định mức (m3 → 100m3, kg → tấn) và giữ bản gốc. Mã trong file không có trong bộ định mức: không gán,
    chỉ lưu ở `source_code` và cảnh báo. Mã hợp lệ: trạng thái `imported`, giữ đơn vị gốc (không tự quy đổi).
49. Hạng mục trùng tên với hạng mục có sẵn được dùng lại; công việc trước hạng mục đầu tiên vào hạng mục “Nhập từ <file>”.
    Mỗi lần nhập được ghi vào lịch sử để **Hoàn tác** được.
50. **Mẫu nhập** khóa theo dấu vân tay FNV-1a của nhãn tiêu đề đã chuẩn hóa + vị trí cột + số dòng tiêu đề; cùng layout (kể cả
    bản .xls) nhận lại mẫu và dùng ánh xạ đã lưu.

### C. Gợi ý mã định mức
51. Engine tự viết (không phụ thuộc thư viện): điểm = độ phủ IDF của từ khóa (câu hỏi và định mức) + khớp tham số − phạt tham số
    khác − phạt nhẹ khi định mức có tham số mà mô tả thiếu. Đơn vị là **bộ lọc cứng** (chỉ cùng đơn vị hoặc quy đổi được).
    Độ tin cậy = 0,55 × mức phù hợp + 0,45 × khoảng cách với ứng viên thứ 2; có tham số khác → ≤ 0,5; định mức có tham số mà
    mô tả không nêu → ≤ 0,79 (luôn “cần xem lại”). B→mác theo tương ứng thông dụng (B15≈M200, B20≈M250, B22,5≈M300…).
52. Trạng thái mã: `manual`, `imported`, `auto`, `confirmed`. Chấp nhận 1 gợi ý bằng tay = `confirmed`; gắn hàng loạt = `auto`.
    **Duyệt dự toán** bị chặn khi còn mã `auto`; mọi thay đổi sau khi duyệt đưa dự toán về “nháp”.

### D. Bộ đơn giá
53. **Không có giá nào được tạo sẵn**: chỉ seed 1 bộ metadata TP.HCM tháng 02/2026 (7563/TB-SXD-KTVLXD, 0 dòng, nháp; tình trạng VAT
    “chưa rõ” vì chưa có văn bản). File `bang-gia-thu-nghiem.xlsx` chỉ là dữ liệu test giả định, không seed.
34 tỉnh/thành trong `data/regions.json` lập theo hiểu biết về Nghị quyết 202/2025/QH15 – **cần đối chiếu văn bản gốc**.
54. **Thứ tự áp giá**: giá nhập tay → các bộ đã chọn theo loại tài nguyên và ưu tiên → giá gốc thư viện (gắn nhãn MẪU nếu là mẫu).
    Bộ “đã gồm VAT” được trừ VAT theo thuế suất khai báo (mặc định 10%) vì dự toán dùng giá trước thuế; “chưa rõ VAT” dùng nguyên giá
    và ghi chú. Dòng giá khác đơn vị được quy đổi nếu tương thích (đ/tấn → đ/kg), không tương thích thì bỏ qua. Dòng có khu vực chỉ
    dùng khi trùng khu vực của công trình; ưu tiên dòng đúng khu vực, sau đó dòng chung. Bộ nháp vẫn dùng được nhưng nguồn ghi
    “[bản nháp – chưa xác minh]”. Bộ loại TH (đơn giá tổng hợp) chỉ lưu tham khảo, không áp vào tài nguyên.
55. **Đề xuất**: cùng tỉnh (so sánh không dấu), cùng khu vực nếu cả hai có khu vực, kỳ bắt đầu ≤ ngày lập giá; sắp xếp theo loại
    rồi kỳ mới nhất. Chỉ thêm được bộ có dòng giá.
56. **Khớp tài nguyên** khi nhập bảng giá: theo mã (không phân biệt hoa thường) rồi theo tên + quy cách (Jaccard ≥ 0,5, hơn ứng viên
    thứ 2 ≥ 0,1, đơn vị tương thích); còn lại vào danh sách “cần xem lại” để gán tay hoặc bỏ qua. Mọi thay đổi dòng giá đưa bộ về nháp;
    chỉ xác minh được bộ có dòng giá. Chênh lệch khi đổi bộ tính trên chi phí trực tiếp trước hệ số (Knc/Km, gián tiếp…).

## Section F – theo skill `construction-estimation-engine` và `du-toan-xay-dung-data-vn`

57. **Parser khối lượng** tự viết: tokenizer → AST chỉ gồm số, biến, dấu âm, + − × ÷, ngoặc, % (không `eval`, không hàm, không
    thuộc tính); giới hạn 500 ký tự, độ sâu 40, 400 nút. “x/×” chỉ là phép nhân khi đứng giữa số/ngoặc (biến tên X vẫn dùng được).
    Số: “0,3” thập phân; “1,000,000,000” hoặc “1.000.000.000” (≥ 2 nhóm) là hàng nghìn; “1e9”. Parser cũ `evaluateFormula` (diễn giải
    KL một dòng) được giữ để tương thích.
58. **QuantityLine**: mỗi công tác có thể có nhiều dòng (diễn giải, biểu thức, biến, Cộng/Trừ, đơn vị dòng). KL công tác = Σ dấu × giá trị ×
    hệ số quy đổi (mm/cm/dm/m và bình phương/lập phương, m3→100m3, kg→tấn). Giá trị âm chỉ hợp lệ trên dòng “Trừ”. Sửa KL tay sau đó
    không xóa các dòng – báo cáo kiểm tra báo lệch.
59. **Phương thức giá**: `NORM_BASED` (mặc định), `CUSTOM_GTT` (mã GTT/TT/“tạm tính” khi nhập hoặc chọn tay), `MARKET_QUOTE`
    (nhà cung cấp, số, ngày, hiệu lực, VAT). Đơn giá nhập theo VL/NC/M; báo giá “đã gồm VAT” được quy về trước thuế (VAT chỉ cộng
    một lần ở bảng tổng hợp). Công tác GTT/báo giá không được gợi ý mã và không bị ép vào định mức; thiếu nguồn giá → lỗi ở báo cáo kiểm tra.
60. **Bảng mã cũ**: nhận diện theo từng sheet (đa số phiếu trên các ô có ký tự ngoài ASCII) giữa Unicode, VNI-Windows và TCVN3 (ABC);
    chỉ chuyển khi sheet là VNI/TCVN3. Bản gốc lưu theo ô (`sheet.raw`) và trên công tác (`source_raw_text`), không ghi đè.
    Bảng chuyển VNI/TCVN3 dựng theo quy ước phông phổ biến; đã kiểm với `parsed_xlsx_code_catalog.csv` (không còn ký tự dấu VNI).
61. **Chuẩn hóa mã**: chỉ viết lại mã dạng 2 chữ + 5 số (+ hậu tố ngắn) thành `XX.99999…` – đúng quy ước của các bộ định mức đang
    có (TT12/TT38); mã khác giữ nguyên và báo “không có trong bộ định mức”. Mã gốc luôn được giữ (`source_code`).
62. **Ô lỗi / liên kết ngoài**: giá trị `#NAME?`, `#REF!`, `#VALUE!`… và công thức trỏ tới workbook khác (`[Book.xlsx]Sheet!A1`,
    đường dẫn ổ đĩa) được gắn cờ `FLAG_EXTERNAL_LINK_OR_BROKEN_FORMULA` theo dòng; khối lượng lỗi → 0 kèm cảnh báo, không dùng im lặng.
    Phần `xl/externalLinks` của file cũng được báo ở mức file.
63. **Bộ giá theo `data-contract.md`**: thêm `jurisdiction_at_issue`, `source_file_url`, `source_sha256` (tính khi nhập file),
    `verification_status` (verified / needs_review / not_verified / superseded), `transport_included`, `work_type`; dòng giá lưu
    `description_original`, `unit_original`, `value_original`, `vat_status`, `source_locator`, `commercial_terms`, `verification_status`.
    Endpoint `/price-books/:id/records` xuất đúng tên trường hợp đồng; trường không có dữ liệu để trống (“missing”), không phỏng đoán.
64. **Sáp nhập tỉnh** (`data/province-mergers.json`, chỉ 4 trường hợp ghi trong `nguon-chinh-thuc.md`): bộ giá của tỉnh cũ phải khai
    tỉnh kế thừa đúng và kỳ giá trước 01/07/2025; chỉ được đề xuất cho công trình có khu vực trùng tỉnh cũ (không áp cho toàn tỉnh mới).
    Danh sách đề xuất trả kèm các bộ bị loại và lý do.
65. **Vận chuyển đến công trình**: chặng vận chuyển theo tài nguyên và công trình; tiền/đơn vị = cự ly × cước × trọng lượng × hệ số + bốc dỡ
    + phí. Chỉ cộng khi nguồn giá chưa gồm vận chuyển: giá gốc thư viện → cộng; bộ giá “chưa gồm”/“chưa rõ” → cộng (ghi chú khi chưa rõ);
    bộ giá “đã gồm” và **giá nhập tay (coi là giá đến công trình)** → không cộng, ghi chú “tránh tính 2 lần”. Giá nguồn và phần vận chuyển
    được lưu riêng trong nguồn giá.
66. **Báo cáo kiểm tra** (`/projects/:id/validation`, tab “Kiểm tra”): 13 nhóm theo mục 6 của skill engine (đủ trường, KL = Σ dòng,
    thành tiền = KL × đơn giá, đơn vị khớp định mức, hiệu lực định mức/bộ quy tắc, mã chưa giải quyết, GTT/báo giá có nguồn, nguồn giá tài
    nguyên, tổng cha = con và chuỗi bảng tổng hợp, đối chiếu đơn giá với phân tích hao phí, hệ số bất thường/áp hai lần, ô lỗi/liên kết
    ngoài, trùng lặp). Báo cáo không chặn duyệt dự toán (chỉ mã “tự động” chưa xác nhận mới chặn) – người duyệt tự đánh giá.
67. **Bộ quy tắc chi phí dạng dữ liệu** (`CostRuleSet`, biểu thức đánh giá bằng parser an toàn, danh sách biến cho phép). Các biến thể tỷ lệ
    cũ quan sát trong kho mẫu (TT 1,5%, C 6%, TL 5,5%, VAT 10%, Glt 1%…) nằm ở `data/cost-rules/legacy-observed.json` với
    `status: reference_only` – **không bao giờ được chọn làm mặc định** (có test). Bảng tổng hợp thực tế vẫn theo bộ pháp lý của công trình.
68. Toàn bộ `test_cases.json` của skill được chạy trong `packages/core/test/engine-skill.test.ts` (đọc trực tiếp file của skill).



## Nhập TT 38/2026, Phụ lục VII, bộ giá HCM (27–28/09/2026)
69. **Bộ định mức TT38_2026** (`npm run import:tt38`, idempotent): 9.012 mã / 53.503 dòng hao phí từ CSV; mỗi mã giữ phụ lục, mục, công tác, biến thể,
    trang, file nguồn, sha256 (đối chiếu `manifest.json`), trạng thái `imported_needs_review`. Tài nguyên gom theo (loại, tên, đơn vị) chuẩn hóa với
    mã xác định (băm) nên chạy lại không sinh trùng; “Nhân công nhóm N” là một tài nguyên dùng chung. Định mức mẫu vẫn giữ cờ `is_sample`.
70. **Dòng %** (“Vật liệu khác”, “Máy khác”, đơn vị `%`) là quy tắc tỷ lệ trên tổng VL/M *trước khi* cộng % (`norm_resources.pct_base`), cộng vào loại
    của chính nó; các dòng % của cùng gốc không cộng dồn lên nhau. Tên bị dính do tách PDF (“Vật liệu khác Nhân công”…) vẫn được coi là dòng % vì
    quy tắc dựa vào đơn vị `%`, không dựa vào tên.
71. **Tìm/gợi ý mã trên dữ liệu thật**: đơn vị kèm ghi chú đo lường (“100m3 đất nguyên thổ”) được quy về đơn vị gốc khi so tương thích (chỉ khi phần
    chữ đứng cuối chuỗi; “/1km”, “công/đơn vị vật liệu” là đơn vị khác, giữ nguyên); “Cấp đất – I” và “đường kính cốt thép (mm) – ≤18” được hiểu như
    “đất cấp I”, “đk ≤18”. Nhiều mã TT38 chỉ khác nhau bởi tham số không nằm trong tên (cỡ gàu, chiều cao) → cùng điểm, hệ thống xếp theo mã: kết quả
    xác định nhưng người dùng phải chọn đúng biến thể.
72. **Phụ lục VII** (`npm run import:tt38-pl7`): 1.082 mã cấp phối (3 mã trùng do lỗi in bị bỏ, lấy bản đầu), `imported_needs_review`. Tài nguyên
    “Vữa…” của định mức được bóc tách theo mã cấp phối chọn **cho từng công việc** (tùy chọn; `estimate_items.mix_code`), tính riêng từng công việc
    (`normResourcesOverride`) để hai công việc cùng mã định mức có thể dùng mác khác nhau. Chương 12 trở đi của nguồn còn thiếu dòng vật liệu (ghi trong
    README của dữ liệu) – chưa dùng cho mọi loại vữa.
73. **Bộ giá chỉ có thông tin văn bản** (HCM 02/2026, 06/2026, 08/2026): 0 dòng giá, `needs_review`; số hiệu thông báo 06/2026 không có trong lớp văn
    bản nên để trống thay vì đoán. Danh sách đơn vị công bố của kỳ 06/2026 lưu ở `price_book_suppliers` (25 nhóm; 54 dòng gồm 5 nhóm không có đơn vị
    tham gia; 49 công văn – số liệu thật của CSV, không ép về 48). Bộ chưa có dòng giá bị bỏ qua khi chọn bộ giá theo khu vực.

## Update 3 (docs/UPDATE-3.md)
74. **Công thức không có giá trị lưu sẵn**: SheetJS bỏ hẳn ô công thức có `<v></v>` nên công thức được đọc thẳng từ XML của sheet
    (`xmlFormulas`), rồi tính bằng `evaluateSheetFormula` (+ − × ÷ ^, ngoặc, `SUM` theo dải/ô, tham chiếu cùng sheet; ô trống = 0 như Excel;
    vòng tham chiếu/hàm khác/sheet khác → không tính). Không tính được → ô để trống + cờ `FLAG_FORMULA_NOT_EVALUATED`, không nhập 0.
75. **Tiêu đề 2 dòng không gộp ô**: ô nhóm có ô phải trống và hàng dưới có nhãn con thì trải sang các cột đó (“Đơn giá / Vật liệu”, “Đơn giá /
    Nhân công”); danh sách cột cho người dùng gồm mọi cột có dữ liệu với chữ cái, tiêu đề ghép và 3 giá trị mẫu.
76. **Ánh xạ do người dùng quyết định**: nhận diện chỉ điền sẵn; mỗi trường bật/tắt và chọn cột tự do, đổi vùng tiêu đề/dữ liệu, đổi loại từng dòng.
    Dòng có công thức `SUM` ở cột Thành tiền và không có khối lượng được coi là dòng cộng.
77. **Tùy chọn đơn giá** (API `pricingOption`, mặc định giao diện = `file`; API mặc định `norm` để giữ tương thích): `file` → mọi công việc có đơn giá
    trong file thành `CUSTOM_GTT` với VL/NC/M của file, nguồn “File Excel <tên>, ô F6/G6”, vẫn gắn mã định mức và hiện giá theo định mức chỉ để so sánh
    (không vào tổng, không vào tổng hợp vật tư); `norm` → định mức + bộ giá công trình.
78. **Đối chiếu độ khớp** trước khi nhập: từng dòng (thành tiền file vs KL × đơn giá), từng dòng cộng theo hạng mục và tổng; dung sai 1 đ. Dòng
    “Tổng…” là tổng chung, dòng “Cộng…” là cộng hạng mục; thiếu dòng tổng chung thì so với tổng các dòng cộng.
79. **Mã hiệu khi nhập** (`resolveImportCode`): mã có trong bộ → so tên mô tả với tên định mức bằng độ phủ từ khóa có trọng số + xung đột tham số + đơn vị
    (ngưỡng phủ 50%): khớp hoặc *không khớp* (vẫn giữ mã, cảnh báo, gợi ý top-3, hỏi tham số còn thiếu); mã kiểu cũ vắng trong bộ → *đề xuất chuyển mã*
    trong cùng họ mã (6 ký tự rồi 5 ký tự), độ tin cậy cộng 0,25/0,1; không mã → gợi ý. Mã đề xuất chỉ áp dụng khi người dùng chấp nhận
    (`codeChoices`); mã gốc luôn lưu ở `norm_code_raw`, ô nguồn ở `source_cells`. Dự toán mới chỉ có hạng mục mặc định trống thì hạng mục của file thay thế nó.
80. **Cập nhật theo khu vực = phiên bản có nhật ký** (`estimate_revisions`: ảnh chụp tỉnh/khu vực/ngày giá/bộ giá đã chọn/mã đã đổi; hoàn tác được phiên bản
    mới nhất). Không áp dụng/hoàn tác trên dự toán đã duyệt (phải hủy duyệt hoặc nhân bản). Xem trước tính hai lần (giá hiện tại vs giá bộ mới) bằng
    cùng bộ tính, nên chênh lệch GXDTT/GXD là kết quả thật. Giá nhập tay luôn thắng bộ giá; bộ 0 dòng giá bị bỏ qua; loại giá không tích giữ nguyên lựa chọn cũ.
81. **Chuyển bộ định mức** (mẫu → TT38_2026): tích “kiểm tra và chuyển mã” liệt kê công việc có mã vắng trong bộ hoặc chỉ là mã mẫu, đề xuất như mục 79, áp
    dụng cùng phiên bản (hoàn tác khôi phục mã cũ). Việc đổi giữa hai bộ pháp lý (TT11/2021 ↔ TT36/2026) vẫn ở tab Cài đặt vì kéo theo bảng tỷ lệ chi phí.
82. **Huy hiệu “Có bộ giá mới – Cập nhật?”**: chỉ khi bật “Tự động cập nhật” của công trình và có bộ giá đã xác minh, có dòng giá, cùng tỉnh, kỳ mới hơn bộ đang dùng;
    không bao giờ tự áp dụng.
83. **Kiểm thử**: `update3-import.test.ts` (fixture `test_import.xlsx`: 1.187.500 / 4.384.000 / 15.555.000 / 21.126.500, AB.11213 không khớp, AF.11111 → AF.11110,
    dòng trống → AF.61110), `update3-regional.test.ts`, và `e2e/update3.mjs` (Playwright headless: tải file, đổi ánh xạ tay chọn G = đơn giá nhân công, xác nhận,
    so lưới với file, nút cập nhật khu vực TP. Hồ Chí Minh, xem trước, áp dụng, hoàn tác).

## Update 4 A – sửa nhập Excel (cột tên hiện số, mã trống, đơn vị VNI/TCVN3)
84. **Tái hiện bằng fixture mới** (`npm run fixtures:import` → `scripts/make-import-fixtures.mjs`, bộ mã hóa VNI/TCVN3 suy ra bằng cách đảo bộ giải mã):
    `import_wide.xlsx` (tiêu đề gộp ô, cột ẩn, mô tả gộp 2 cột, số dạng chữ “1.382.500”), `import_vni.xlsx` (3 sheet: VNI, TCVN3, hỗn hợp),
    `import_nameoffset.xlsx` (cột tên sau cột trống; tiêu đề giá chứa “công việc”). Không đụng dữ liệu công trình thật.
85. **Cột tên chọn theo nội dung** (`profileColumns`/`refineMapping`, core): mỗi cột được chấm theo tỷ lệ ô là chữ, độ dài trung bình, từ khóa xây dựng và gợi ý
    tiêu đề; cột có ≥60% ô là số (kể cả số dạng chữ), ≥50% ô giống mã định mức hoặc ≥60% ô là đơn vị đo KHÔNG BAO GIỜ được tự chọn làm tên. Cột mã dự phòng
    theo tỷ lệ khớp mẫu mã (`AF.11111`, `AF11111`, `SA.xxxxx`, `TT12.AF.…`, placeholder `TT`/`VD`/`GTT`); cột đơn vị dự phòng theo nội dung. Cột ẩn và cột
    “phần nối” của ô gộp không bao giờ tự chọn. Người dùng chọn tay cột chủ yếu là số → cảnh báo chặn “Cột này chủ yếu là số – không phải tên công việc”
    với “Vẫn dùng” / “Chọn lại”; API từ chối nhập nếu chưa xác nhận (`allowNumericName`).
86. **Ô gộp**: mọi ô trong vùng gộp đọc giá trị ô chính (mô tả gộp 2 cột, nhóm “Đơn giá” trên VL/NC/M); vùng gộp rộng >3 cột (tiêu đề/hạng mục kéo ngang) không
    đổ xuống các cột ĐVT/KL. `Thành tiền` tách VL/NC/M được cộng lại thành thành tiền của dòng để đối chiếu.
87. **Bảng mã cũ theo từng cột** (không còn bỏ phiếu cả sheet): mỗi cột chọn mã theo đa số ô; ô có dấu hiệu VNI/TCVN3 rõ vẫn được chuyển dù nằm trong cột Unicode
    (chữ Latin-1 hoa nằm giữa chữ thường như “tÊn” là dấu hiệu TCVN3). Ô chứa ký tự chỉ có ở Unicode thật không bị chuyển. TCVN3 (ABC) không có chữ hoa có dấu.
88. **Không để thành tiền = 0 âm thầm**: xem trước có bảng “15 dòng đầu như sẽ hiện trong lưới” (đỏ nếu tên là số / thành tiền 0), cảnh báo số công việc sẽ có thành
    tiền 0, và thông báo sau khi nhập; thành tiền luôn tính lại KL × đơn giá và đối chiếu với file (Update 3).
89. **Sửa lại cột đã nhập**: mỗi lần nhập lưu sheet đã đọc (`import_sources`: giá trị sau khi tính công thức/đổi bảng mã, ô gốc, ô gộp) và gắn `estimate_items.import_id`.
    Nút ⚙ ở hạng mục mở lại ánh xạ từ dữ liệu đã lưu, không cần tải lại file; áp dụng = thay thế công việc của lần nhập đó bằng kết quả mới **dưới dạng phiên bản
    (`estimate_revisions`, kind `reimport`) hoàn tác được** (ảnh chụp hạng mục/công việc/dòng bóc tách/nguồn cũ với đúng id). Lần nhập cũ chưa có dữ liệu gốc: báo “Hãy
    tải lại file Excel”, nhập lại sẽ thay thế hạng mục đó (cũng là phiên bản hoàn tác được).
90. **Gợi ý mã theo chương** (`chapterHints`): Đào/Đắp → AB, Bê tông → AF, Xây → AE, Cốt thép → AF.6, Ván khuôn → AF.8, Trát/Lát/Ốp/Sơn/Bả → AK, Cọc → AC, Lắp đặt ống → BB;
    có từ khóa thì CHỈ đề xuất trong chương đó (không bao giờ SF/SB… cho “ĐÀO ĐẤT”). Dòng chỉ có một cụm chữ ngắn và không có số ở bất kỳ ô nào là dòng hạng mục.
    Hệ quả: test gợi ý “Xây tường gạch ống” đổi từ SB.33110 (chương sửa chữa) sang AE.22110.
91. **Lớp nhà cung cấp AI** (`packages/server/src/ai`): giao diện `ChatProvider` chung; `OpenAiProvider` (SDK `openai`, function calling) và `AnthropicProvider`
    (Messages API, tool use); `AiRegistry` quyết định nhà cung cấp đang dùng: cài đặt trong CSDL (`app_settings`) → `AI_PROVIDER` → tự chọn theo khóa có sẵn → ngoại tuyến.
    Claude cũ (`claude-provider.ts`, chỉ diễn giải câu lệnh) bị thay bằng lớp này.
92. **Khóa API chỉ ở môi trường máy chủ**: không có API nhận khóa, `/ai/status` chỉ trả `hasKey`, `scrub()` xóa mọi chuỗi giống khóa khỏi thông báo lỗi/log,
    CSDL chỉ lưu tên nhà cung cấp + mô hình. Test đối chiếu rằng không phản hồi nào chứa khóa; E2E kiểm tra thêm ở phía trình duyệt.
93. **Công cụ ghi chỉ tạo bản xem trước**: vòng lặp tác tử (`runAgent`) chạy công cụ đọc ngay, còn công cụ ghi trả `Action` + văn bản xem trước; chỉ `POST /confirm` (nút Áp dụng)
    mới thực thi, ghi undo. Cập nhật đơn giá theo khu vực là hành động `regionalUpdate` (dùng `RegionalUpdateService`, hoàn tác bằng phiên bản). Khi mã/khối lượng chưa chắc chắn
    công cụ trả lỗi để mô hình hỏi lại thay vì đoán (không tạo bản xem trước).
94. **Giới hạn & dự phòng**: tối đa 6 vòng, 6000 token đầu ra tích lũy, 60 giây/yêu cầu, lịch sử gửi lên ≤ 10 tin. Lỗi nhà cung cấp (khóa sai, hết hạn mức, giới hạn tốc độ, mạng,
    quá thời gian, mô hình sai) → thông báo tiếng Việt và xử lý lại bằng bộ quy tắc ngoại tuyến; không có khóa thì dùng ngoại tuyến ngay.
95. **Kiểm thử không gọi mạng thật**: nhà cung cấp giả (test đơn vị) và máy chủ OpenAI giả qua `OPENAI_BASE_URL` (E2E). Khi có khóa thật, nút “Kiểm tra kết nối” là cách xác nhận.
96. **Update 4 A-bis (docs/update4/REAL-FILE-FINDINGS.md)**: từ file .xls thật của khách (không commit – đã chuyển vào `data/private/`, nằm trong `.gitignore`), bổ sung một fixture tổng hợp
    `packages/server/test/fixtures/import_tuchang_like.xls` + `.expected.json` (số liệu bịa) cùng script tham khảo Python `docs/update4/vni.py`/`ref.py`, rồi chuyển logic sang TypeScript.
    `npm run check:private-import` đọc `data/private/*.xls|xlsx` (không commit) và in đối chiếu từng sheet/khối để nhà phát triển tự kiểm tra với file thật.
97. **VNI theo từng ô, không theo cả cột**: `hasVniMarkers`/`fixVniCell` ([[core/encoding]]) phát hiện dấu hiệu VNI thật (nguyên âm + dấu phụ, “ñ/Ñ”) khác với chữ Unicode thường có
    “ô/ê” (không phải dấu hiệu); một ô vừa VNI vừa Unicode thật (“Eùp coïc thử tĩnh Φ400”) chỉ các từ có dấu hiệu được chuyển, từ còn lại giữ nguyên. `splitChinese` tách phần tiếng Trung
    cuối một ô song ngữ (hoặc đầu ô kiểu “混凝土垫层 / Bê tông lót móng”) thành `nameZh`, hiển thị trong cột ghi chú/mới `name_zh` của `estimate_items`.
98. **`detectBlocks`**: một sheet có thể lặp lại dòng tiêu đề cho từng hạng mục con (mỗi bảng = 1 khối); tiêu đề lấy từ dòng chữ gần nhất phía trên khối (ưu tiên “Hạng mục : …”),
    bỏ số thứ tự và phần tiếng Trung (`cleanBlockTitle`). `classifyRows` nhận biết thêm dòng **diễn giải khối lượng** (Dài×Rộng×Cao×Số cấu kiện ngay dưới 1 công việc, không có mã/ĐVT) –
    gắn vào công việc đó qua `quantity_lines` **mà không đổi khối lượng của file** (chỉ cảnh báo nếu tổng diễn giải lệch); và dòng **trọn gói** (chỉ có Thành tiền, không ĐVT/KL) – nhập
    với khối lượng = 1, trừ khi Thành tiền đó khớp tổng các dòng ngay dưới (khi đó là dòng hạng mục mang luôn số tổng, không phải 1 công việc).
99. **Nhập nhiều sheet một lần** (`import-multi.ts`, route `POST /import/analyze-multi` + `POST /projects/:id/import-sheets`): mỗi khối của mỗi sheet được chọn → 1 hạng mục (tên theo
    tiêu đề khối, trùng tên thì thêm hậu tố); sheet ẩn không tự chọn. Sheet tổng hợp kiểu TONGHOP (`isSummarySheet`) không tạo công việc, chỉ dùng để đối chiếu: so khớp tên gần đúng +
    số tiền giữa các dòng của nó và các khối đã phân tích (`import_summaries`, lưu lại để xem sau). Giao diện chọn nhiều sheet cho web là việc tiếp theo; màn hình nhập 1 file hiện có
    vẫn hoạt động (dùng khối đầu tiên của sheet được phát hiện).
100. **Thiết bị/vật tư theo báo giá (TB/VT)**: sheet MEP (`isMepSheet`: có cột “Tiêu chí kỹ thuật”/“Nhãn hiệu” hoặc tên theo “01-Điện…”) không ép từng dòng phải có mã định mức –
    công việc không có mã được đánh dấu `codeStatus = 'tbvt'`, loại khỏi danh sách “cần xem lại”/gợi ý mã tự động, không phải lỗi. `unassignedItems` cũng bao quát công việc dùng giá
    file (CUSTOM_GTT nguồn “File Excel …”) thay vì chỉ NORM_BASED.
101. **PL6 (sửa chữa) không mặc định**: `NormIndex.suggest(..., { allowRepair })` loại các mã S* trừ khi dự án/hạng mục/mô tả có từ “sửa chữa/cải tạo/bảo trì/nâng cấp”
    (`Repo.isRepairContext`). Thêm chương AA cho “đập/phá đầu cọc” và gộp `work` của câu hỏi lẫn tên định mức thành cùng nhãn `pha_dau_coc` (tránh điểm bị trừ do “đập” và “đắp” cùng
    mất dấu thành “dap”). Đơn vị vẫn là bộ lọc cứng: khối lượng đếm bằng “cái” trong khi định mức chính thức tính theo m3 (đập đầu cọc) thì KHÔNG có gợi ý tin cậy – người dùng tự quy đổi.
102. **Giao diện nhập nhiều sheet** (`MultiSheetImport.tsx`, nút “⤓ Nhập nhiều sheet”): tải file → chọn sheet (sheet ẩn gập lại, mặc định không chọn) → mỗi bảng (khối) hiện số công việc/diễn giải/chưa giá/thiếu ĐVT/TB-VT,
    nút “Xem trước” hiện 15 dòng đầu như sẽ lên lưới (tên đã chuyển Unicode, phần tiếng Trung tách riêng), dấu ✔/⚠ đối chiếu với “Cộng trước thuế” của khối và với sheet tổng hợp (TONGHOP) nếu có; đổi
    “Giữ nguyên đơn giá file/Tính lại theo định mức” hoặc tick “sheet điện nước/MEP…” gọi lại `POST /import/analyze-multi` ngay. “Nhập dữ liệu” gọi `POST /projects/:id/import-sheets` một lần, tạo TẤT CẢ
    hạng mục trong một giao dịch, một bước hoàn tác duy nhất (↶ Hoàn tác ở khung trợ lý hoàn tác cả lần nhập). Bảng bị chặn (cột tên công việc không hợp lệ) vô hiệu hoá nút nhập cho tới khi bỏ chọn sheet đó.
103. **Tiêu đề phụ trong khối không tạo thêm hạng mục**: khi nhập theo khối (`categoryPrefix`), dòng tiêu đề La Mã bên trong khối (“I PHẦN MÓNG”, “II CÔNG TÁC BÊ TÔNG”) không còn tách thành hạng mục riêng
    (sẽ làm vỡ quy tắc 1 khối = 1 hạng mục) mà ghi vào ghi chú “Nhóm: …” của từng công việc, giữ nguyên ngữ cảnh mà không làm vỡ cấu trúc hạng mục.
104. **Nút “Nhập lại từ file Excel (thay thế hạng mục đã nhập)”** (↻, cạnh ⚙ trên mỗi hạng mục đã nhập): luôn tải file mới (khác với ⚙ “Sửa lại cột đã nhập” mở lại dữ liệu đã lưu), dùng lại cơ chế
    `replaceCategoryIds` sẵn có của màn hình nhập 1 sheet – thay thế đúng hạng mục đó thành phiên bản hoàn tác được, không đụng hạng mục khác.
105. **`npm run check:private-import` in thêm bảng tóm tắt** (sheet, khối, số công việc, tổng file, tổng nhập, lệch) và với mỗi khối lệch, liệt kê các dòng gây lệch nhiều nhất (so Thành tiền file với
    Thành tiền tính lại của từng dòng) để biết ngay lý do (thường là Thành tiền = 0 trong file nhưng có đơn giá VL/NC → tính lại ra số khác 0, hoặc dòng cộng/trọn gói không khớp Σ công việc).
