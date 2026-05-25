# 🍽️ PiattoRicco

[![React Version](https://img.shields.io/badge/React-19.0-blue.svg?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF.svg?logo=vite)](https://vite.dev/)
[![Express Version](https://img.shields.io/badge/Express-5.2-lightgrey.svg?logo=express)](https://expressjs.com/)
[![Prisma Version](https://img.shields.io/badge/Prisma-7.8-123D5F.svg?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg?logo=postgresql)](https://www.postgresql.org/)
[![Google Gemini API](https://img.shields.io/badge/Google_Gemini-Powered-4285F4.svg?logo=google-gemini)](https://deepmind.google/technologies/gemini/)

**PiattoRicco** ("Rich Plate") is a premium, AI-powered meal planning and pantry management web application. Designed for individuals who want to minimize food waste, optimize their daily nutrition, and enjoy tailored culinary experiences. 

By integrating state-of-the-art AI generation via **Google Gemini**, PiattoRicco intelligently matches what is currently in your pantry with your nutritional targets, dietary restrictions, and preferred cuisines to generate personalized daily and weekly meal plans.

---

## ✨ Features

### 🥦 Smart Pantry Management
* **Inventory Tracking**: Add and update ingredients in your digital pantry with exact quantities and units (grams, ml, pieces, etc.).
* **Fuzzy Ingredient Matching**: Automatically resolves custom ingredients against a clean master list.
* **Waste Reduction**: Recommends recipes primarily using items you already have.

### 🎯 Custom Dietary & Nutritional Profiles
* **Macronutrient Tracking**: Set daily targets for **Calories**, **Protein**, **Carbohydrates**, and **Fats**.
* **Dietary Preferences**: Supports customized diets (e.g., Vegan, Vegetarian, Keto, Paleo, Gluten-Free).
* **Allergies & Exclusions**: Exclude specific ingredients (e.g., peanuts, shellfish, lactose) to ensure all AI-generated recipes are safe.
* **Cuisine Preferences**: Specify favorite culinary cultures (e.g., Italian, Japanese, Mexican, Indian).

### 🤖 Gemini AI Meal Planner & Recipe Generator
* **AI Generation**: Integrates the `@google/generative-ai` SDK to dynamically create meal plans matching your unique combination of pantry inventory, calories, and diets.
* **Smart Recipe Details**: Each generated recipe includes step-by-step instructions, preparation times, serving sizes, and full macronutrient breakdowns.
* **Interactive Lock & Regenerate**: Lock meals you like and regenerate only the unlocked slots for a specific day or week.
* **Quick Recipe Generator**: Need a single meal fast? Enter custom ingredients on the fly and get an instant gourmet recipe proposal.

### 📊 Dynamic Dashboard & Interactive Analytics
* **Macro Progress Visualization**: Visual progress rings and progress bars showing daily targets vs. planned totals.
* **Weekly Planner Grid**: Elegant weekly overview with easy day-by-day navigation.
* **Pantry Alert Highlights**: Quick notices about low stock or missing staples.

---

## 🛠️ Technology Stack

### Frontend
* **Framework**: React 19 (Functional Components, Hooks)
* **Build Tool**: Vite (optimized HMR and fast production building)
* **Routing**: React Router DOM (v7)
* **Server State Management**: TanStack React Query (v5) for robust caching and data synchronization
* **UI & Styling**: Bootstrap 5 + Premium Custom Vanilla CSS (featuring vibrant color systems, elegant gradients, dark/light glassmorphism elements, and smooth micro-animations)

### Backend
* **Runtime & Framework**: Node.js with Express (v5)
* **Database & ORM**: PostgreSQL, mapped and queried via Prisma ORM
* **AI Integration**: `@google/generative-ai` (utilizing advanced Gemini models)
* **Security & Auth**: JSON Web Tokens (JWT) for secure session management, `bcryptjs` for secure password hashing
* **Reliability & Protection**: `express-rate-limit` for API endpoint rate-limiting and DDoS defense

---

## 🏗️ Architecture

The project is structured as a clear monorepo split into two decoupled layers:

```
PiattoRicco/
├── backend/
│   ├── prisma/             # database schema and migrations
│   └── src/
│       ├── middleware/     # JWT authentication, rate limiting
│       ├── routes/         # auth, ingredients, pantry, planner, profile endpoints
│       ├── utils/          # AI prompt templates & helpers
│       ├── db.js           # Prisma client initializer
│       └── server.js       # App entrypoint, cors configs, and graceful shutdown
├── frontend/
│   └── src/
│       ├── pages/          # Dashboard, Pantry, Planner, Profile, QuickRecipe, etc.
│       ├── utils/          # API fetch clients & auth helpers
│       ├── App.jsx         # App router & TanStack query setup
│       ├── main.jsx        # Mount point
│       └── custom.css      # Custom UI design system & utility classes
└── extract_classes.js      # Utility script for styles analysis
```

---

## 🚀 Setup & Installation

### Prerequisites
* **Node.js** (v18 or higher recommended)
* **PostgreSQL** database instance
* **Google Gemini API Key** (Get one at [Google AI Studio](https://aistudio.google.com/))

### 1. Database & Backend Configuration

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the `backend/` folder based on the configuration requirements:
   ```env
   # Database connection string (PostgreSQL)
   DATABASE_URL="postgresql://username:password@localhost:5432/piattoricco?schema=public"

   # Secret key for JWT signing
   JWT_SECRET="your_jwt_super_secret_key_here"

   # Google Gemini API Key
   GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere..."

   # Port configuration
   PORT=5000
   ```

4. Run the Prisma database migrations to create the schemas:
   ```bash
   npx prisma migrate dev --name init
   ```

5. Seed or generate the Prisma client:
   ```bash
   npm run prisma:generate
   ```

### 2. Frontend Configuration

1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. (Optional) The frontend is preconfigured to call the local API server running on `http://localhost:5000/api`. If you deploy the backend elsewhere, update your base API URLs accordingly.

---

## 🏃 Running the Application

### Start the Backend Server
From the `backend/` directory:
* **Development (Auto-Reloading)**:
  ```bash
  npm run dev
  ```
* **Production**:
  ```bash
  npm start
  ```

### Start the Frontend Dev Server
From the `frontend/` directory:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

---

## 🔒 Security & Performance Features

* **Fail-Fast Environment Validation**: The backend checks for critical variables (`JWT_SECRET`, `GEMINI_API_KEY`) on startup. If any are missing, the server prints a fatal error and shuts down immediately to prevent half-functional execution.
* **Graceful Shutdown**: The Node.js application captures termination signals (`SIGINT`) to clean up open Prisma connections and close active sockets gracefully.
* **JWT Session Guarding**: Sensitive pantry, profile, and meal planning endpoints are guarded by a robust authentication middleware.
* **Rate Limiting**: Defends endpoints from brute force attempts and rapid repetitive AI generation queries, conserving API quotas.

---

## 🇮🇹 Brand Philosophy & UI Design
The name **PiattoRicco** is inspired by the famous Italian idiomatic phrase **"Piatto ricco, mi ci ficco"** (literally *"Rich plate, I'm diving in!"*—expressing enthusiastic eagerness to seize an irresistible, delicious opportunity). The application brings this joyful culinary spirit to modern meal planning:
* **Enthusiastic Eating**: Helps you dive right into delicious meals using what you already have in your kitchen, making cooking an exciting opportunity rather than a chore.
* **Premium Aesthetics**: The UI embraces this philosophy with deep dark backgrounds combined with vibrant glassmorphic gradients and energetic tones.
* **Tactile Interactions**: Soft emerald green highlights represent fresh ingredients, while rich amber represents warmth, flavor, and cooking. Clean custom cards and hover-triggered micro-animations create a premium, tactile, and highly responsive user experience.