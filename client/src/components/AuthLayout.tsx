import { Link } from 'react-router';

export default function AuthLayout({ children, title, subtitle }: { children: React.ReactNode, title: string, subtitle: string }) {
  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center p-4 overflow-hidden">
      
      {/* Wallpaper Layer */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ 
          backgroundImage: "url('https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=2070&auto=format&fit=crop')",
        }}
      >
        {/* Dark Overlay to keep text readable */}
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"></div>
      </div>

      {/* Navigation */}
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6">
        <Link to="/" className="text-2xl font-extrabold text-white tracking-tight">
          Transcenda<span className="text-blue-500">.</span>
        </Link>
      </nav>

      {/* Main Card Wrapper */}
      <div className="relative z-10 w-full max-w-md bg-slate-800/80 backdrop-blur-xl p-8 rounded-2xl border border-slate-700 shadow-2xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <p className="text-slate-400">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}