# Lược đồ dữ liệu nhập phần mềm dự toán

## Quy tắc

- Lưu tệp công bố gốc bất biến. Dữ liệu trích xuất là bản ghi riêng, liên kết bằng `source_id` và số trang/dòng/bảng.
- Không gộp giá khác kỳ, địa bàn, quy cách, nguồn gốc, điều kiện thương mại hoặc trạng thái VAT.
- Lưu đơn vị gốc và đơn vị chuẩn; chỉ quy đổi khi có hệ số, công thức và nguồn được ghi rõ.
- Lưu mọi ngày theo ISO 8601 (`YYYY-MM-DD`) và số tiền dưới dạng số nguyên VND hoặc decimal chính xác, không lưu dưới dạng chuỗi định dạng.
- Khi không tìm được trường từ tệp, để trống và đánh dấu `missing`; không tự điền bằng phỏng đoán.

## Trường bản ghi giá/định mức

| Trường | Kiểu | Bắt buộc | Diễn giải |
|---|---|---:|---|
| `record_id` | string | Có | Khóa duy nhất của bản ghi nhập. |
| `record_type` | enum | Có | `norm`, `material_price`, `labor_rate`, `machine_rate`, `construction_index`, `unit_price`, `market_quote`. |
| `jurisdiction_current` | string | Có | Địa phương hiện tại dùng để tìm kiếm. |
| `jurisdiction_at_issue` | string | Có | Tên địa phương tại thời điểm ban hành văn bản. |
| `area_code_or_name` | string | Khi có | Khu vực, xã/phường, vùng giá hoặc địa bàn trong phụ lục. |
| `work_type` | string | Khi có | Loại công trình/hạng mục áp dụng. |
| `item_code` | string | Khi có | Mã vật liệu, mã định mức, loại nhân công/máy hoặc mã đơn giá. |
| `description_original` | string | Có | Mô tả nguyên văn, giữ quy cách và phẩm cấp. |
| `description_normalized` | string | Có | Tên chuẩn để tìm kiếm; không thay thế mô tả nguyên văn. |
| `unit_original` | string | Có | Đơn vị trong nguồn. |
| `unit_normalized` | string | Khi có | Đơn vị chuẩn sau quy đổi được duyệt. |
| `value_original` | decimal/string | Có | Giá trị/cường độ hao phí đọc từ nguồn. |
| `currency` | string | Khi là giá | Thường `VND`; để trống cho dữ liệu không phải giá. |
| `vat_status` | enum | Khi là giá | `before_vat`, `including_vat`, `not_stated`, `not_applicable`. |
| `period_from` | date | Có | Kỳ dữ liệu có hiệu lực/được công bố áp dụng. |
| `period_to` | date | Khi có | Ngày hết hiệu lực nếu nguồn quy định. |
| `publication_no` | string | Có | Số/ký hiệu thông báo, quyết định hoặc công văn. |
| `publication_date` | date | Có | Ngày ban hành; không thay cho kỳ giá. |
| `issuing_body` | string | Có | Cơ quan ban hành đúng theo tài liệu. |
| `source_page_url` | URL | Có | Trang công bố chính thức hoặc trang chỉ mục chính thức. |
| `source_file_url` | URL | Có | URL tải tệp; có thể bằng trang công bố nếu tải qua nút đính kèm. |
| `source_file_name` | string | Có | Tên file tải nguyên bản. |
| `source_sha256` | string | Sau tải | SHA-256 dùng để kiểm tra bản tệp. |
| `source_locator` | string | Có | Trang, sheet, bảng, dòng hoặc mục trong văn bản. |
| `commercial_terms` | string | Khi có | Tại mỏ/kho/công trình; giao nhận, bốc xúc, vận chuyển, cự ly. |
| `normalization_formula` | string | Khi quy đổi | Công thức, hệ số và lý do quy đổi. |
| `verification_status` | enum | Có | `verified`, `needs_review`, `not_verified`, `superseded`. |
| `verified_at` | datetime | Sau xác minh | Thời điểm kiểm tra nguồn. |
| `verified_by` | string | Khi nhập | Người/tiến trình thực hiện. |
| `notes` | string | Không | Ngoại lệ, giới hạn và quyết định duyệt. |

## Các bảng dữ liệu nên tách

1. **Nguồn văn bản**: một dòng cho mỗi thông báo/quyết định, kèm cơ quan, ngày, kỳ, URLs, tên tệp, checksum, trạng thái hiệu lực và phạm vi địa bàn.
2. **Hao phí định mức**: một dòng cho từng nguồn lực trong mã công tác (vật liệu, nhân công, máy), hệ số hao phí, đơn vị, điều kiện/ghi chú và số trang nguồn.
3. **Giá nguồn**: một dòng cho từng mã/loại hàng và điều kiện thương mại/địa bàn; không trộn giá nguồn với giá đã hiệu chỉnh.
4. **Kết quả áp dụng**: liên kết dòng BOQ với bản ghi hao phí và giá; ghi giá dùng, phép tính, điều chỉnh được phê duyệt, ngày lập và snapshot nguồn.

## Kiểm tra dữ liệu

- Kiểm tra khóa trùng theo `record_type + publication_no + item_code + area_code_or_name + period_from + unit_original + commercial_terms`.
- Đối chiếu số trang, số dòng và các tổng cộng của phụ lục; chú ý tiêu đề lặp, ô gộp, dòng ghi chú, dấu phẩy/chấm thập phân và dấu âm.
- Soát trường bắt buộc rỗng, giá trị âm, đơn vị không hợp lệ, kỳ chồng lấn, khác nhau giữa ngày ban hành và kỳ giá, hồ sơ đính chính/thay thế.
- Không tự tính giá ca máy hoặc đơn giá công tác từ nguồn rời rạc nếu không có đủ công thức và đầu vào được xác minh.
