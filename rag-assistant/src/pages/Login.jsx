import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      navigate("/documents");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-tr from-slate-50 to-indigo-50/30 p-6 font-sans">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl shadow-slate-200/40 w-full max-w-md border border-slate-200/60"
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-extrabold text-base shadow-sm">
            R
          </div>
          <span className="font-extrabold tracking-tight text-sm text-slate-800">RAG Workspace</span>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600 mb-1.5 block">
          Welcome back
        </span>
        <h1 className="text-xl font-extrabold mb-1.5 text-slate-900 tracking-tight">
          Sign in to your workspace
        </h1>
        <p className="text-xs text-slate-400 mb-8 leading-relaxed">
          Ground your queries against private PDF and text resources.
        </p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Workspace Email Address
            </label>
            <input
              type="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 placeholder-slate-400"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Secure Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs font-semibold text-rose-600 flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/10 cursor-pointer"
        >
          {loading ? "Verifying..." : "Sign In to RAG Space"}
        </button>
        
        <p className="text-xs text-slate-500 mt-5 text-center">
          New to RAG Space?{" "}
          <Link to="/signup" className="font-bold text-indigo-600 hover:text-indigo-800">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}