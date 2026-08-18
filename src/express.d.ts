import type { PublicUser } from './types.js'

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser
    }
  }
}
