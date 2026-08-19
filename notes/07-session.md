# 07 — Session

HTTP stateless — mỗi request là một tờ giấy trắng, server không nhớ gì. Nên
sau khi login thành công, server phải đưa client một **bằng chứng** để mang
theo ở mọi request sau.

Bằng chứng đó cần ba tính chất:

1. Client không tự chế ra được
2. Server xác minh được là thật
3. Không đoán được bằng cách thử

---

## Hai họ giải pháp

Khác nhau ở một câu hỏi duy nhất: **server có phải lưu gì lại không?**

|                     | Session (stateful)        | JWT (stateless)       |
| ------------------- | ------------------------- | --------------------- |
| Server lưu          | có (DB / Redis / memory)  | không                 |
| Client cầm          | mã tra cứu (opaque token) | token tự chứa dữ liệu |
| Xác minh            | tra DB                    | verify chữ ký         |
| Thu hồi             | `DELETE` → chết ngay      | **không được**        |
| Chi phí mỗi request | 1 query                   | 0                     |

**Project này chọn session.** Lý do: mục tiêu học có `session revocation`,
và sau này thêm authorization — mà quyền nằm trong token thì đổi quyền
không có hiệu lực cho tới khi token hết hạn.

---

## JWT — vì sao không chọn

**JWT payload đọc được.** Đây là hiểu nhầm phổ biến nhất: header và payload
chỉ là JSON được **base64url encode** — encoding, không phải encryption.

```js
JSON.parse(atob(token.split('.')[1])) // ra hết
```

Thử paste vào jwt.io là thấy ngay, không cần secret gì.

**Hệ quả:** đừng bao giờ để dữ liệu nhạy cảm trong payload.

**Signature bảo vệ tính toàn vẹn, không phải bí mật.** Nó không ngăn _đọc_,
nó ngăn _sửa_:

```
signature = HMAC-SHA256(header + "." + payload, SECRET)
```

Server nhận token → tự tính lại signature bằng SECRET của mình → so. Sửa
`"role":"user"` thành `"admin"` thì payload đổi → signature không khớp →
từ chối. Không có SECRET thì không ký lại được.

(HMAC cũng là hash có thêm secret trộn vào. Giống salt ở chỗ ghép thêm
trước khi băm — khác ở chỗ salt công khai, secret phải giấu; salt chống
rainbow table, secret chống giả mạo.)

**Rủi ro thật của JWT** không phải "attacker tự chế token" mà là:

- Server tự cấp token hạn dài (`expiresIn: '30d'`) → lộ thì dùng được 30 ngày
- **SECRET bị lộ** → ký được token tùy ý, role admin, hạn 10 năm. Toàn bộ
  hệ thống thủng và không phát hiện được vì mọi token đều "hợp lệ"
- Lỗ hổng implementation — kinh điển là `alg: none`: attacker đổi header
  thành `"none"`, xóa signature, thư viện đời đầu tin luôn header đó

**Nghịch lý cốt lõi:** ưu điểm duy nhất của JWT là **không cần chạm DB**.
Muốn thu hồi thì phải có blacklist, mà blacklist đòi **chạm DB mỗi
request**. Có blacklist rồi thì JWT chẳng hơn gì session, chỉ phức tạp hơn.

Nên thực tế người ta dùng **mô hình lai**: access token JWT ngắn hạn (5-15
phút) + refresh token lưu DB (thu hồi được). Nhìn kỹ thì phần thu hồi vẫn
là session server-side.

**JWT hợp khi:** microservices nhiều service cần verify độc lập, hoặc scale
ngang mà không muốn service nào cũng chạm DB.

---

## "Session" có hai nghĩa

Chỗ này gây rối thật, nhất là khi đọc docs Auth.js:

1. **Mô hình lưu trữ** — server giữ state, đối lập với JWT (nghĩa dùng ở trên)
2. **Object chứa thông tin user đang đăng nhập** — `session.user.email`

Auth.js chọn nghĩa 2 làm tên API, nên cùng một chữ phủ lên cả hai chiến lược:

```ts
session: {
  strategy: 'jwt'
} // mặc định — không lưu gì ở server
session: {
  strategy: 'database'
} // cần adapter + bảng sessions
```

Với `strategy: "jwt"`, `auth()` trả về "session" nhưng bên dưới là JWT
thuần, không có bảng nào.

**Khi nghe "session", hỏi lại:** đang nói về _mô hình lưu trữ_ hay _object
chứa thông tin user_? Hai chuyện độc lập.

---

## Sinh token

```ts
const token = crypto.randomBytes(32).toString('base64url')
```

**Phải dùng CSPRNG.** `Math.random()` là PRNG thường — dự đoán được nếu
biết seed, tuyệt đối không dùng cho token bảo mật.

**32 byte = 256 bit.** Khuyến nghị tối thiểu là 128 bit; 256 là mức phổ
biến. Với entropy này thì brute-force không khả thi.

**Vì sao không dùng `gen_random_uuid()` làm token:** UUID v4 chỉ có 122 bit
entropy, và một số implementation không dùng CSPRNG. `randomBytes` thì rõ
ràng, không phải đoán.

---

## Hash token trước khi lưu — nhưng bằng SHA-256, không phải bcrypt

```ts
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
```

**Vì sao vẫn phải hash:** nếu DB bị lộ (SQL injection, backup rò rỉ), token
thô cho phép **mạo danh mọi user đang đăng nhập ngay lập tức**. Hash thì
token trong DB vô dụng.

Cùng logic với password: client cầm bản thô, DB giữ hash. Một chiều.

```
client  ←── token thô ──  app  ── hash ──→  DB
```

**Vì sao SHA-256 chứ không bcrypt** — hai lý do:

1. **Không cần làm chậm.** bcrypt chậm để chống brute-force mật khẩu do
   người chọn (entropy thấp). Token là 256 bit ngẫu nhiên — không ai
   brute-force nổi. Ngược lại, bcrypt ở đây gây hại thật: **mỗi request
   cần xác thực** đều phải verify session, cộng 250ms vào _mọi_ request là
   không chấp nhận được. Password chỉ hash lúc login, một lần.

2. **SHA-256 deterministic nên tra được.** `WHERE token_hash = $1` — một
   index lookup. Bcrypt có salt ngẫu nhiên nên cùng token ra hash khác
   nhau, không tra được; phải quét cả bảng rồi `compare` từng dòng.

---

## Bảng `sessions`

```sql
CREATE TABLE sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  user_agent text,
  ip_address text
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
```

**`expires_at` chứ không phải tính từ `created_at`.** Với `created_at`, mỗi
lần check phải cộng thời hạn ở tầng app, và nếu đổi config thì mọi session
cũ đổi theo — kể cả session lẽ ra đã hết hạn theo quy tắc cũ. Lưu
`expires_at` trực tiếp thì query chỉ là `WHERE expires_at > now()`, và mỗi
session có thể có thời hạn riêng ("ghi nhớ đăng nhập" 30 ngày vs session
thường 1 ngày).

**Index cho `user_id`** — `token_hash` đã có nhờ `UNIQUE`, nhưng `user_id`
thì chưa. Dùng cho "liệt kê session của user", "logout toàn bộ thiết bị",
và cả cascade delete.

**`user_agent` và `ip_address`** — không cần FE gửi, server đọc trực tiếp:

```ts
const userAgent = req.headers['user-agent'] ?? null
const ip = req.ip
```

Dùng để dựng màn hình "Chrome trên Windows · 2 giờ trước". Hai lưu ý:

- **Cả hai do client kiểm soát, không đáng tin.** Dùng để _hiển thị_, đừng
  dùng làm cơ sở bảo mật kiểu "session chỉ hợp lệ nếu user-agent khớp" —
  vừa dễ giả mạo, vừa false positive khi trình duyệt tự cập nhật.
- **IP là dữ liệu cá nhân** theo GDPR. Lưu thì cần lý do chính đáng và
  chính sách xóa.

`req.ip` sau reverse proxy sẽ là IP của proxy. IP thật nằm ở
`X-Forwarded-For`, đọc được bằng `app.set('trust proxy', true)` — nhưng
**chỉ bật khi thật sự có proxy**, vì header đó client tự đặt được.

---

## Đặt `expires_at` — để DB tính

```sql
INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip_address)
VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)
RETURNING expires_at
```

**Vì sao để DB tính thay vì `new Date(Date.now() + TTL)`:** nếu đồng hồ máy
chạy Node lệch so với đồng hồ DB (thật, nhất là khi nhiều instance) thì
`expires_at` ghi vào sẽ lệch so với `now()` dùng lúc kiểm tra. Để một mình
DB làm nguồn thời gian thì không có chỗ nào lệch được.

`make_interval(secs => $3)` — cú pháp `=>` là **named argument** của
Postgres. Cho phép giữ constant ở TS mà vẫn để DB tính.

**Về thời hạn:** 7 ngày là mức phổ biến cho session đăng nhập. 15 phút là
quá ngắn — user đi pha cà phê về là bị đăng xuất; con số đó hợp với OTP,
reset-password token, email verification link.

**`RETURNING` chỉ cần `expires_at`** (để set `Max-Age` của cookie cho khớp).
**Không** `RETURNING token_hash` — token thô đã nằm sẵn trong biến ở tầng
app rồi, và hash thì tuyệt đối không gửi cho client.

---

## Dọn session hết hạn

Session hết hạn vẫn nằm trong bảng mãi. Sau một năm là hàng triệu dòng chết.

```sql
DELETE FROM sessions WHERE expires_at < now()
```

Chạy định kỳ — `setInterval` trong process (nhớ `.unref()`), cron của OS,
hoặc `pg_cron`. Một lần mỗi giờ hoặc mỗi ngày là đủ.

**Điểm quan trọng: cron chỉ để dọn rác, không phải để bảo mật.** Kể cả cron
chết hẳn, session hết hạn vẫn không dùng được — miễn là query xác thực
**luôn có** `AND expires_at > now()`. Dựa vào cron để chặn session hết hạn
là lỗi thiết kế.

Với bảng lớn thì nên xóa theo lô (`LIMIT` + lặp) để không giữ lock lâu.
Cách của hệ thống lớn là **partition theo thời gian** rồi drop nguyên
partition — gần như tức thì, không sinh rác cho vacuum.

---

## Xác thực session ở request sau

```sql
SELECT u.id, u.email, u.role
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.expires_at > now()
```

- **JOIN** để lấy luôn user trong một round-trip. `user_id` trần thì mọi
  route cần `email`/`role` lại phải query thêm.
- **`expires_at > now()` là bắt buộc.**
- `now()` chạy ở DB, cùng nguồn thời gian với lúc ghi.

Logic này nằm trong `requireAuth` — xem [10 — RBAC](10-rbac.md).

---

## Còn thiếu

- [ ] **Sliding expiration** — mỗi lần user hoạt động thì đẩy `expires_at`
      ra xa. Cho phép TTL ngắn mà không phiền user.
- [ ] **Giới hạn số session/user** — hoặc ít nhất màn hình quản lý thiết bị
- [ ] **"Đăng xuất mọi thiết bị"** — `DELETE FROM sessions WHERE user_id = $1`
- [ ] **Session rotation sau khi đổi mật khẩu**

---

## Liên quan

- [06 — Login](06-login.md) — nơi session được tạo
- [08 — Cookie](08-cookie.md) — token đi tới client bằng cách nào
- [09 — Logout](09-logout.md) — `DELETE` mới là thứ chấm dứt phiên thật
- [10 — RBAC](10-rbac.md) — `requireAuth` dùng lại query xác thực
- [Glossary](glossary.md) — CSPRNG, HMAC, opaque token
