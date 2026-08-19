# 03 — TypeScript với driver trần

Khi dùng `pg` thay vì ORM, TypeScript không có nguồn sự thật nào về
database. Mọi type ở tầng này là do mày tự khai, và trình biên dịch
tin mày vô điều kiện.

---

## Generic của `pool.query<T>` không được kiểm chứng

**Vấn đề:** `pool.query<User>(...)` trông như type-safe nhưng `T` chỉ là
một lời khẳng định. Driver nhận về JSON từ wire protocol, không hề đối
chiếu với `T`. Viết `SELECT id, email` rồi khai `<User>` → `password_hash`
là `undefined` lúc chạy nhưng TS bảo có.

**Cách xử lý:** type phải khớp _cột thực sự SELECT/RETURNING_, không phải
khớp bảng. Định nghĩa type hẹp theo từng query.

**Code:** ... · anchor `[NOTE:query-generic]`

**Liên quan:** [noUncheckedIndexedAccess](#...), Kysely/ORM ở references.md

---

## `noUncheckedIndexedAccess`

**Vấn đề:** `rows[0]` được TS cho là `T`, nhưng mảng rỗng thì nó `undefined`.

**Cách xử lý:** bật cờ `noUncheckedIndexedAccess` trong tsconfig.json (compilerOptions) → `rows[0]` thành `T | undefined`, ép check.

**Code:** [`error`](../src/middlewares.ts#L29)

---

## `safeParse` và discriminated union

**Vấn đề:** `zod.parse` ném exception thì lỗi đi ra khỏi luồng bình thường.

**Cách xử lý:** `zod.safeParse` biến lỗi thành giá trị trả về; union theo
`success` ép check `if(result.success) { // process result.data here }`.

**Code:** [force check success with safeParse](../src/server.ts#L44)

---

## `catch (err)` là `unknown`

**Vấn đề:** JS throw được mọi thứ, không chỉ `Error`.

**Cách xử lý:** thu hẹp bằng `instanceof pg.DatabaseError` thay vì `as any`.

**Code:** [PG error code](../src/server.ts#L65) · anchor `[NOTE:pg-error]`

**Liên quan:** [05 — Register](05-register.md) mã `23505`

---

## `declare global` cho `req.user`

**Vấn đề:** middleware gắn thêm field vào `req`, nhưng type của Express
không biết.

**Cách xử lý:** module augmentation. Đánh đổi: khai là bắt buộc thì mọi
route đều tưởng có `user`, kể cả route không qua `requireAuth`.

**Code:** [express.d.ts](../src/express.d.ts)

**Liên quan:** [10 — RBAC](10-rbac.md)

---

## Sợi chỉ chung

Ba mục đầu cùng một dạng: TypeScript chỉ kiểm được thứ nó thấy trong
source. Dữ liệu vào từ ngoài (DB, request body, `throw`) là điểm mù, và
phải có một hành động runtime (Zod, `instanceof`, check `undefined`)
bắc cầu — annotation không làm được việc đó.
