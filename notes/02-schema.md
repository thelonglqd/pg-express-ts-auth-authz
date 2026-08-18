## `timestamptz` vs `timestamp`

**Điểm dễ hiểu nhầm:** `timestamptz` **không lưu timezone**. Nó lưu một
số nguyên 8 byte — số micro giây kể từ mốc UTC. Không có chuỗi, không có
nhãn múi giờ nào được lưu cùng.

Khác biệt nằm ở lúc **ghi** và lúc **đọc**:

- Ghi: input được chuẩn hóa về UTC rồi mới lưu
- Đọc: con số đó được format lại theo tham số `TimeZone` của connection

```sql
SHOW TimeZone;                        -- xem setting hiện tại
SET TimeZone = 'Asia/Ho_Chi_Minh';    -- chỉ ảnh hưởng connection này
```

Mặc định lấy từ `postgresql.conf`; container `postgres` thường để `UTC`.
Hai connection khác setting sẽ thấy hai chuỗi khác nhau cho **cùng một
dòng dữ liệu** — vì dữ liệu chỉ là một con số, phần hiển thị là do format.

Với Node thì ít ảnh hưởng: `pg` convert thẳng sang JS `Date`, mà `Date`
cũng là mốc UTC. Hiển thị theo múi giờ nào là việc của tầng UI.

|               | Lưu gì                  | Ghi 10:00 từ VN | Đọc ở connection UTC  |
| ------------- | ----------------------- | --------------- | --------------------- |
| `timestamp`   | con số đồng hồ hiển thị | `10:00`         | `10:00` ← sai 7 tiếng |
| `timestamptz` | thời điểm tuyệt đối     | `03:00Z`        | `03:00Z` → đúng       |

**Vì sao quan trọng với auth:** auth toàn so sánh thời gian —
`WHERE expires_at > now()`. Nếu `expires_at` ghi từ server múi giờ khác
`now()` đang chạy thì lệch 7 tiếng: token hết hạn vẫn dùng được, hoặc
token còn hạn bị từ chối. Bug này chạy đúng trên máy dev (cùng múi giờ),
chỉ hỏng khi lên production.

Thêm nữa DST: nhiều nước lùi đồng hồ 1 tiếng mỗi năm → có mốc giờ
**xuất hiện hai lần** trong một đêm → hai sự kiện khác nhau ra cùng giá
trị với `timestamp`.

**Khi nào dùng `timestamp`:** khi thời điểm tuyệt đối không có ý nghĩa —
giờ mở/đóng cửa (9:00 là 9:00 giờ địa phương ở bất cứ đâu), ngày sinh.
Hiếm.

**Quy tắc:** dữ liệu ghi lại "chuyện này xảy ra lúc nào" — `created_at`,
`expires_at`, `last_login_at` — luôn `timestamptz`. Cùng 8 byte, không
tốn thêm gì.

---

## Email case-insensitive

**Vấn đề:** `Zag@x.com` và `zag@x.com` phải là **một người**. Với `text` +
`UNIQUE` thì đó là hai dòng khác nhau → đăng ký trùng được, hoặc login
thất bại vì gõ hoa chữ đầu.

**Cách đang làm — normalize ở tầng app:**

```ts
email: z.email()
```

Zod v4 đổi API: `z.email()` là hàm top-level, `.email()` dạng method đã
deprecated. Vì `z.email()` nhận string đã hợp lệ, muốn trim trước thì
phải dùng `.pipe()` — normalize xong mới validate.

**Điểm yếu:** mọi đường ghi vào DB đều phải nhớ normalize — register,
login, reset password, script seed. Sót một chỗ là ràng buộc vỡ.

**Cách chắc hơn — đẩy xuống DB.** Hai lựa chọn:

**`citext`** — kiểu text case-insensitive. Là extension, phải bật trước:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
-- rồi: email citext NOT NULL UNIQUE
```

Sau đó `=`, `UNIQUE`, `LIKE`, index đều tự động không phân biệt hoa
thường. Insert `abc@x.com` rồi `ABC@x.com` → ăn `23505` ngay.

Nhược: extension không phải môi trường nào cũng có (managed DB đôi khi
chặn), và một số ORM không hiểu kiểu này.

**Unique index trên biểu thức** — không cần extension:

```sql
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
```

Nhược: phải nhớ viết `WHERE lower(email) = $1` khi query, nếu không index
không được dùng.

**Nguyên tắc chung:** ràng buộc quan trọng nên nằm ở **lớp thấp nhất có
thể**, vì lớp đó không ai đi vòng qua được. Cùng tinh thần với
`defense in depth`.
