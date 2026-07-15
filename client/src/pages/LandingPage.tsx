import SearchForm from '../components/SearchForm';

export default function LandingPage() {
  return (
    <div className="relative min-h-screen w-full bg-slate-900 flex flex-col items-center justify-center pt-20 pb-32 px-4 sm:px-6 lg:px-8">
      
      {/* Background Decor (A sleek, dark modern gradient) */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black z-0"></div>

      {/* Top Navigation Bar (Placeholder for your teammate's Auth work) */}
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6">
        <div className="text-2xl font-extrabold text-white tracking-tight">
          Transcenda<span className="text-blue-500">.</span>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => alert("Login Modal will open here!")}
            className="text-sm font-semibold text-slate-300 hover:text-white transition-colors"
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

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-4xl text-center space-y-8 mt-10">
        <div className="space-y-4">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter text-white drop-shadow-sm">
            Find your next <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">escape.</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto">
            Book premium stays at exclusive rates. Earn rewards on every night.
          </p>
        </div>

        {/* Form */}
        <div className="pt-8">
          <SearchForm />
        </div>
      </div>

    </div>
  );
}