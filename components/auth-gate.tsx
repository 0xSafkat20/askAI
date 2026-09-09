'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getSupabaseBrowser()
      .then(async (supabase) => {
        if (!active) return;
        const subscription = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (active) {
              setUser(session?.user ?? null);
              setLoading(false);
            }
          },
        );
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        const result = await supabase.auth.getSession();
        if (result.error) throw result.error;
        if (active) {
          setUser(result.data.session?.user ?? null);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load sign-in.',
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    const passwordValue = form.get('password');
    const email = typeof emailValue === 'string' ? emailValue.trim() : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const supabase = await getSupabaseBrowser();
      const result = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage('Check your email to confirm your account, then sign in.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      const supabase = await getSupabaseBrowser();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setUser(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-out failed.');
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-shell">
        <p>Loading your account...</p>
      </main>
    );
  if (user)
    return (
      <div key={user.id}>
        <div className="account-bar">
          <span>{user.email}</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    );
  return (
    <main className="auth-shell">
      <section className="panel auth-panel">
        <h1>askAI</h1>
        <p>
          {signup
            ? 'Create an account to save your documents and conversations.'
            : 'Sign in to your documents and conversations.'}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={8}
            required
            disabled={busy}
          />
          <button className="primary-button" disabled={busy}>
            {busy ? 'Please wait...' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {message && <output>{message}</output>}
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setSignup(!signup);
            setError('');
            setMessage('');
          }}
        >
          {signup ? 'Already have an account? Sign in' : 'Create an account'}
        </button>
      </section>
    </main>
  );
}
