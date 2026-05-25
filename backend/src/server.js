import express from 'express';
import cors from 'cors';
import prisma from './db.js';

/**
 * Punto di ingresso principale dell'applicazione Express.
 * Configura l'ambiente del server, registra i middleware, le rotte e avvia l'ascolto.
 */

// Validazione immediata ("fail-fast") delle variabili d'ambiente obbligatorie per prevenire crash a runtime
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

// Abilita le policy CORS per autorizzare le richieste dai client (frontend) di sviluppo e produzione
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Aggiungi altri domini consentiti qui
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Registrazione dei router per le singole API (endpoints)
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pantry', pantryRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/planner', plannerRoutes);

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

// Gestione di spegnimento controllato ("graceful shutdown") per disconnettere Prisma e chiudere il server pulito su SIGINT
process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
