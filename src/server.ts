import bcrypt from 'bcrypt'
import cookieParser from 'cookie-parser'
import express, { Request, Response } from 'express'
import crypto from 'node:crypto'
import pg from 'pg'
import z from 'zod'
import { pool } from './db.js'
import { requireAuth, requireRole } from './middlewares.js'
import { UserLoginSchema, UserRegisterSchema } from './schemas.js'
import { PublicUser, User } from './types.js'

const BCRYPT_COST = 12
const DUMMY_HASH =
  '$2a$12$YXGjCi9U8Xeup/GUscXamu3XM.uh6cNBFVQpIpEyuRsgyn7IELwZe'

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

const app = express()
app.use(express.json())
app.use(cookieParser())

app.get('/health', async (req, res) => {
  console.log(req.headers['sec-fetch-site'], req.headers['sec-fetch-mode'])
  const result = await pool.query('SELECT now()')
  res.json({ db: result.rows[0] })
})

app.get(
  '/admin/users',
  requireAuth,
  requireRole('admin'),
  async (_req, res) => {
    const rawQuery = 'SELECT id, email, created_at, role FROM users'

    const result = await pool.query<PublicUser>(rawQuery)

    return res.status(200).json({ data: result.rows })
  },
)

app.post('/auth/register', async (req, res) => {
  const parsedData = UserRegisterSchema.safeParse(req.body)

  if (!parsedData.success) {
    return res.status(400).json({
      error: z.flattenError(parsedData.error),
    })
  }

  const { password, email } = parsedData.data

  const rawQuery =
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at, role'

  try {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

    const result = await pool.query<PublicUser>(rawQuery, [
      email,
      hashedPassword,
    ])

    return res.status(201).json({ user: result.rows[0] })
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === '23505') {
      return res.status(409).json({ error: 'Email is already in use' })
    }
    return res.status(500).json({
      error: 'Registration failed, please try again',
    })
  }
})

app.post('/auth/login', async (req, res) => {
  const parsedData = UserLoginSchema.safeParse(req.body)
  const userAgent = req.headers['user-agent'] ?? null
  const ip_address = req.ip
  if (!parsedData.success) {
    return res.status(401).json({ error: 'not authenticated' })
  }

  const { email, password } = parsedData.data

  try {
    const query =
      'SELECT id, email, password_hash, created_at, role FROM users WHERE email = $1'

    const result = await pool.query<User>(query, [email])
    const user = result.rows[0]
    const hashedPwd = user?.password_hash ?? DUMMY_HASH
    const ok = await bcrypt.compare(password, hashedPwd)

    if (!user || !ok)
      return res.status(401).json({ error: 'Invalid email or password' })

    // create sessions for this user and return token with response.
    const sessionTkn = crypto.randomBytes(32).toString('base64url')
    // hash session token to store to DB
    const tknHash = crypto.createHash('sha256').update(sessionTkn).digest('hex')
    // create query to insert into sessions table
    const insertSessionQuery = `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip_address) VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5) RETURNING expires_at`
    await pool.query(insertSessionQuery, [
      tknHash,
      user.id,
      SESSION_TTL_SECONDS,
      userAgent,
      ip_address,
    ])

    res.cookie('session', sessionTkn, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    })

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
      },
    })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!

  return res.status(200).json({ user })
})

app.post('/auth/logout', async (req, res) => {
  const sessionTkn = req.cookies.session

  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  if (sessionTkn) {
    try {
      const hashedTkn = crypto
        .createHash('sha256')
        .update(sessionTkn)
        .digest('hex')

      const deleteSessionQuery = `DELETE FROM sessions WHERE token_hash = $1`

      await pool.query(deleteSessionQuery, [hashedTkn])
    } catch (error) {
      console.error(error)
    }
  }

  return res.status(204).end()
})

app.listen(process.env.PORT, () => {
  console.log(`listening on ${process.env.PORT}`)
})
