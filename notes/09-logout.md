# 09 — Logout

`POST /auth/logout` — endpoint ngắn nhất, nhưng có ba quyết định thiết kế
đáng nhớ: idempotent, thứ tự thao tác, và vì sao **không** dùng
`requireAuth`.

---

## Code

```ts
app.post('/auth/logout', async (req, res) => {
  const sessionTkn = req.cookies.session

  res.clearCookie('session', COOKIE_OPTS)

  if (sessionTkn) {
    try {
      const hashedTkn = crypto
        .createHash('sha256')
        .update(sessionTkn)
        .digest('hex')

      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [
        hashedTkn,
      ])
    } catch (error) {
      console.error(error)
    }
  }

  return res.status(204).end()
})
```

**Code:** [`/auth/logout`](../src/server.ts)

---

## Logout luôn thành công

Phân biệt hai loại "thất bại":

**1. Không có gì để xóa** — không có cookie, hoặc `rowCount = 0` (session
đã hết hạn, hoặc đã logout rồi). **Không phải lỗi.** Vẫn 204.

Lý do: logout hướng tới một **trạng thái đích** — "không còn phiên đăng
nhập" — chứ không phải một hành động. Nếu vốn đã không có phiên thì đích đã
đạt, không có gì để báo lỗi.

Đây là **idempotent**: gọi một lần hay mười lần, kết quả cuối như nhau.

Về mặt thực dụng: trả 401 ở đây thì FE phải viết thêm nhánh xử lý cho một
tình huống chẳng có gì để xử lý. Người dùng bấm "Đăng xuất" xong thấy báo
lỗi — vô lý.

**2. Lỗi hạ tầng thật** — DB mất kết nối, query ném exception. Log ở server
nhưng **không đẩy ra client**, vì client chẳng làm gì được với thông tin đó,
và trạng thái họ quan tâm (đã thoát) thì đã đạt.

---

## Vì sao không dùng `requireAuth`

Logout chỉ cần **token** để biết xóa dòng nào. Không cần biết user là ai,
không cần JOIN, không cần role.

**Và không nên dùng, vì:** nếu bắt qua `requireAuth` thì session hết hạn →
401 → **không logout được**. Cookie rác nằm lại trong trình duyệt, user bấm
"Đăng xuất" mà báo lỗi.

Đây là ví dụ tốt cho việc **middleware auth không phải lúc nào cũng đúng** —
phải hỏi endpoint này _thực sự cần gì_, chứ không gắn theo thói quen.

**Ngoại lệ:** kiểu logout **cần** biết user là "đăng xuất khỏi mọi thiết
bị" — `DELETE FROM sessions WHERE user_id = $1`. `user_id` thì phải xác
thực mới có. Đó là endpoint riêng, và nó dùng `requireAuth`.

---

## Thứ tự: clearCookie trước, DELETE sau

`clearCookie` nằm **ngoài** `try`, chạy vô điều kiện, trước mọi thứ khác.

**Lý do:** nếu `DELETE` lỗi và mày trả 500 mà chưa clear cookie, user vẫn
còn "đăng nhập" ở phía trình duyệt. Từ góc nhìn người dùng, _"tôi muốn ra
khỏi máy này"_ quan trọng hơn việc DB có dọn sạch hay không — session mồ côi
trong DB sẽ tự hết hạn, còn cookie nằm lại trên máy công cộng thì nguy hiểm
hơn.

**Ưu tiên là luôn thoát được.**

---

## `clearCookie` chỉ dọn phía client

Điểm quan trọng nhất của file này:

**`DELETE FROM sessions` mới là thứ thực sự chấm dứt phiên.** `clearCookie`
chỉ để trình duyệt khỏi gửi rác lên nữa.

Client không đáng tin: nếu kẻ tấn công đã copy được token thì hắn cứ giữ,
không bấm logout, cookie của hắn chẳng bị xóa. Chỉ có việc xóa dòng trong
DB mới làm token đó vô dụng.

**Đây là chỗ mô hình session hơn JWT rõ nhất.** Có bảng để xóa thì logout là
_thật_. Với JWT, `clearCookie` là tất cả những gì làm được — token vẫn hợp
lệ tới khi hết hạn, ai cầm bản sao vẫn dùng được.

---

## Chi tiết dễ sót

**Guard `if (sessionTkn)` là bắt buộc.**
`crypto.createHash().update(undefined)` ném TypeError → rơi xuống `catch` →
500 thay vì 204. Cùng loại lỗi với `user.password_hash` khi `rows[0]` là
`undefined` ở login.

**`204` không được có body.** `res.status(204).json({ success: true })` là
tự phá định nghĩa của chính status code mình chọn. Chọn một:

```ts
return res.status(204).end() // không body
return res.status(200).json({ ok: true }) // có body
```

**`clearCookie` phải truyền đúng options đã dùng lúc set** — `path`,
`sameSite`, `secure`, `httpOnly`. Cookie định danh bằng
(name, domain, path); lệch một cái là trình duyệt coi như cookie khác và
không xóa được cái thật. Xem [08 — Cookie](08-cookie.md#clearcookie--http-không-có-lệnh-xóa-cookie).

Không truyền `maxAge` vào `clearCookie` — mâu thuẫn với việc nó tự đặt
`Expires` về quá khứ.

**Phải là POST, không phải GET.** Logout thay đổi trạng thái. GET logout
từng bị khai thác: nhúng `<img src="/logout">` vào trang khác là đăng xuất
được người ta.

**`DELETE` không khớp dòng nào không phải lỗi** — `rowCount` là 0, thế thôi.
Cùng tinh thần với `SELECT` trả về tập rỗng.

---

## Còn thiếu

- [ ] **`POST /auth/logout-all`** — `DELETE FROM sessions WHERE user_id = $1`,
      dùng `requireAuth`
- [ ] **Thu hồi session khi đổi mật khẩu** — đổi pass mà session cũ vẫn sống
      thì kẻ đã chiếm được tài khoản vẫn ở trong
- [ ] Màn hình quản lý thiết bị đang đăng nhập (dùng `user_agent`,
      `ip_address` đã lưu)

---

## Liên quan

- [07 — Session](07-session.md) — bảng `sessions`, vì sao chọn session
- [08 — Cookie](08-cookie.md) — cơ chế `clearCookie`
- [10 — RBAC](10-rbac.md) — `requireAuth` và khi nào dùng nó
- [Glossary](glossary.md) — idempotent, 204
