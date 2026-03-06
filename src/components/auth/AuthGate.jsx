import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../supabase";

const AuthCtx = createContext(null);

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let unsub = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setReady(true);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s ?? null);
      });
      unsub = sub?.subscription;
    })();

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  const signIn = async () => {
    setErr("");
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      setSession(data.session ?? null);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut();
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return <div style={{ padding: 16, fontFamily: "sans-serif" }}>読み込み中…</div>;
  }

  if (!session) {
    return (
      <div style={{ padding: 16, fontFamily: "sans-serif", maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 12px" }}>共有アカウントでログイン</h3>

        <div style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="メール"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
                userSelect: "none",
              }}
              aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
            >
              {showPw ? "🙈" : "👁"}
            </button>
          </div>

          <button onClick={signIn} disabled={busy || !email || !password} style={{ padding: 10, borderRadius: 8 }}>
            {busy ? "ログイン中…" : "ログイン"}
          </button>

          {err ? <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div> : null}

          <div style={{ fontSize: 12, color: "#666" }}>※ RLS が authenticated のため、ログインしないとデータは読めません。</div>
        </div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ session, signOut, authBusy: busy }}>
      {children}
    </AuthCtx.Provider>
  );
}

