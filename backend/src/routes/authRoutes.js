import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import prisma from '../db.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// ROTTE DI AUTENTICAZIONE
// Gestisce la registrazione, il login e il rilascio dei token JWT.
// Include una protezione anti-bruteforce (Rate Limiting).
// -----------------------------------------------------------------------------

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Finestra di 15 minuti
  max: 10, // Massimo 10 richieste per IP per evitare attacchi brute-force
  message: { error: 'Too many requests, please try again later.' }
});

/**
 * POST /register
 * Crea un nuovo account utente crittografando in modo sicuro la password tramite bcrypt.
 */
router.post('/register', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Verifica l'unicità dell'indirizzo email nel database
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Cifra la password aggiungendo un salt generato casualmente (cost factor 10)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Registra permanentemente il nuovo utente nel database
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
      },
    });

    res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * POST /login
 * Autentica l'utente e restituisce un token JWT firmato, valido per l'accesso alle rotte protette.
 */
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Recupera l'utente tramite email
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Valida la password confrontandola con l'hash memorizzato in sicurezza
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Genera un token JWT contentente ID e Email, valido per 7 giorni
    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // Durata del token
    );

    res.json({ 
      message: 'Login successful', 
      token, 
      user: { id: user.id, email: user.email } 
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Failed to login' });
  }
});

export default router;
