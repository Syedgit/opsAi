import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { sign, verify } from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Signup endpoint
 * POST /api/auth/signup
 */
router.post('/signup', async (req: Request, res: Response) => {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to create user', details: errorMessage });
  }
});

/**
 * Login endpoint
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response) => {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to login', details: errorMessage });
  }
});

/**
 * Me endpoint - Get current user
 * GET /api/auth/me
 */
// List users (for testing/debugging - local only)
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        provider: true,
        isActive: true,
        createdAt: true,
        stores: {
          select: {
            storeId: true,
            role: true,
            store: {
              select: {
                storeName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.status(200).json({
      success: true,
      users,
      count: users.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error listing users:', errorMessage);
    res.status(500).json({
      success: false,
      error: 'Failed to list users',
      details: errorMessage,
    });
  }
});

router.get('/me', async (req: Request, res: Response) => {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get user', details: errorMessage });
  }
});

export { router as authRouter };
