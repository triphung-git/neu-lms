import { apiRequest } from './client'

export type AccountRole = 'admin' | 'teacher' | 'student'

export interface ApiAccount {
  id: number
  email: string
  first_name: string
  role: AccountRole
  is_active: boolean
}

export const authApi = {
  login(email: string, password: string) {
    return apiRequest<ApiAccount>('auth/login', {
      method: 'POST',
      body: {
        email: email.trim().toLowerCase(),
        password,
      },
    })
  },

  getCurrentUser() {
    return apiRequest<ApiAccount>('auth/me')
  },

  logout() {
    return apiRequest<void>('auth/logout', {
      method: 'POST',
    })
  },

  register(email: string, password: string) {
    return apiRequest<ApiAccount>('auth/register', {
      method: 'POST',
      body: {
        email: email.trim().toLowerCase(),
        password,
      },
    })
  },

  changePassword(oldPassword: string, newPassword: string) {
    return apiRequest<{ detail: string }>('auth/password', {
      method: 'POST',
      body: {
        old_password: oldPassword,
        new_password: newPassword,
      },
    })
  },
}