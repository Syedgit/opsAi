import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { sign } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/google/callback`
);

/**
 * Initiate Google OAuth flow
 * Redirects user to Google consent screen
 */
export async function initiateGoogleAuth(_req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(500).json({ error: 'Google OAuth not configured' });
    return;
  }

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent screen to get refresh token
  });

  res.redirect(authUrl);
}

/**
 * Handle Google OAuth callback
 * Exchange code for tokens and create/update user
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { code, error } = req.query;

  if (error) {
    res.redirect(`/login?error=${encodeURIComponent(error as string)}`);
    return;
  }

  if (!code) {
    res.status(400).json({ error: 'No authorization code provided' });
    return;
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = new OAuth2Client();
    oauth2.setCredentials(tokens);
    const userInfoResponse = await oauth2.request({
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    });

    const googleUser = userInfoResponse.data as {
      id: string;
      email: string;
      name: string;
      picture: string;
      verified_email: boolean;
    };

    if (!googleUser.email || !googleUser.verified_email) {
      res.redirect('/login?error=email_not_verified');
      return;
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email.toLowerCase() },
      include: {
        stores: {
          include: {
            store: true,
          },
        },
      },
    });

    if (user) {
      // Update existing user with OAuth info if needed
      if (!user.provider || user.provider === 'email') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            provider: 'google',
            providerId: googleUser.id,
            providerData: tokens as any,
            picture: googleUser.picture,
            name: googleUser.name || user.name,
          },
          include: {
            stores: {
              include: {
                store: true,
              },
            },
          },
        });
      }
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: googleUser.email.toLowerCase(),
          name: googleUser.name,
          picture: googleUser.picture,
          provider: 'google',
          providerId: googleUser.id,
          providerData: tokens as any,
        },
        include: {
          stores: {
            include: {
              store: true,
            },
          },
        },
      });
    }

    // Generate JWT token
    const token = sign(
      {
        userId: user.id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Store token in localStorage via redirect
    // In production, consider using httpOnly cookies
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Signing in...</title>
        </head>
        <body>
          <script>
            localStorage.setItem('authToken', '${token}');
            localStorage.setItem('user', JSON.stringify(${JSON.stringify({
              id: user.id,
              email: user.email,
              name: user.name,
              stores: user.stores.map((us) => ({
                storeId: us.store.storeId,
                storeName: us.store.storeName,
                role: us.role,
              })),
            })}));
            window.location.href = '/dashboard';
          </script>
        </body>
      </html>
    `;
    res.send(html);
  } catch (error: unknown) {
    console.error('Google OAuth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
  }
}
