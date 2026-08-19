# 04 — Password & hashing

Mật khẩu không được lưu. Cái được lưu là kết quả của một phép biến đổi
một chiều, và toàn bộ file này là về việc chọn phép biến đổi nào, với
tham số gì, cho loại dữ liệu nào.

Sợi chỉ xuyên suốt: **thuật toán hash được chọn theo tính chất của
input, không theo "cái nào an toàn hơn"**. Mật khẩu và session token
cùng được hash, nhưng dùng hai thuật toán ngược nhau về mục tiêu.

---

## Hash không có chiều ngược

**Vấn đề:** trực giác ban đầu là "hash rồi thì giải mã kiểu gì". Câu hỏi
này sai từ tiền đề — hash không phải mã hóa, không có khóa, không có
hàm nghịch đảo. Kẻ tấn công lấy được bảng `users` không "giải" gì cả:
hắn **đoán** một chuỗi, hash lên, so với cột `password_hash`.

**Cách xử lý:** vì tấn công là vòng lặp đoán–hash–đối chiếu, phòng thủ
phải nhắm vào **tốc độ của vòng lặp đó**, không phải vào độ phức tạp
của phép biến đổi. Đây là lý do tồn tại của cả nhóm thuật toán
password hashing (bcrypt, scrypt, Argon2): chúng được thiết kế để
_chậm_, chứ không phải để _khó hiểu_.

**Liên quan:** [bcrypt cost](#bcrypt-chậm-có-chủ-đích--cost)

---

## bcrypt chậm có chủ đích — `cost`

**Vấn đề:** SHA-256 chạy hàng triệu lần mỗi giây trên GPU. Nếu dùng nó
cho mật khẩu, cả một wordlist bị quét trong vài phút.

**Cách xử lý:** bcrypt có tham số `cost` điều khiển số vòng lặp nội bộ.
Đây là **số mũ**: tăng 1 đơn vị là gấp đôi thời gian.

| cost | thời gian xấp xỉ |
| ---- | ---------------- |
| 10   | ~60ms            |
| 12   | ~250ms           |
| 14   | ~1s              |

Ý nghĩa thật của `cost` là **tham số để theo kịp phần cứng**. Phần cứng
nhanh gấp đôi sau vài năm → tăng cost lên 1 là hoà. Hash cũ vẫn verify
được vì cost được nhúng trong chuỗi hash, nên nâng cấp là chuyện thay
hằng số rồi re-hash dần khi user đăng nhập.

Chọn cost là đánh đổi: chậm với attacker cũng là chậm với server mình.
12 là điểm cân bằng thông dụng.

**Code:** `BCRYPT_COST` [BCRYPT_COST] (src\server.ts#L12)· anchor `[NOTE:bcrypt-cost]`

**Liên quan:** [06 — Login](06-login.md) — 250ms này chính là thứ tạo ra
timing attack

---

## Salt

**Vấn đề:** hai user cùng đặt mật khẩu `123456` thì hash giống hệt nhau.
Hệ quả không phải là "hash yếu đi" mà là **công sức tấn công được tái
sử dụng**: một rainbow table dựng sẵn dùng cho mọi database, một lần
hash thử đối chiếu được với toàn bộ bảng `users` cùng lúc.

**Cách xử lý:** sinh một chuỗi ngẫu nhiên (salt) cho _mỗi_ lần hash, trộn
vào trước khi hash. Cùng mật khẩu → khác hash.

Salt **không bí mật** — nó nằm công khai ngay trong chuỗi lưu ở DB:

```
$2b$12$N9qo8uLOickgx2ZMRZoMye IjZAgcfl7p92ldGxad68LJZdL17lhWy
└┬┘ └┬┘ └──────── salt ──────┘ └──────────── hash ────────────┘
 │   └ cost
 └ phiên bản thuật toán
```

Tác dụng của salt không đến từ việc giấu nó, mà từ việc nó **phá tính
tái sử dụng**: rainbow table chết, tấn công theo lô chết, mỗi mật khẩu
phải bị tấn công riêng lẻ.

Ba hệ quả kỹ thuật của việc salt nằm trong chuỗi:

1. Không cần cột `salt` riêng trong schema
2. Không bao giờ so bằng `=` — cùng mật khẩu ra khác hash
3. Phải dùng `bcrypt.compare(plain, stored)` — nó đọc ngược salt và cost
   từ `stored` rồi hash lại `plain` theo đúng tham số đó

**Code:**: bcrypt.hash() sinh salt mặc định nên sẽ không nhìn thấy có salt trong code, nhưng behind the scene là có. `[NOTE:salt]`

---

## Giới hạn 72 byte

**Vấn đề:** bcrypt cắt input ở 72 byte và **im lặng bỏ phần thừa**. Mật
khẩu 100 ký tự chỉ có 72 byte đầu thực sự có tác dụng — hai mật khẩu
khác nhau từ ký tự thứ 73 trở đi sẽ verify thành công lẫn nhau.

Chỗ dễ vấp: **byte chứ không phải ký tự**. UTF-8 cho tiếng Việt có dấu
tốn 2–3 byte mỗi ký tự, nên `.length` trong JS (đếm UTF-16 code unit)
không phải con số cần kiểm tra.

**Cách xử lý:** validate bằng `Buffer.byteLength(pwd, 'utf8')` ở tầng Zod,
báo lỗi tường minh thay vì để bcrypt cắt âm thầm.

**Code:** ... · anchor `[NOTE:bcrypt-72]`

**Liên quan:** [pitfalls.md](pitfalls.md)

---

## Vì sao session token dùng SHA-256 chứ không bcrypt

**Vấn đề:** token cũng là bí mật, cũng cần hash trước khi lưu DB (rò rỉ
bảng `sessions` không được phép biến thành mạo danh). Vậy sao không
dùng luôn bcrypt cho nhất quán?

**Cách xử lý:** vì hai input có tính chất khác nhau hoàn toàn.

|                 | Mật khẩu               | Session token                  |
| --------------- | ---------------------- | ------------------------------ |
| Nguồn gốc       | người nghĩ ra          | `crypto.randomBytes(32)`       |
| Entropy         | thấp, đoán được        | 256 bit, không brute-force nổi |
| Cần làm chậm?   | có — chống đoán        | không — có gì để đoán đâu      |
| Tần suất verify | mỗi lần login          | **mỗi request**                |
| Thuật toán      | bcrypt (chậm, có salt) | SHA-256 (nhanh, deterministic) |

Hai lý do cụ thể:

**1. Làm chậm ở đây là vô ích mà lại đắt.** bcrypt tồn tại để chống đoán
input entropy thấp. Token đã ngẫu nhiên 256 bit thì không có wordlist
nào để thử — làm chậm không mua được gì, trong khi nó cộng 250ms vào
_mọi_ request đã xác thực, không chỉ lúc login.

**2. Deterministic thì mới tra được.** bcrypt salt ngẫu nhiên nên cùng
input ra khác hash → muốn tìm phải quét cả bảng rồi `compare` từng
dòng. SHA-256 không salt nên hash cố định, tra thẳng bằng index:

```sql
SELECT * FROM sessions WHERE token_hash = $1
```

Chỗ này lộ ra nguyên tắc chung: **salt giải quyết vấn đề entropy thấp.**
Không có vấn đề đó thì salt chỉ còn là chi phí — và ở đây chi phí là
mất khả năng lookup.

**Code:** ... · anchor `[NOTE:token-sha256]`

**Liên quan:** [07 — Session](07-session.md) — CSPRNG và bảng `sessions`
