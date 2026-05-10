import express from 'express';
import prisma from './db.js';

import authRoutes from './routes/authRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import pantryRoutes from './routes/pantryRoutes.js';
import ingredientsRoutes from './routes/ingredientsRoutes.js';
import recipesRoutes from './routes/recipesRoutes.js';
import plannerRoutes from './routes/plannerRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// Register API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pantry', pantryRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/planner', plannerRoutes);

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
