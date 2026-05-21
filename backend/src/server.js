import express from 'express';
import cors from 'cors';
import prisma from './db.js';

// -----------------------------------------------------------------------------
// PUNTO DI INGRESSO DELL'APPLICAZIONE (SERVER)
// Configura l'ambiente Express, i middleware (CORS, JSON) e avvia il server in ascolto.
// -----------------------------------------------------------------------------

// Validazione preventiva delle variabili d'ambiente (Pattern Fail-Fast)
// Interrompe immediatamente l'avvio del server se mancano chiavi critiche.
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

// Configurazione CORS (Cross-Origin Resource Sharing)
// Permette esclusivamente le richieste provenienti dai server di sviluppo frontend autorizzati.
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // Add other allowed origins here
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Registrazione dei moduli di routing dell'API (Endpoints)
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pantry', pantryRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/planner', plannerRoutes);

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

// Gestione pulita dell'arresto del server (Graceful Shutdown)
// Assicura la corretta disconnessione dal database in caso di chiusura manuale (Ctrl+C).
process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
