import express from 'express';
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js';
import { collection } from '../config/database.js';

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const users = await (await collection('users')).find({}, { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, created_at: 1, updated_at: 1 } }).sort({ created_at: -1 }).toArray();

  return res.json({
    success: true,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    })),
  });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await (await collection('users')).findOne({ id: req.user.id });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  }

  const { password_hash: _, ...safeUser } = user;

  return res.json({
    success: true,
    user: {
      id: safeUser.id,
      name: safeUser.name,
      email: safeUser.email,
      role: safeUser.role,
      createdAt: safeUser.created_at,
      updatedAt: safeUser.updated_at,
    },
  });
});

router.get('/admin-only', authMiddleware, adminMiddleware, async (req, res) => {
  return res.json({
    success: true,
    message: 'Admin access granted',
    admin: req.user,
  });
});

export default router;
