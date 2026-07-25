import { useNavigate } from 'react-router';

export default function Navbar() {
  const navigate = useNavigate();

  return (
    <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-6 lg:px-10">
      {/* Logo – links back to landing */}
      <button
        onClick={() => navigate('/')}
        className="text-2xl font-extrabold text-white tracking-tight cursor-pointer"
      >
        Transcenda<span className="text-brand-accent">.</span>
      </button>

      {/* Auth buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => alert("Login Modal will open here!")}
          className="text-sm font-semibold text-brand-text-secondary hover:text-white transition-colors"
        >
          Log In
        </button>
        <button
          onClick={() => alert("Signup Modal will open here!")}
          className="text-sm font-semibold bg-white text-slate-900 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
        >
          Sign Up
        </button>
      </div>
    </nav>
  );
}