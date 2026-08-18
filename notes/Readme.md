# Auth & Authz từ đầu — Node + TypeScript + Express + Postgres

Project học: tự viết authentication và authorization bằng native driver(`pg`),
không ORM, không thư viện auth. Mục tiêu là hiểu cơ chế, không phải ra sản phẩm.

**Stack:** Node · TypeScript · Express · `pg` · Postgres 17 (container) · Zod · bcrypt

---

## Chạy thử

```bash
docker start auth-pg          # Postgres container
npm run dev                   # server ở PORT trong .env
```

Test bằng REST Client (`requests.http`) — nó tự giữ cookie giữa các request.

---

## Mục lục

### Nền tảng

- [01 — Hạ tầng & setup](01-infra.md)
  Docker, volume, Rancher Desktop, tsx vs ts-node, ESM và đuôi `.js`, `pg.Pool` singleton

- [02 — Schema & kiểu dữ liệu](02-schema.md)
  uuid vs serial, `timestamptz` vs `timestamp`, UNIQUE và index, FK `ON DELETE CASCADE`,
  email case-insensitive

- [03 — TypeScript với driver trần](03-typescript.md)
  Generic `pool.query<T>` không được kiểm chứng, type khớp cột SELECT/RETURNING,
  `declare global` cho `req.user`, `safeParse` và discriminated union

### Authentication

- [04 — Password & hashing](04-password.md)
  Hash không có chiều ngược, bcrypt cost, salt, giới hạn 72 byte,
  vì sao session token dùng SHA-256 chứ không bcrypt

- [05 — Register](05-register.md)
  Unique violation `23505`, TOCTOU, user enumeration, đổi kênh qua email

- [06 — Login](06-login.md)
  `bcrypt.compare`, timing attack và `DUMMY_HASH`, một `return` 401 duy nhất,
  schema riêng cho login

- [07 — Session](07-session.md)
  Session vs JWT, CSPRNG, hash token, bảng `sessions`, expiry, dọn rác

- [08 — Cookie](08-cookie.md)
  `HttpOnly`, `Secure`, `SameSite`, cookie jar, `clearCookie` và cách xóa cookie,
  vì sao cần `/auth/me`

- [09 — Logout](09-logout.md)
  Idempotent, clearCookie trước DELETE sau, vì sao không dùng `requireAuth`

### Authorization

- [10 — RBAC](10-rbac.md)
  Cột `role`, `requireAuth`, `requireRole`, 401 vs 403, middleware curry

- [11 — Ownership](11-ownership.md)
  Vì sao middleware không check ownership được, coarse-grained vs fine-grained,
  `author_id` lấy từ đâu

### Tra cứu

- [Glossary](glossary.md) — thuật ngữ, hằng số, mã lỗi, header
- [Pitfalls](pitfalls.md) — lỗi đã vấp và cách nhận ra
- [Nguồn & đọc thêm](references.md)

---

## Endpoints

| Method | Path             | Auth                                   | Ghi chú                   |
| ------ | ---------------- | -------------------------------------- | ------------------------- |
| POST   | `/auth/register` | —                                      | 201 · 409 nếu email trùng |
| POST   | `/auth/login`    | —                                      | set cookie `session`      |
| GET    | `/auth/me`       | `requireAuth`                          | trả user hiện tại         |
| POST   | `/auth/logout`   | —                                      | luôn 204                  |
| GET    | `/admin/users`   | `requireAuth` + `requireRole('admin')` | 403 nếu không phải admin  |

---

## Quy ước ghi chú

Mỗi khái niệm theo bốn phần:

```markdown
## Tên khái niệm

**Vấn đề:** cái gì sai / cái gì cần giải quyết

**Cách xử lý:** làm gì

**Code:** [`tên`](../src/file.ts#L10-L20) · anchor `[NOTE:slug]`

**Liên quan:** link tới khái niệm khác
```

Link tới code dùng đường dẫn tương đối kèm số dòng. Vì số dòng lệch khi
refactor, chỗ nào quan trọng thì đặt thêm anchor comment trong source:

```ts
// [NOTE:timing-attack]
```

rồi tra bằng cách search chuỗi đó.

---

## Còn dang dở

- [ ] Ownership check (bảng `posts`)
- [ ] Tách `roles` / `permissions` ra bảng riêng
- [ ] SSO qua OIDC
- [ ] Sliding expiration cho session
- [ ] Rate limit ở login
- [ ] Error middleware tập trung
- [ ] Migration tool (đang chạy tay `schema.sql`)
