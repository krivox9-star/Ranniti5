import jwt from 'jsonwebtoken';
import { collection } from '../config/database.js';

export const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication token missing or invalid',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ranniti-dev-secret');
    const storedUser = await (await collection('users')).findOne({ id: decoded.id });
    if (!storedUser || storedUser.active === false || (storedUser.role === 'visitor_admin' && storedUser.account_status !== 'active')) {
      return res.status(401).json({ success: false, message: 'This account is inactive or no longer available' });
    }
    req.user = {
      id: storedUser.id,
      email: storedUser.email,
      name: storedUser.name,
      role: storedUser.role || 'user',
    };
    return next();
  } catch (error) {
    if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') return next(error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
};

export const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }

  next();
};

export const visitorAdminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'visitor_admin') {
    return res.status(403).json({ success: false, message: 'Visitor Admin access required' });
  }
  next();
};
