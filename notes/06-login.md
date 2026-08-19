# 06 — Login

`POST /auth/login` — xác thực email + password, tạo session, set cookie.

Phần thú vị không nằm ở việc so mật khẩu (một dòng `bcrypt.compare`), mà ở
chỗ **làm sao mọi thất bại trông giống hệt nhau** — cả về nội dung, status
code, lẫn thời gian phản hồi.

---

## Luồng

1. `safeParse` bằng `UserLoginSchema` (khác schema register — xem dưới)
2. `SELECT id, email, password_hash FROM users WHERE email = $1`
3. `bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)`
4. `!user || !ok` → **401** (một `return` duy nhất cho mọi thất bại)
5. Sinh session token, hash SHA-256, `INSERT` vào `sessions`
6. `res.cookie(...)` rồi 200 + user

**Code:** [`/auth/login`](../src/server.ts) · anchor `[NOTE:timing-attack]`

---

## `bcrypt.compare`, không phải so bằng `=`

**Lỗi tự nhiên nhất khi mới viết:** hash password người dùng nhập rồi so
với hash trong DB.

```sql
-- SAI: không bao giờ khớp
WHERE email = $1 AND password_hash = $2
```

Không bao giờ chạy, vì **bcrypt sinh salt ngẫu nhiên mới mỗi lần gọi
`hash()`**. Cùng một mật khẩu, hai lần băm ra hai chuỗi khác nhau.

`compare` giải quyết bằng cách **đọc salt và cost từ chính chuỗi hash cũ**
(nhớ cấu trúc `$2b$12$<salt><hash>`), băm lại password nhập vào bằng đúng
salt đó, rồi so kết quả.

```ts
const ok = await bcrypt.compare(password, user.password_hash)
```

Tham số đầu là **plaintext** — `compare` tự lo việc băm. Nên login **không
bao giờ gọi `bcrypt.hash`**.

**Hệ quả:** so mật khẩu luôn phải ở tầng app, không nhét được vào SQL.
Query chỉ lấy hash ra, phần so sánh do bcrypt làm.

---

## Timing attack

<a id="timing-attack"></a>

**Vấn đề:** viết theo cách tự nhiên thì hai nhánh thất bại tốn thời gian
rất khác nhau.

```
email không tồn tại  → return ngay        ~5ms
email tồn tại, sai pw → bcrypt.compare    ~250ms
```

Nội dung response giống hệt, status giống hệt — nhưng **chênh 50 lần về
thời gian**. Kẻ tấn công viết script đo `response time`, thử một triệu
email, lọc ra những cái phản hồi chậm → có danh sách email có tài khoản.
`user enumeration` qua cửa sau.

Đây là một dạng **side-channel attack**: thông tin rò rỉ qua kênh phụ
(thời gian, điện năng, tiếng ồn) chứ không qua nội dung.

**Cách bịt:** làm hai nhánh tốn thời gian như nhau — luôn chạy `compare`,
kể cả khi không tìm thấy user, bằng một hash giả.

```ts
const user = result.rows[0]
const hashedPwd = user?.password_hash ?? DUMMY_HASH
const ok = await bcrypt.compare(password, hashedPwd)

if (!user || !ok) {
  return res.status(401).json({ error: 'Invalid email or password' })
}
```

Ba điểm:

- `user?.password_hash` — optional chaining, **không** phải
  `user.password_hash`. Khi `rows[0]` là `undefined` thì truy cập thuộc
  tính sẽ ném TypeError ngay, `??` không cứu được (nó chỉ xử lý khi vế
  trái _tính ra được_ null/undefined).
- `DUMMY_HASH` phải là **hash thật với đúng cost đang dùng**, để thời gian
  tính khớp. Tạo một lần bằng `bcrypt.hash('whatever', 12)` rồi hardcode.
- **Một `return` duy nhất** cho mọi thất bại — không nhánh nào rẽ sớm.

**Cách kiểm chứng:** gọi login với email sai và với password sai, so thời
gian phản hồi (REST Client hiện ở góc panel kết quả). Hai con số phải xấp
xỉ nhau, cỡ vài trăm ms. Nếu case email sai nhanh hơn hẳn thì `DUMMY_HASH`
chưa hoạt động.

---

## Che kín mọi tín hiệu, không chỉ message

Ba tín hiệu quan sát được từ ngoài, phải che cả ba:

| Tín hiệu    | Sai                                    | Đúng             |
| ----------- | -------------------------------------- | ---------------- |
| Message     | "Email không tồn tại" / "Sai mật khẩu" | cùng một câu     |
| Status code | `404` cho email sai                    | `401` cho cả hai |
| Thời gian   | 5ms vs 250ms                           | `DUMMY_HASH`     |

`404 Not Found` là chỗ dễ sót nhất: message đã chung chung rồi nhưng status
vẫn nói ra sự thật — "tài nguyên không tồn tại". Kẻ tấn công đọc status là
đủ, chẳng cần đọc body.

**401 Unauthorized** là mã đúng ngữ nghĩa cho "thông tin xác thực không hợp
lệ", và nó không tiết lộ nhánh nào.

---

## Schema riêng cho login

Đừng dùng chung `UserRegisterSchema`.

**Lý do 1 — hai endpoint hỏi hai câu khác nhau:**

- Register: _"mật khẩu này có đạt chuẩn để tao chấp nhận không?"_ → cần
  rule chặt (`.min(8)`, `.max(72)`, độ phức tạp)
- Login: _"chuỗi này có khớp với hash đã lưu không?"_ → không quan tâm nó
  mạnh hay yếu, việc đó quyết ở lúc đăng ký rồi

**Lý do 2 — dùng chung sẽ khóa user cũ ra ngoài.** Hôm nay `.min(8)`, sáu
tháng sau siết lên `.min(12)` → mọi user có mật khẩu 8-11 ký tự **lập tức
không login được**, bị chặn ở tầng validate trước khi kịp tới DB. Họ không
làm gì sai.

Nguyên tắc: **rule về chất lượng đầu vào chỉ áp lúc ghi, không áp lúc đọc.**

**Lý do 3 — rò rỉ thông tin.** Nếu login validate độ mạnh, kẻ tấn công nhập
`"abc"` và nhận 400 kèm "password quá ngắn" → biết được rule mật khẩu của
hệ thống, thu hẹp không gian brute-force.

```ts
export const UserLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
})
```

`.min(1)` chỉ để chặn chuỗi rỗng, tránh gọi bcrypt vô nghĩa. Không hơn.

Phần email **giữ nguyên normalize** — phải khớp chính xác cách đã ghi vào
DB. Sót `.toLowerCase()` ở đây thì user đăng ký chữ thường mà gõ hoa lúc
login sẽ không vào được.

---

## Response

```ts
res.cookie('session', sessionTkn, COOKIE_OPTS)
return res.status(200).json({ user: { id: user.id, email: user.email } })
```

**Token không nằm trong body.** Nó đi trong cookie `HttpOnly` để JS không
đọc được — xem [08 — Cookie](08-cookie.md). Trả token ra body là làm hỏng
mục đích của `httpOnly`.

**Thứ tự:** `res.cookie()` trước, `res.json()` sau. `res.cookie` chỉ thêm
header vào response đang soạn; `res.json` mới là lệnh gửi. Gọi ngược thì
ăn `ERR_HTTP_HEADERS_SENT`.

**Không đặt token trong object `user`.** Token là credential của session,
không phải thuộc tính của user. Để lẫn thì shape response của `/login` và
`/auth/me` sẽ lệch nhau, FE phải xử lý hai kiểu.

---

## Chi tiết dễ sót

**Type phải khớp cột SELECT.** Query lấy `id, email, password_hash` → dùng
`Pick<User, 'id'|'email'|'password_hash'>`, không phải `PublicUser` (thiếu
hash) cũng không phải `User` (thừa `created_at`).

**`SELECT` không tìm thấy không phải lỗi** — `rows` là `[]`, `rowCount` là
`0`. Không throw. Cùng tinh thần với `safeParse`: chuyện dự đoán được là
giá trị trả về, chuyện ngoài dự liệu mới là exception.

**Lấy `id` trong SELECT** — session cần `user_id` để `INSERT`.

---

## Còn thiếu

- [ ] **Rate limit.** Không có thì kẻ tấn công cứ thử mật khẩu không giới
      hạn. Và mỗi lần thử tốn 250ms CPU của server → cũng là cửa DoS.
- [ ] **Account lockout** sau N lần sai — nhưng cẩn thận, nó tự nó là một
      cửa tấn công (khóa tài khoản người khác bằng cách cố tình nhập sai).
- [ ] **Ghi nhận đăng nhập bất thường** — thiết bị lạ, IP lạ.

---

## Liên quan

- [04 — Password & hashing](04-password.md) — salt nằm trong chuỗi hash
- [05 — Register](05-register.md) — user enumeration, cách che ở register
- [07 — Session](07-session.md) — sinh token, lưu hash
- [08 — Cookie](08-cookie.md) — vì sao cookie chứ không phải localStorage
- [Glossary](glossary.md) — `DUMMY_HASH`, side-channel, 401 vs 403
