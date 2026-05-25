import { Link } from 'react-router-dom';

/**
 * Home – landing page for PiattoRicco ("Digital Kitchen").
 *
 * Layout (top to bottom, easy to explain in class):
 *   1. Hero — cookbook "chapter opener" (centred column, terracotta + sage CTAs)
 *   2. Editorial band — one short mission statement on a muted cream strip
 *   3. Features — three cards from a JavaScript array + .map()
 *   4. Bottom CTA — shown only to guests (conditional && rendering)
 *
 * Styling: Bootstrap utilities + named classes in custom.css (no neon gradients).
 */
function Home() {
  // Same auth check as App.jsx — reads JWT from localStorage (no extra state library)
  const isAuthenticated = !!localStorage.getItem('token');

  // Feature cards data — keeping content in an array teaches list rendering with .map()
  const features = [
    {
      icon: '📅',
      title: 'AI-Guided Meal Planner',
      description:
        'Plan your entire week. Lock your favorite meals and let our intelligent assistant automatically complete your diet calendar.',
      link: '/planner',
      linkLabel: 'Open Planner',
    },
    {
      icon: '⚡',
      title: 'Quick Recipe Generator',
      description:
        'Need a delicious, single meal idea in a pinch? Instantly generate a custom gourmet recipe tailored to your active dietary profile and macro targets.',
      link: '/quick-recipe',
      linkLabel: 'Open Quick Generator',
    },
    {
      icon: '🥦',
      title: 'Smart Zero-Waste Pantry',
      description:
        'Track ingredients at home. Our AI acts as a zero-waste chef, prioritizing items you already own to build delicious recipes.',
      link: '/pantry',
      linkLabel: 'Open Pantry',
    }
  ];

  return (
    <div>

      {/* ── 1. HERO — chapter opener ─────────────────────────────────────────── */}
      {/*
        .home-hero sets flat cream background (custom.css) — warmth from colour, not gradients.
        Bootstrap grid caps line length like a cookbook column: col-lg-10 (wider on large screens).
      */}
      <section className="home-hero d-flex align-items-center justify-content-center text-center py-5 position-relative">
        {/* Sfondo Immagine Utente */}
        <div 
          className="position-absolute top-0 start-0 w-100 h-100" 
          style={{
            backgroundImage: "url('/assets/images/wallpaper.jpg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.25,
            zIndex: 0
          }}
        ></div>
        
        <div className="container px-3 px-md-4 position-relative" style={{ zIndex: 1 }}>
          <div className="row justify-content-center">
            <div className="col-12 col-lg-10">
              {/* Sage badge mimics a cookbook section label ("Introduction") */}
              <div className="d-flex flex-wrap gap-2 justify-content-center mb-4">
                <span className="badge badge-sage rounded-pill px-3 py-2 fs-6 fw-normal">
                  Your digital kitchen
                </span>
                <span className="badge badge-ai-sparkle rounded-pill px-3 py-2 fs-6 fw-normal">
                  ✨ Powered by Google Gemini AI
                </span>
              </div>

              {/* Serif headline from global h1 rule in custom.css */}
              <h1 className="display-4 fw-bold mb-3">
                Your week, planned like a{' '}
                <span className="text-primary">menu</span>
              </h1>
              <h3 className="h4 fw-normal text-muted mb-4">
                Intelligently powered by Chef-Grade Artificial Intelligence
              </h3>

              <p className="lead text-muted mb-5">
                Plan meals around what is in your pantry, map your week at a glance,
                and let our <strong>intelligent Gemini AI</strong> suggest custom dishes that perfectly fit your calories, preferences, and dietary goals.
              </p>

              <div className="d-flex flex-wrap gap-3 justify-content-center">
                {!isAuthenticated && (
                  <Link
                    to="/register"
                    className="btn btn-primary btn-lg px-4"
                    id="hero-get-started-btn"
                  >
                    Start your AI-powered journal
                  </Link>
                )}
                <Link
                  to="/dashboard"
                  className="btn btn-light border shadow-sm btn-lg px-4 fw-bold text-secondary"
                  id="hero-dashboard-btn"
                >
                  Go to Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. EDITORIAL BAND — short mission strip ──────────────────────────── */}
      <section className="home-editorial-band py-5">
        <div className="container px-3 px-md-4">
          <div className="row justify-content-center text-center">
            <div className="col-12 col-lg-10">
              <h2 className="fw-bold mb-3">AI-Powered Culinary Intelligence</h2>
              <p className="text-muted mb-0">
                PiattoRicco fuses advanced AI suggestions with your digital pantry and weekly planner. 
                Our Gemini AI integration acts as your personal chef, generating healthy recipes, minimizing waste, 
                and automatically calculating your precise daily macronutrient needs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. FEATURES — three recipe-style cards ───────────────────────────── */}
      {/*
        Responsive grid: 1 col mobile → 2 cols tablet → 3 cols desktop.
        .hover-card adds a gentle lift on hover (transform in custom.css).
      */}
      <section className="py-5" id="features">
        <div className="container px-3 px-md-4">
          <div className="text-center mb-5">
            <h2 className="fw-bold">Three tools, one kitchen</h2>
            <p className="text-muted">Everything you need to plan, cook, and shop with less stress.</p>
          </div>

          <div className="row g-4">
            {features.map((feature) => (
              <div key={feature.title} className="col-12 col-md-6 col-lg-4">
                <div className="card h-100 hover-card border-0 shadow-sm p-4">
                  <div className="fs-1 mb-3">{feature.icon}</div>
                  <h5 className="fw-bold mb-2">{feature.title}</h5>
                  <p className="text-muted flex-grow-1">{feature.description}</p>
                  <Link
                    to={feature.link}
                    className="btn btn-outline-primary btn-sm mt-3 align-self-start"
                    id={`feature-link-${feature.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {feature.linkLabel} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. BOTTOM CTA — guests only ────────────────────────────────────── */}
      {!isAuthenticated && (
        <section className="py-5">
          <div className="container px-3 px-md-4">
            <div className="home-cta-box rounded-4 p-5 text-center">
              <div className="fs-1 mb-3">🤖</div>
              <h3 className="fw-bold mb-3">Reserve your seat at the table</h3>
              <p className="text-muted mb-4">
                Create a free account in seconds and let advanced Gemini AI handle your meal planning and pantry waste reduction.
              </p>
              <Link to="/register" className="btn btn-primary btn-lg px-5" id="bottom-cta-btn">
                Create your AI Kitchen Journal
              </Link>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}

export default Home;
