import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './src/routes/auth.js';
import userRoutes from './src/routes/users.js';
import registrationRoutes from './src/routes/registrations.js';
import { connectDatabase, databaseErrorMessage, databaseStatus, initializeDatabase } from './src/config/database.js';

const app = express();
const port = process.env.PORT || 5000;
const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(currentFile);
const publicRoot = path.join(projectRoot, 'public');

try {
  await initializeDatabase();
} catch (error) {
  console.error('Database initialization failed. Static pages will still be served.', error);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicRoot, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(projectRoot, 'Admin5.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(publicRoot, 'register.html'));
});

app.get('/payment', (req, res) => {
  res.sendFile(path.join(publicRoot, 'payment.html'));
});

app.get('/confirmation', (req, res) => {
  res.sendFile(path.join(publicRoot, 'confirmation.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(publicRoot, 'login.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(publicRoot, 'reset-password.html'));
});

app.get('/member', (req, res) => {
  res.sendFile(path.join(publicRoot, 'member.html'));
});

app.get('/Admin5.html', (req, res) => {
  res.sendFile(path.join(projectRoot, 'Admin5.html'));
});

app.use(express.static(publicRoot));

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Ranniti backend is running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', async (req, res) => {
  const status = databaseStatus();
  if (!status.connected && status.configured) {
    try {
      await connectDatabase();
    } catch (error) {
      return res.json({
        success: true,
        status: 'degraded',
        database: 'unavailable',
        message: databaseErrorMessage(error),
        uptime: process.uptime(),
      });
    }
  }
  const current = databaseStatus();
  res.json({
    success: true,
    status: current.connected ? 'ok' : 'degraded',
    database: current.connected ? 'connected' : 'unavailable',
    message: current.connected ? 'Database connected' : databaseErrorMessage(),
    uptime: process.uptime(),
  });
});

const catchAsync = (router) => {
  router.stack.forEach((layer) => {
    if (!layer.route) return;
    layer.route.stack.forEach((routeLayer) => {
      const handle = routeLayer.handle;
      routeLayer.handle = (req, res, next) => Promise.resolve(handle(req, res, next)).catch(next);
    });
  });
  return router;
};

app.use('/api/auth', catchAsync(authRoutes));
app.use('/api/users', catchAsync(userRoutes));
app.use('/api', catchAsync(registrationRoutes));

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({
    success: false,
    message: databaseErrorMessage(error),
  });
});

if (!process.env.VERCEL && !process.env.NETLIFY) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
  });
}

export default app;
