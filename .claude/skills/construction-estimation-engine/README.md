# Phân tích kho mẫu dự toán xây dựng

## Phạm vi dữ liệu
- Tổng số file: 271
- XLS legacy: 248
- XLSX: 9
- CTS: 12
- MPP: 1
- INI: 1
- Số mã hiệu dạng định mức phát hiện trong chuỗi nhị phân XLS legacy: 10461 mã duy nhất (chỉ dùng làm chỉ báo vì có thể gồm dữ liệu ẩn/template).
- Prefix xuất hiện nhiều: AF (33405), BB (23201), AB (22586), AE (13159), AK (9862), AC (6423), BA (5380), AI (4290), AG (4221), AD (3888), AL (3627), BD (3171), AA (2290), BC (1457), CM (981).

## Các nhóm nghiệp vụ quan sát được
1. Bóc tách khối lượng từ kích thước/công thức chi tiết.
2. Danh mục mã hiệu định mức + tên công tác + đơn vị.
3. Phân tích hao phí vật liệu, nhân công, máy theo định mức.
4. Tổng hợp vật tư.
5. Giá vật liệu tới chân công trình, gồm cự ly/cước/hệ số/bốc dỡ/trạm phí ở một số mẫu.
6. Bảng giá nhân công và máy thi công.
7. Đơn giá chi tiết hoặc đơn giá tổng hợp.
8. Tổng hợp kinh phí theo hạng mục/công trình.
9. Chi tiết cốt thép: đường kính, chiều dài, số lượng, trọng lượng đơn vị, khối lượng.
10. Các công tác tạm tính/thị trường (`GTT`) và các ngoại lệ không theo mã định mức.

## Điểm thiết kế quan trọng
- Không hard-code các tỷ lệ chi phí. Bộ mẫu chứa nhiều biến thể tỷ lệ và hệ số.
- Mã hiệu phải được version hóa theo bộ định mức và ngày hiệu lực.
- Text legacy cần chuẩn hóa encoding nhưng phải giữ nguyên raw text.
- Công thức khối lượng là dữ liệu nghiệp vụ cấp một, phải lưu và audit được.
- Giá vật tư phải có nguồn, thời điểm, địa bàn và trạng thái đã gồm vận chuyển/thuế hay chưa.
- Mọi kết quả cần truy vết về file/sheet/cell hoặc nguồn nhập.

## Hạn chế của việc trích xuất
- 248 file `.xls` là định dạng BIFF cũ. Trong pack này, mã hiệu legacy được quét heuristic từ chuỗi nhị phân để thống kê phạm vi.
- 9 file `.xlsx` được đọc ở mức ô/bảng để xác nhận cấu trúc, công thức và quan hệ dữ liệu.
- Các file `.cts` là định dạng phần mềm dự toán chuyên dụng và không được giả định tương đương Excel.
