import { useState } from "react";
import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import type { useCloudAuth } from "../hooks/useCloudAuth";
import "./CloudAuth.css";

export function CloudAuth({ auth }: { auth: ReturnType<typeof useCloudAuth> }) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch =
    creating && confirmation.length > 0 && confirmation !== password;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating && password !== confirmation) return;
    const success = await (creating
      ? auth.signUp(email, password)
      : auth.signIn(email, password));
    if (success) {
      setPassword("");
      setConfirmation("");
      setEmail("");
    }
  }
  return (
    <section className="cloud-auth card" aria-labelledby="cloud-auth-title">
      <div className="cloud-auth-intro">
        <span className="cloud-auth-icon">
          <ShieldCheck size={25} />
        </span>
        <span className="heading-eyebrow">PRIVATE BY DEFAULT</span>
        <h2 id="cloud-auth-title">
          {creating
            ? "Create your cloud account."
            : "Your journeys, securely connected."}
        </h2>
        <p>
          Sign in to view sessions you own or that another owner has shared with
          you. Cloud records persist between visits and synchronize with other
          authorized observers.
        </p>
        <div className="cloud-auth-privacy">
          <LockKeyhole size={15} />
          <span>
            Session access is enforced by database row-level security. Local
            simulation remains available without signing in.
          </span>
        </div>
      </div>
      <form
        className="cloud-auth-form"
        onSubmit={(event) => void submit(event)}
      >
        <h3>{creating ? "Create an account" : "Sign in to Supabase"}</h3>
        <label>
          <span>
            <Mail size={14} />
            Email address
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            disabled={auth.loading}
          />
        </label>
        <label>
          <span>
            <LockKeyhole size={14} />
            Password
          </span>
          <input
            type="password"
            name="password"
            autoComplete={creating ? "new-password" : "current-password"}
            minLength={creating ? 8 : undefined}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={auth.loading}
          />
        </label>
        {creating && (
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              name="confirmation"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={auth.loading}
              aria-describedby={mismatch ? "password-mismatch" : undefined}
            />
          </label>
        )}
        {mismatch && (
          <p id="password-mismatch" className="cloud-auth-error" role="alert">
            Passwords must match.
          </p>
        )}
        {auth.error && (
          <p className="cloud-auth-error" role="alert">
            {auth.error}
          </p>
        )}
        {auth.notice && (
          <p className="cloud-auth-notice" role="status">
            {auth.notice}
          </p>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={
            auth.loading || mismatch || (creating && password !== confirmation)
          }
        >
          {auth.loading
            ? "Please wait…"
            : creating
              ? "Create account"
              : "Sign in"}
          <ArrowRight size={15} />
        </button>
        <button
          className="cloud-auth-switch"
          type="button"
          onClick={() => {
            setCreating(!creating);
            setPassword("");
            setConfirmation("");
          }}
          disabled={auth.loading}
        >
          {creating
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        <p className="cloud-auth-hint">
          {creating
            ? "Use at least 8 characters. If email confirmation is enabled, confirm the email before signing in."
            : "Use the email and password for this Supabase project."}
        </p>
      </form>
    </section>
  );
}
