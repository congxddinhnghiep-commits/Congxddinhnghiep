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

