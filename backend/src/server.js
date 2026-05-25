import express from 'express';
import cors from 'cors';
import prisma from './db.js';

/**
 * Express application entry point.
 * Configures the server environment, registers middlewares, routes, and begins listening.
 */

// Fail-fast validation of required environment variables to prevent runtime crashes.
const requiredEnvVars = ['JWT_SECRET', 'GEMINI_API_KEY'];
const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingVars.length > 0) {
  console.error(`❌ FATAL ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

import authRoutes from './routes/authRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import pantryRoutes from './routes/pantryRoutes.js';
import ingredientsRoutes from './routes/ingredientsRoutes.js';
import plannerRoutes from './routes/plannerRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for authorized development and production origins.
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Add other allowed origins here
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// API Routes registration
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pantry', pantryRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/planner', plannerRoutes);

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

// Graceful shutdown handling to disconnect Prisma and close the server cleanly on SIGINT.
process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
