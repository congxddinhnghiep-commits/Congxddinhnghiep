---
name: construction-estimation-engine
description: Phân tích, chuẩn hóa, bóc tách khối lượng, áp mã định mức, phân tích hao phí, lập đơn giá và tổng hợp chi phí cho dự toán xây dựng từ dữ liệu Excel/BOQ hoặc dữ liệu nhập trong app. Dùng khi người dùng cần tạo/kiểm tra dự toán, tra mã hiệu, tính khối lượng, phân tích vật tư-nhân công-máy, áp bộ quy tắc chi phí hoặc kiểm tra sai lệch.
---

# Construction Estimation Engine

## 1. Mục tiêu
Biến dữ liệu dự toán thô thành mô hình có thể tính toán, kiểm tra, audit và tái sử dụng. Không coi bảng Excel là mô hình dữ liệu; Excel chỉ là một nguồn nhập/xuất.

## 2. Nguyên tắc bắt buộc
1. Giữ `raw_value` và `normalized_value` song song.
2. Không tự động chọn mã định mức khi độ tin cậy thấp; trả về danh sách ứng viên và lý do.
3. Không hard-code tỷ lệ chi phí chung, trực tiếp khác, thu nhập chịu thuế tính trước, VAT, lán trại hoặc hệ số điều chỉnh.
4. Mọi tỷ lệ/hệ số lấy từ `CostRuleSet` có version, thời gian hiệu lực, địa bàn, loại công trình và chuyên ngành.
5. Mọi đơn giá vật liệu/nhân công/máy phải có nguồn và ngày giá.
6. Mọi phép tính phải lưu công thức, đầu vào, kết quả và quy tắc đã dùng.
7. Dòng tiêu đề/subtotal không được xử lý như công tác.
8. Mã `GTT` hoặc công tác không có mã định mức phải đi theo luồng `CUSTOM_GTT/MARKET_QUOTE`.
9. Khi có `#NAME?`, `#REF!`, external link hoặc công thức lỗi, không dùng giá trị đó một cách im lặng; phải cảnh báo.

## 3. Pipeline chuẩn

### Bước A — Import & nhận dạng bảng
Phân loại sheet/section thành:
- PROJECT_INFO
- QUANTITY_TAKEOFF
- ESTIMATE_ITEMS
- NORM_ANALYSIS
- RESOURCE_SUMMARY
- MATERIAL_PRICE
- LABOR_MACHINE_PRICE
- COMPOSITE_UNIT_PRICE
- COST_SUMMARY
- STEEL_DETAIL
- OTHER

Nhận dạng theo header thay vì tên sheet cố định vì kho mẫu có các tên như `Khoi luong`, `kl thi cong`, `Phan tich Vat tu`, `BANG4`, `BANG5`, `Kinh phi`, `THKP`, `VT`, `Summary`, `Steel`.

### Bước B — Chuẩn hóa
Chuẩn hóa:
- encoding tiếng Việt legacy → Unicode;
- mã định mức;
- đơn vị;
- dấu thập phân/hàng nghìn;
- tên vật tư, máy, bậc nhân công;
- phân cấp hạng mục.

Luôn lưu bản gốc.

### Bước C — Bóc tách khối lượng
Mỗi `EstimateItem` có một hoặc nhiều `QuantityLine`.
Parser hỗ trợ `+ - * / ()`, hệ số, phần trăm, dòng trừ lỗ mở và quy đổi đơn vị.

Ví dụ:
- `6.6*14.2*3.8`
- `12.1*6.2*0.1 + 1.8*5.6*0.1`
- `13*5.4*0.1 - 9*0.6*0.6*0.1`
- `(L+W)*2*H*N`
- dữ liệu mm: `L*W*H*N / 1e9` → m³

Không dùng `eval` trực tiếp. Dùng AST whitelist cho số, biến và toán tử hợp lệ.

### Bước D — Áp mã định mức
Input: mô tả công tác, đơn vị, chuyên ngành, điều kiện thi công, vật liệu/mác/kích thước.

Trình tự:
1. exact code nếu có;
2. canonical-code match;
3. text + unit + discipline search;
4. điều kiện chi tiết;
5. trả top candidates với confidence.

Không quyết định chỉ dựa trên prefix.

### Bước E — Phân tích hao phí
Cho từng mã:
`hao_phi_tai_nguyen = khoi_luong_cong_tac * dinh_muc * he_so_dieu_chinh`

Phân nhóm:
- Vật liệu
- Nhân công
- Máy
- Khác

Tổng hợp cùng resource sau khi chuẩn hóa unit.

### Bước F — Giá tài nguyên
Giá hiệu lực được chọn theo:
1. resource;
2. location;
3. effective date;
4. price type;
5. source priority.

Vật liệu có thể có:
`giá đến công trình = giá nguồn + cước vận chuyển + bốc dỡ + phí + điều chỉnh`

Không cộng lại vận chuyển nếu nguồn giá đã gồm vận chuyển.

### Bước G — Đơn giá công tác
`VL_item = Σ(hao phí VL × giá VL)`
`NC_item = Σ(hao phí NC × giá NC)`
`M_item = Σ(hao phí M × giá M)`

Nếu định mức quy định vật liệu phụ theo %, tính bằng rule tương ứng và lưu riêng.

### Bước H — Tổng hợp chi phí
Các biến chuẩn:
- `VL`: vật liệu
- `NC`: nhân công
- `M`: máy
- `TT/Tk`: trực tiếp khác
- `T`: trực tiếp
- `C`: chi phí chung
- `TL`: thu nhập chịu thuế tính trước
- `G/Z`: trước thuế
- `VAT`
- `Gs/Gxl`: sau thuế
- `Glt`: lán trại/tạm
- `Gdt`: tổng theo bộ quy tắc

Công thức cụ thể do `CostRuleSet` cung cấp. Kho mẫu có nhiều biến thể; không lấy một mẫu làm công thức mặc định toàn hệ thống.

## 4. Mô hình mã hiệu
Lưu:
- `norm_code_raw`
- `norm_code_normalized`
- `norm_set`
- `norm_version`
- `effective_from/to`
- `work_name`
- `unit`
- `discipline`

Chuẩn hóa ví dụ `AF11121` ↔ `AF.11121`, nhưng chỉ khi quy tắc canonical của bộ định mức xác nhận.

Mã custom như `GTT`:
- không ép vào định mức;
- yêu cầu nguồn giá hoặc cấu thành riêng;
- đánh dấu `pricing_method=CUSTOM_GTT`.

## 5. Dữ liệu tối thiểu cần có

### Công trình
Tên, loại công trình, địa điểm, ngày lập dự toán, tiền tệ, bộ quy tắc.

### Công tác
Mã, tên, đơn vị, khối lượng, công thức khối lượng, hạng mục cha.

### Định mức
Bộ định mức, version, mã, đơn vị, danh sách hao phí.

### Tài nguyên
Tên, loại, đơn vị, quy cách, giá, nguồn giá, ngày giá, địa bàn.

### Quy tắc chi phí
Cơ sở tính, tỷ lệ/hệ số, biểu thức, điều kiện áp dụng, ngày hiệu lực.

## 6. Kiểm tra bắt buộc
- `quantity == sum(quantity_lines)`
- `amount == quantity * unit_price`
- unit của item phù hợp unit định mức
- định mức hiệu lực đúng thời điểm
- không có mã unresolved mà vẫn tính silent
- resource price có nguồn/ngày/địa bàn
- tổng parent = tổng children
- component unit price reconcile với resource analysis
- cảnh báo hệ số bất thường hoặc áp hai lần
- cảnh báo external links, `#NAME?`, `#REF!`
- cảnh báo công thức quantity có đơn vị không tương thích

## 7. Output chuẩn
App nên trả:
1. Bảng khối lượng.
2. Bảng dự toán chi tiết.
3. Bảng phân tích đơn giá.
4. Bảng phân tích/tổng hợp vật tư.
5. Bảng giá vật liệu.
6. Bảng giá nhân công/máy.
7. Bảng tổng hợp kinh phí.
8. Bảng chênh lệch/điều chỉnh.
9. Audit log.
10. Danh sách lỗi/cảnh báo.

## 8. API gợi ý
- `POST /projects`
- `POST /imports/estimate`
- `POST /quantity/evaluate`
- `GET /norms/search`
- `POST /items/{id}/assign-norm`
- `POST /items/{id}/analyze-resources`
- `POST /pricing/resolve`
- `POST /estimates/{id}/recalculate`
- `GET /estimates/{id}/summary`
- `GET /estimates/{id}/validation`
- `GET /estimates/{id}/audit`

## 9. Trả lời/agent behavior
Khi người dùng nhập một công tác:
1. xác định tên công tác + unit + điều kiện;
2. tìm mã ứng viên;
3. hiển thị confidence;
4. nếu đủ dữ liệu, tính quantity/đơn giá;
5. nếu thiếu dữ liệu, nêu đúng trường thiếu;
6. không bịa mã, định mức, giá hoặc tỷ lệ.

Khi import file:
1. nhận dạng cấu trúc;
2. map cột;
3. chuẩn hóa;
4. tạo preview;
5. validate;
6. chỉ commit sau khi map hợp lệ.
