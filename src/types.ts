import { number } from 'zod'

export type User = {
  id: string
  email: string
  password_hash: string
  created_at: Date
  role: string
}

export type Session = {
  id: string
  token_hash: string
  user_id: string
  expires_at: Date
  created_at: Date
  user_agent: string
  ip_address: string
}

export type PublicUser = Omit<User, 'password_hash'>

export type AuthMeRow = Pick<User, 'id' | 'email' | 'role'>

export const Roles = ['user', 'admin'] as const
export type RoleType = (typeof Roles)[number]
