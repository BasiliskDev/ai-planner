import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

async function refreshAccessToken(token: any) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type:    'refresh_token',
        refresh_token: token.refreshToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return {
      ...token,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt:    Math.floor(Date.now() / 1000) + data.expires_in,
      error:        undefined,
    };
  } catch {
    return { ...token, error: 'RefreshTokenError' as const };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:       'openid email profile https://www.googleapis.com/auth/calendar',
          access_type: 'offline',
          prompt:      'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        // First sign-in: persist all token fields
        return {
          ...token,
          accessToken:  account.access_token,
          refreshToken: account.refresh_token,
          expiresAt:    account.expires_at,
        };
      }
      // Still valid (with a 60-second buffer)?
      if (Date.now() < (token.expiresAt as number) * 1000 - 60_000) {
        return token;
      }
      // Expired — attempt refresh
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      if (token.error) session.error = token.error as string;
      return session;
    },
  },
};
