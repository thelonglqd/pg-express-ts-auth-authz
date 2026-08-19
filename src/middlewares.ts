import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db.js'
import { AuthMeRow, PublicUser, RoleType } from './types.js'

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const sessionTkn = req.cookies.session

  if (!sessionTkn) return res.status(401).json({ error: 'not authenticated' })

  try {
    const tokenHash = crypto
      .createHash('sha256')
      .update(sessionTkn)
      .digest('hex')

    const findTokenHashQuery = `SELECT u.email, u.role, u.id, u.created_at
      FROM sessions s 
      JOIN users u
      ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`
    const result = await pool.query<PublicUser>(findTokenHashQuery, [tokenHash])

    const user = result.rows[0]
    // console.log(user.id); => error with "noUncheckedIndexedAccess": true
    if (!user) return res.status(401).json({ error: 'not authenticated' })
    req.user = user
    return next()
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

export const requireRole =
  (role: RoleType) => (req: Request, res: Response, next: NextFunction) => {
    const user = req.user!

    if (user.role === role) next()
    else return res.status(403).end()
  }
