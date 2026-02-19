import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Unified auth endpoint
 * POST /api/auth/login - Login
 * POST /api/auth/signup - Signup
 * GET /api/auth/me - Get current user
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = req.url?.split('?')[0] || '';
  
  // Login
  if (path.endsWith('/login') && req.method === 'POST') {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: {
          stores: {
            include: { store: true },
          },
        },
      });

      if (!user || !user.isActive) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      if (!user.password) {
        res.status(401).json({ 
          error: 'This account uses Google Sign-In. Please sign in with Google.',
          useOAuth: true 
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const token = sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          stores: user.stores.map((us) => ({
            storeId: us.store.storeId,
            storeName: us.store.storeName,
            role: us.role,
          })),
        },
      });
    } catch (error: unknown) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to login' });
    }
    return;
  }

  // Signup
  if (path.endsWith('/signup') && req.method === 'POST') {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        res.status(409).json({ error: 'User with this email already exists' });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          name: name || null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        user,
        message: 'User created successfully',
      });
    } catch (error: unknown) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
    return;
  }

  // Me (get current user)
  if (path.endsWith('/me') && req.method === 'GET') {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const token = authHeader.substring(7);
      let decoded: { userId: string; email: string };
      
      try {
        decoded = verify(token, JWT_SECRET) as { userId: string; email: string };
      } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          stores: {
            include: { store: true },
          },
        },
      });

      if (!user || !user.isActive) {
        res.status(401).json({ error: 'User not found or inactive' });
        return;
      }

      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          stores: user.stores.map((us) => ({
            storeId: us.store.storeId,
            storeName: us.store.storeName,
            role: us.role,
          })),
        },
      });
    } catch (error: unknown) {
      console.error('Me endpoint error:', error);
      res.status(500).json({ error: 'Failed to get user' });
    }
    return;
  }

  res.status(404).json({ error: 'Not found' });
}
