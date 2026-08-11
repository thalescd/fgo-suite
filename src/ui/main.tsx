import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

import { EquipPage, ServantPage } from "./DetailPages.js";
import { SearchPage } from "./SearchPage.js";
import { loadBootstrap, type Bootstrap } from "./data.js";
import "./styles.css";

function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBootstrap().then(setBoot, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  if (error) {
    return (
      <div className="empty">
        Could not load data: {error}
        <br />
        <code>npm run data:all</code>
      </div>
    );
  }
  if (!boot) return <div className="empty">loading index…</div>;

  // ISO: sem ambiguidade de locale para um rótulo de "quando os dados são de".
  const built = boot.meta.builtAt.slice(0, 10);

  return (
    <>
      <header className="topbar">
        <h1>
          <Link to="/" style={{ color: "inherit" }}>FGO Tools</Link>
        </h1>
        <span className="meta">
          {boot.meta.region} · gamedata {boot.meta.gameDataHash} · built {built} ·{" "}
          {boot.meta.counts.servants} servants, {boot.meta.counts.craftEssences} CEs
        </span>
      </header>
      <Routes>
        <Route path="/" element={<SearchPage boot={boot} />} />
        <Route path="/servant/:id" element={<ServantPage />} />
        <Route path="/equip/:id" element={<EquipPage />} />
        <Route path="*" element={<div className="empty">Page not found. <Link to="/">Back to search</Link></div>} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
