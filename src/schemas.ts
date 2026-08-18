import z from 'zod'

export const UserRegisterSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z
    .string()
    .min(8, { message: 'Password is too short' }),
})

export const UserLoginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
})
