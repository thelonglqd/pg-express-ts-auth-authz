# 05 — Register

`POST /auth/register` — tạo user mới. Endpoint đơn giản nhất về mặt code,
nhưng chứa ba khái niệm đáng nhớ: unique violation, TOCTOU, user enumeration.

---

## Luồng

1. `safeParse` body bằng Zod → fail thì 400
2. `bcrypt.hash(password, 12)`
3. `INSERT ... RETURNING id, email, created_at`
4. 201 + user (**không** có `password_hash`)
5. Nếu email trùng → bắt `23505` → 409

**Code:** [`/auth/register`](../src/server.ts)

---

## Bắt unique violation `23505`

Postgres trả mã lỗi chuẩn SQL cho từng loại vi phạm. `23505` là
`unique_violation` — chính là email trùng.

```ts
catch (error) {
  if (error instanceof pg.DatabaseError && error.code === '23505') {
    return res.status(409).json({ error: 'Email is already in use' })
  }
  console.error(error)
  return res.status(500).json({ error: 'Internal server error' })
}
```

Check `error.code` chứ đừng parse message text — mã lỗi ổn định giữa các
version, message thì đổi theo locale và bản vá.

`error.constraint` cũng có, chứa tên constraint bị vi phạm. Hữu ích khi
một bảng có nhiều cột UNIQUE và cần biết cột nào.

---

## TOCTOU — vì sao không `SELECT` check trước

**Câu hỏi:** nên `SELECT` xem email tồn tại chưa rồi mới `INSERT`, hay cứ
`INSERT` rồi bắt lỗi?

**Vấn đề với cách check trước:** giữa lúc `SELECT` trả lời và lúc `INSERT`
chạy, thế giới có thể đã đổi.

```
t=0ms   A: SELECT email → chưa tồn tại
t=1ms   B: SELECT email → chưa tồn tại     ← cả hai đều thấy trống
t=2ms   A: INSERT → OK
t=3ms   B: INSERT → dựa trên thông tin đã cũ
```

Đây là **TOCTOU** — Time Of Check To Time Of Use. Kết quả kiểm tra đã lỗi
thời ngay khi nhận được.

**Điểm quan trọng:** ở ca này `UNIQUE` constraint vẫn chắn, nên không có
dữ liệu hỏng — B chỉ nhận lỗi. Nhưng nó cho thấy `SELECT` **không thêm
bảo đảm gì**. Nó chỉ tạo cảm giác an toàn giả: người viết code nghĩ "đã
check rồi nên INSERT chắc chắn thành công", bỏ `try/catch`, rồi request B
ném 500.

**Kết luận:** bỏ `SELECT`, giữ `catch`. Một round-trip, không có race.
Pattern này có tên: _easier to ask forgiveness than permission_.

**Chỗ TOCTOU thực sự nguy hiểm** là khi không có ràng buộc atomic nào chắn:

```
SELECT balance → 100
if (balance >= 100)
UPDATE balance = balance - 100
```

Hai request song song đều thấy 100, đều qua `if`, đều trừ → số dư -100.
Rút được 200 từ tài khoản có 100. Cách chữa: `CHECK (balance >= 0)`,
`SELECT ... FOR UPDATE`, hoặc gộp thành `UPDATE ... WHERE balance >= 100`
rồi kiểm tra `rowCount`.

**Nguyên tắc:** đừng check trước rồi act. Act và xử lý khi thất bại — để
lớp thấp nhất (DB) làm trọng tài, vì chỉ nó mới khóa được.

**Ngoại lệ:** `SELECT` trước vẫn đáng làm khi cần gom nhiều lỗi validation
để hiện cùng lúc trên form. Nhưng đó là tối ưu UX, `catch` vẫn phải giữ.

---

## User enumeration

**Vấn đề:** trả về `409 "Email đã tồn tại"` biến endpoint register thành
công cụ tra cứu — đưa vào một email bất kỳ, nhận về câu trả lời có/không.
Chạy tự động với vài triệu email là có **danh sách email hợp lệ** của hệ
thống.

**Bốn hướng khai thác:**

1. **Credential stuffing** — lấy các cặp email+password đã lộ từ vụ hack
   khác, thử nguyên cặp. Người ta dùng lại mật khẩu nên tỉ lệ trúng cao.
   Danh sách email hợp lệ giúp lọc trước, không phí công.
2. **Phishing có mục tiêu** — biết chắc người này có tài khoản thì email
   giả "tài khoản của bạn có hoạt động bất thường" đáng tin hơn nhiều.
3. **Rò rỉ quyền riêng tư** — với app quản lý post thì không sao, nhưng
   cùng cơ chế đó trên site hẹn hò, phòng khám, diễn đàn chính trị thì
   việc xác nhận "email này có tài khoản ở đây" tự nó đã gây hại.
4. **Ước lượng quy mô** — đối thủ đo được tệp người dùng.

---

## Che kín: đổi kênh

Với login thì che dễ — mọi thất bại đều trả cùng một câu 401.

Register thì khó hơn: **bắt buộc** phải phản hồi khác nhau, vì email chưa
tồn tại thì tài khoản được tạo, còn đã tồn tại thì không. Trả "đăng ký
thất bại" chung chung sẽ khiến user thật bối rối.

**Cách giải:** đẩy thông tin sang **kênh mà chỉ chủ sở hữu đọc được** —
chính hộp mail đó.

Response luôn giống nhau bất kể trường hợp nào:

```
201 { "message": "Nếu email hợp lệ, chúng tôi đã gửi hướng dẫn tiếp theo." }
```

Rẽ nhánh nằm ở **nội dung email gửi đi**:

- Email chưa tồn tại → gửi link kích hoạt tài khoản
- Email đã tồn tại → _"Có người vừa thử đăng ký bằng email này. Nếu là
  bạn, tài khoản đã có sẵn — đây là link đăng nhập / quên mật khẩu."_

Người dùng thật luôn biết phải làm gì. Kẻ tấn công nhìn HTTP response thì
hai trường hợp giống hệt — hắn không đọc được mail của người khác.

Đây cũng là lý do luồng "quên mật khẩu" ở mọi site tử tế đều trả lời chung
chung kiểu "nếu email tồn tại, chúng tôi đã gửi link".

**Hai chỗ rò rỉ mà cách này không tự động bịt:**

- **Timing** — nhánh "chưa tồn tại" có `bcrypt.hash` (~250ms), nhánh "đã
  tồn tại" bỏ qua bước đó nên trả về gần như tức thì. Đo thời gian là suy
  ra được. Xem [06 — Login](06-login.md#timing-attack).
- **Không có rate limit** thì hắn cứ thử vài triệu email, đồng thời spam
  mail vào hộp thư người vô tội.

**Đánh đổi thực tế:** đây là mức nghiêm ngặt của ngân hàng, dịch vụ y tế.
Rất nhiều sản phẩm thương mại chấp nhận trả thẳng "email đã tồn tại" vì UX
tốt hơn hẳn — GitHub, Twitter đều làm vậy. Quyết định phụ thuộc **dữ liệu
nhạy cảm tới đâu**, không có đáp án đúng tuyệt đối.

**Project này chọn 409** cho dễ debug. TODO: làm bản kín đáo khi tới phần
email verification, lúc đó mới có hạ tầng gửi mail.

---

## Chi tiết dễ sót

**`express.json()` phải đăng ký trước route** — không có thì `req.body` là
`undefined`.

```ts
app.use(express.json())
```

**`RETURNING` không được có `password_hash`:**

```sql
INSERT INTO users (email, password_hash) VALUES ($1, $2)
RETURNING id, email, created_at
```

Trả nguyên row về client là lộ hash. Cùng lý do với việc tránh `SELECT *`.

**`bcrypt.hash` phải nằm trong `try`.** Nó có thể ném lỗi (native binding
hỏng, threadpool cạn, input sai kiểu). Nằm ngoài `try` thì lỗi thoát khỏi
handler → Express 4 treo request, Express 5 rơi vào error middleware.

Nguyên tắc: trong một route handler, **mọi thứ có thể ném lỗi nên nằm
trong cùng một `try`** — đặt ngay sau khối validate, ôm hết phần còn lại.

**Đưa thẳng `req.body` vào `safeParse`**, không bóc từng field rồi gói lại.
Zod mặc định strip field thừa, nên client gửi thêm `{ role: "admin" }` cũng
không lọt qua.

---

## Liên quan

- [04 — Password & hashing](04-password.md) — vì sao cost 12, salt nằm đâu
- [06 — Login](06-login.md) — timing attack, cách che kín ở login
- [Glossary](glossary.md) — `23505`, TOCTOU, user enumeration
- [Pitfalls](pitfalls.md)
